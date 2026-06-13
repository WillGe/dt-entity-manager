import { SvelteSet } from 'svelte/reactivity';
import {
	addTags,
	buildEntitySelector,
	getDetectionOverrides,
	getEnvironmentDefaultValue,
	getOpenProblemCounts,
	getServiceThroughput,
	KEY_REQUESTS_SCHEMA,
	keyRequestNames,
	listEntities,
	listManagementZoneNames,
	SERVICE_ANOMALY_SCHEMA
} from '$lib/api/dynatrace';
import { getCached, setCached, updateCachedByPrefix } from '$lib/cache';
import type {
	ColumnFilters,
	ColumnId,
	DtEntity,
	DtTag,
	EntityFilters,
	EntityType,
	RowEnrichment,
	SortState,
	TagInput
} from '$lib/types';

const ENTITY_TTL_MS = 30 * 60 * 1000;
const MZ_TTL_MS = 24 * 60 * 60 * 1000;
const VIEW_KEY = 'dtem:view';

export const ENTITY_TYPES: EntityType[] = ['SERVICE', 'HOST', 'PROCESS_GROUP'];

export const emptyFilters = (): EntityFilters => ({
	name: '',
	tags: [],
	mzName: '',
	healthState: '',
	serviceType: ''
});

export const emptyColumnFilters = (): ColumnFilters => ({
	name: '',
	entityId: '',
	kind: '',
	typeDetail: '',
	detection: '',
	tags: '',
	mz: '',
	problems: ''
});

// v3: lists now include properties + lastSeenTms; ignore older-shaped cache entries.
const LIST_CACHE_PREFIX = 'entities:v3:';
const ENRICH_TTL_MS = 10 * 60 * 1000;

export interface EnrichErrors {
	detection?: string;
	problems?: string;
	throughput?: string;
}

interface CachedList {
	entities: DtEntity[];
	totalCount: number;
	nextPageKey: string | null;
}

interface TypePageState {
	entities: DtEntity[];
	totalCount: number;
	nextPageKey: string | null;
	fetchedAt: number | null;
	loading: boolean;
	loadingMore: boolean;
	error: string | null;
	enriching: boolean;
}

const emptyPage = (): TypePageState => ({
	entities: [],
	totalCount: 0,
	nextPageKey: null,
	fetchedAt: null,
	loading: false,
	loadingMore: false,
	error: null,
	enriching: false
});

/** Sort accessors per column; undefined means "missing", which sorts last in both directions. */
const SORT_ACCESSORS: Record<
	ColumnId,
	(e: DtEntity, enr?: RowEnrichment) => string | number | undefined
> = {
	name: (e) => e.displayName.toLowerCase(),
	entityId: (e) => e.entityId,
	kind: (e) => e.type,
	typeDetail: (e) => entityTypeDetail(e).toLowerCase() || undefined,
	detection: (e, enr) =>
		enr?.overriddenSchemas ? (enr.overriddenSchemas.length ? 'custom' : 'default') : undefined,
	problems: (e, enr) => enr?.openProblems,
	reqPerMin: (e, enr) => enr?.throughputPerMin,
	keyReqs: (e, enr) => enr?.keyRequests?.length,
	lastSeen: (e) => e.lastSeenTms,
	tags: (e) =>
		e.tags?.length ? e.tags.map(tagLabel).join(',').toLowerCase() : undefined,
	mz: (e) => e.managementZones?.[0]?.name.toLowerCase()
};

class EntityListStore {
	/** Entity types currently enabled for fetching, kept in ENTITY_TYPES order; never empty. */
	types = $state<EntityType[]>(['SERVICE']);
	/** Server-side filters, applied explicitly via the filter bar. */
	filters = $state<EntityFilters>(emptyFilters());
	/** Client-side substring filter over the loaded rows; never triggers API calls. */
	quickFilter = $state('');
	/** Client-side per-column filters over the loaded rows. */
	columnFilters = $state<ColumnFilters>(emptyColumnFilters());
	showColumnFilters = $state(false);
	sort = $state<SortState | null>(null);

	pages = $state<Record<EntityType, TypePageState>>({
		SERVICE: emptyPage(),
		HOST: emptyPage(),
		PROCESS_GROUP: emptyPage()
	});
	loadingAll = $state(false);
	selected = new SvelteSet<string>();
	mzNames = $state<string[]>([]);

	/** Per-row batched extras (detection overrides, problems, throughput), keyed by entityId. */
	enrichments = $state<Record<string, RowEnrichment>>({});
	enrichErrorsByType = $state<Partial<Record<EntityType, EnrichErrors>>>({});

	/** Bumped on any change that invalidates in-flight work (filters, type toggles, loadAll stop). */
	private loadSeq = 0;

	entities = $derived(this.types.flatMap((t) => this.pages[t].entities));
	totalCount = $derived(this.types.reduce((n, t) => n + this.pages[t].totalCount, 0));
	loading = $derived(this.types.some((t) => this.pages[t].loading));
	loadingMore = $derived(this.types.some((t) => this.pages[t].loadingMore));
	enriching = $derived(this.types.some((t) => this.pages[t].enriching));
	hasMore = $derived(this.types.some((t) => this.pages[t].nextPageKey));
	error = $derived.by(() => {
		const errs = this.types.map((t) => this.pages[t].error).filter(Boolean);
		return errs.length ? errs.join('; ') : null;
	});
	/** Oldest fetch among enabled types — the most conservative "data as of". */
	fetchedAt = $derived.by(() => {
		const times = this.types.map((t) => this.pages[t].fetchedAt).filter((t): t is number => t !== null);
		return times.length ? Math.min(...times) : null;
	});
	/** Identifies the loaded data set (all enabled selectors); used in dependent cache keys. */
	listSignature = $derived(this.types.map((t) => buildEntitySelector(t, this.filters)).join('|'));
	enrichErrors = $derived.by(() => {
		const merged: EnrichErrors = {};
		for (const t of this.types) {
			const errs = this.enrichErrorsByType[t];
			if (!errs) continue;
			for (const k of ['detection', 'problems', 'throughput'] as const) {
				if (!errs[k]) continue;
				merged[k] = merged[k] && merged[k] !== errs[k] ? `${merged[k]}; ${errs[k]}` : errs[k];
			}
		}
		return merged;
	});

	constructor() {
		// restore last-used types + filters across reloads
		const raw = localStorage.getItem(VIEW_KEY);
		if (raw) {
			try {
				const view = JSON.parse(raw) as {
					type?: EntityType; // legacy single-tab shape
					types?: EntityType[];
					filters?: Partial<EntityFilters>;
					columnFilters?: Partial<ColumnFilters>;
					sort?: SortState | null;
					showColumnFilters?: boolean;
				};
				if (Array.isArray(view.types)) {
					const valid = ENTITY_TYPES.filter((t) => view.types?.includes(t));
					if (valid.length) this.types = valid;
				} else if (view.type && ENTITY_TYPES.includes(view.type)) {
					this.types = [view.type];
				}
				if (view.filters) this.filters = { ...emptyFilters(), ...view.filters };
				if (view.columnFilters) {
					const cf = { ...emptyColumnFilters(), ...view.columnFilters };
					if (cf.kind && !ENTITY_TYPES.includes(cf.kind)) cf.kind = '';
					if (cf.detection && !['custom', 'default'].includes(cf.detection)) cf.detection = '';
					if (cf.problems && !['has', 'none'].includes(cf.problems)) cf.problems = '';
					this.columnFilters = cf;
				}
				if (
					view.sort &&
					view.sort.col in SORT_ACCESSORS &&
					(view.sort.dir === 'asc' || view.sort.dir === 'desc')
				) {
					this.sort = view.sort;
				}
				if (typeof view.showColumnFilters === 'boolean') {
					this.showColumnFilters = view.showColumnFilters;
				}
			} catch {
				localStorage.removeItem(VIEW_KEY);
			}
		}
	}

	persistView(): void {
		localStorage.setItem(
			VIEW_KEY,
			JSON.stringify({
				types: this.types,
				filters: this.filters,
				columnFilters: this.columnFilters,
				sort: this.sort,
				showColumnFilters: this.showColumnFilters
			})
		);
	}

	visible = $derived.by(() => {
		let rows = this.entities;
		const q = this.quickFilter.trim().toLowerCase();
		if (q) {
			rows = rows.filter(
				(e) =>
					e.displayName.toLowerCase().includes(q) ||
					e.entityId.toLowerCase().includes(q) ||
					entityTypeDetail(e).toLowerCase().includes(q) ||
					(e.tags ?? []).some((t) => tagLabel(t).toLowerCase().includes(q))
			);
		}
		rows = this.applyColumnFilters(rows);
		const sort = this.sort;
		if (!sort) return rows;
		const accessor = SORT_ACCESSORS[sort.col];
		const sign = sort.dir === 'asc' ? 1 : -1;
		return [...rows].sort((a, b) => {
			const va = accessor(a, this.enrichments[a.entityId]);
			const vb = accessor(b, this.enrichments[b.entityId]);
			if (va === undefined || va === '') return vb === undefined || vb === '' ? 0 : 1;
			if (vb === undefined || vb === '') return -1;
			if (typeof va === 'number' && typeof vb === 'number') return sign * (va - vb);
			return sign * String(va).localeCompare(String(vb));
		});
	});

	private applyColumnFilters(rows: DtEntity[]): DtEntity[] {
		const f = this.columnFilters;
		const name = f.name.trim().toLowerCase();
		const entityId = f.entityId.trim().toLowerCase();
		const typeDetail = f.typeDetail.trim().toLowerCase();
		const tags = f.tags.trim().toLowerCase();
		if (!name && !entityId && !typeDetail && !tags && !f.kind && !f.detection && !f.mz && !f.problems) {
			return rows;
		}
		return rows.filter((e) => {
			if (name && !e.displayName.toLowerCase().includes(name)) return false;
			if (entityId && !e.entityId.toLowerCase().includes(entityId)) return false;
			if (f.kind && e.type !== f.kind) return false;
			if (typeDetail && !entityTypeDetail(e).toLowerCase().includes(typeDetail)) return false;
			if (tags && !(e.tags ?? []).some((t) => tagLabel(t).toLowerCase().includes(tags))) return false;
			if (f.mz && !(e.managementZones ?? []).some((m) => m.name === f.mz)) return false;
			if (f.detection) {
				const enr = this.enrichments[e.entityId];
				if (!enr?.overriddenSchemas) return false;
				const state = enr.overriddenSchemas.length ? 'custom' : 'default';
				if (state !== f.detection) return false;
			}
			if (f.problems) {
				const count = this.enrichments[e.entityId]?.openProblems;
				if (count === undefined) return false;
				if (f.problems === 'has' ? count === 0 : count > 0) return false;
			}
			return true;
		});
	}

	cycleSort(col: ColumnId): void {
		if (this.sort?.col !== col) this.sort = { col, dir: 'asc' };
		else if (this.sort.dir === 'asc') this.sort = { col, dir: 'desc' };
		else this.sort = null;
		this.persistView();
	}

	/** Invalidate in-flight work: cancels a running loadAll and marks stale enrichments. */
	private invalidate(): void {
		this.loadSeq++;
		this.loadingAll = false;
	}

	async toggleType(type: EntityType): Promise<void> {
		if (this.types.includes(type)) {
			if (this.types.length === 1) return; // at least one type stays enabled
			this.invalidate();
			this.types = this.types.filter((t) => t !== type);
			for (const id of [...this.selected]) {
				if (id.startsWith(`${type}-`)) this.selected.delete(id);
			}
			if (this.columnFilters.kind === type) this.columnFilters.kind = '';
			this.persistView();
			return;
		}
		this.types = ENTITY_TYPES.filter((t) => this.types.includes(t) || t === type);
		this.persistView();
		await this.loadType(type, false);
	}

	async applyFilters(filters: EntityFilters): Promise<void> {
		this.filters = filters;
		this.selected.clear();
		this.persistView();
		await this.load();
	}

	private selectorFor(type: EntityType): string {
		return buildEntitySelector(type, this.filters);
	}

	async load(force = false): Promise<void> {
		this.invalidate();
		const results = await Promise.allSettled(this.types.map((t) => this.loadType(t, force)));
		const failures = results
			.filter((r): r is PromiseRejectedResult => r.status === 'rejected')
			.map((r) => (r.reason instanceof Error ? r.reason.message : String(r.reason)));
		if (failures.length) throw new Error([...new Set(failures)].join('; '));
	}

	private async loadType(type: EntityType, force: boolean): Promise<void> {
		const page = this.pages[type];
		page.loading = true;
		page.error = null;
		try {
			const selector = this.selectorFor(type);
			const key = `${LIST_CACHE_PREFIX}${selector}`;
			if (!force) {
				const hit = getCached<CachedList>(key, ENTITY_TTL_MS);
				if (hit) {
					page.entities = hit.value.entities;
					page.totalCount = hit.value.totalCount;
					page.nextPageKey = hit.value.nextPageKey;
					page.fetchedAt = hit.fetchedAt;
					void this.loadEnrichmentsFor(type);
					return;
				}
			}
			const result = await listEntities(selector, type);
			page.entities = result.entities ?? [];
			page.totalCount = result.totalCount;
			page.nextPageKey = result.nextPageKey ?? null;
			page.fetchedAt = Date.now();
			this.saveToCache(type);
			void this.loadEnrichmentsFor(type, force);
		} catch (e) {
			page.error = e instanceof Error ? e.message : String(e);
			throw e;
		} finally {
			page.loading = false;
		}
	}

	async loadMore(): Promise<void> {
		await Promise.all(
			this.types
				.filter((t) => this.pages[t].nextPageKey)
				.map((t) => this.loadMoreType(t))
		);
	}

	private async loadMoreType(type: EntityType, enrich = true): Promise<void> {
		const page = this.pages[type];
		if (!page.nextPageKey || page.loadingMore) return;
		page.loadingMore = true;
		try {
			const result = await listEntities(this.selectorFor(type), type, page.nextPageKey);
			page.entities = [...page.entities, ...(result.entities ?? [])];
			page.nextPageKey = result.nextPageKey ?? null;
			this.saveToCache(type);
			if (enrich) void this.loadEnrichmentsFor(type);
		} finally {
			page.loadingMore = false;
		}
	}

	/** Fetch every remaining page for all enabled types; enrich once at the end. */
	async loadAll(): Promise<void> {
		if (this.loadingAll) return;
		const seq = ++this.loadSeq;
		this.loadingAll = true;
		try {
			while (this.types.some((t) => this.pages[t].nextPageKey)) {
				await Promise.all(
					this.types
						.filter((t) => this.pages[t].nextPageKey)
						// per-page enrichment would re-fetch the whole accumulated list each round
						.map((t) => this.loadMoreType(t, false))
				);
				if (seq !== this.loadSeq) return; // cancelled by Stop / filter or type change
			}
			for (const t of this.types) void this.loadEnrichmentsFor(t);
		} finally {
			if (seq === this.loadSeq) this.loadingAll = false;
		}
	}

	cancelLoadAll(): void {
		this.invalidate();
	}

	persistColumnFilters(): void {
		this.persistView();
	}

	private saveToCache(type: EntityType): void {
		const page = this.pages[type];
		setCached<CachedList>(`${LIST_CACHE_PREFIX}${this.selectorFor(type)}`, {
			entities: page.entities,
			totalCount: page.totalCount,
			nextPageKey: page.nextPageKey
		});
	}

	async loadMzNames(): Promise<void> {
		const hit = getCached<string[]>('mzNames', MZ_TTL_MS);
		if (hit) {
			this.mzNames = hit.value;
			return;
		}
		this.mzNames = await listManagementZoneNames();
		setCached('mzNames', this.mzNames);
	}

	/**
	 * Fetch batched per-row extras for one type's loaded rows. Each source fails
	 * independently (e.g. missing problems.read/metrics.read token scope) and
	 * reports into enrichErrorsByType; the rest of the columns still populate.
	 * Results merge into the shared enrichments map (entity ids are unique).
	 */
	async loadEnrichmentsFor(type: EntityType, force = false): Promise<void> {
		const selector = this.selectorFor(type);
		const ids = this.pages[type].entities.map((e) => e.entityId);
		if (ids.length === 0) return;
		// v2: rows now include keyRequests; ignore older-shaped cache entries
		const key = `enrich:v2:${LIST_CACHE_PREFIX}${selector}`;
		if (!force) {
			const hit = getCached<Record<string, RowEnrichment>>(key, ENRICH_TTL_MS);
			if (hit && ids.every((id) => id in hit.value)) {
				this.enrichments = { ...this.enrichments, ...hit.value };
				this.enrichErrorsByType[type] = {};
				return;
			}
		}

		this.pages[type].enriching = true;
		const errors: EnrichErrors = {};
		const next: Record<string, RowEnrichment> = {};
		for (const id of ids) next[id] = {};
		const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

		try {
			try {
				const overrides = await getDetectionOverrides(type, ids);
				const envDefault = type === 'SERVICE' ? await this.envAnomalyDefault(force) : null;
				for (const id of ids) {
					const objs = overrides.get(id) ?? [];
					const detection = objs.filter((o) => o.schemaId !== KEY_REQUESTS_SCHEMA);
					next[id].overriddenSchemas = detection.map((o) => o.schemaId);
					if (type === 'SERVICE') {
						const own = detection.find((o) => o.schemaId === SERVICE_ANOMALY_SCHEMA)?.value;
						next[id].detectionSummary = detectionSummary(own ?? envDefault);
						next[id].keyRequests = keyRequestNames(
							objs.find((o) => o.schemaId === KEY_REQUESTS_SCHEMA)?.value
						);
					}
				}
			} catch (e) {
				errors.detection = msg(e);
			}

			try {
				const counts = await getOpenProblemCounts(ids);
				for (const id of ids) next[id].openProblems = counts.get(id) ?? 0;
			} catch (e) {
				errors.problems = msg(e);
			}

			if (type === 'SERVICE') {
				try {
					const throughput = await getServiceThroughput(ids);
					for (const id of ids) next[id].throughputPerMin = throughput.get(id) ?? 0;
				} catch (e) {
					errors.throughput = msg(e);
				}
			}

			// the list changed while we were fetching (filter switch); drop the result
			if (selector !== this.selectorFor(type)) return;

			this.enrichments = { ...this.enrichments, ...next };
			this.enrichErrorsByType[type] = errors;
			if (Object.keys(errors).length === 0) setCached(key, next);
		} finally {
			this.pages[type].enriching = false;
		}
	}

	private async envAnomalyDefault(force: boolean): Promise<unknown> {
		const key = `envdefault:${SERVICE_ANOMALY_SCHEMA}`;
		if (!force) {
			const hit = getCached<unknown>(key, ENTITY_TTL_MS);
			if (hit) return hit.value;
		}
		const value = await getEnvironmentDefaultValue(SERVICE_ANOMALY_SCHEMA);
		setCached(key, value);
		return value;
	}

	/** Add tags via the API, then patch in-memory rows and all cached lists. */
	async tagEntities(
		entityIds: string[],
		tags: TagInput[],
		onProgress?: (done: number, total: number) => void
	): Promise<number> {
		const matched = await addTags(entityIds, tags, onProgress);
		this.patchTags(entityIds, tags);
		return matched;
	}

	private patchTags(entityIds: string[], tags: TagInput[]): void {
		const idSet = new Set(entityIds);
		const added: DtTag[] = tags.map((t) => ({
			context: 'CONTEXTLESS',
			key: t.key,
			...(t.value ? { value: t.value } : {}),
			stringRepresentation: t.value ? `${t.key}:${t.value}` : t.key
		}));
		const patch = (e: DtEntity): DtEntity =>
			idSet.has(e.entityId) ? { ...e, tags: mergeTags(e.tags ?? [], added) } : e;

		for (const t of ENTITY_TYPES) {
			this.pages[t].entities = this.pages[t].entities.map(patch);
		}
		updateCachedByPrefix<CachedList>('entities:', (list) => ({
			...list,
			entities: list.entities.map(patch)
		}));
	}
}

function mergeTags(existing: DtTag[], added: DtTag[]): DtTag[] {
	const seen = new Set(existing.map(tagLabel));
	return [...existing, ...added.filter((t) => !seen.has(tagLabel(t)))];
}

export function tagLabel(tag: DtTag): string {
	return tag.stringRepresentation ?? (tag.value ? `${tag.key}:${tag.value}` : tag.key);
}

/** "WEB_REQUEST_SERVICE" → "Web request service" */
export function humanizeConstant(constant: string): string {
	const s = constant.replace(/_/g, ' ').toLowerCase();
	return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * Compact summary of builtin:anomaly-detection.services value, defensive about
 * shape so a tenant-side schema change degrades to a shorter string, not a crash.
 */
function detectionSummary(value: unknown): string {
	if (!value || typeof value !== 'object') return '';
	const v = value as Record<string, { enabled?: boolean; detectionMode?: string } | undefined>;
	const part = (label: string, s?: { enabled?: boolean; detectionMode?: string }) => {
		if (!s || typeof s !== 'object') return null;
		if (!s.enabled) return `${label} off`;
		return s.detectionMode ? `${label} ${s.detectionMode.toLowerCase().replace(/_/g, ' ')}` : `${label} on`;
	};
	return [
		part('failure', v.failureRate),
		part('resp', v.responseTime),
		part('load↑', v.loadSpikes),
		part('load↓', v.loadDrops)
	]
		.filter(Boolean)
		.join(' · ');
}

/** Per-type detail for the list's "Type" column: serviceType, osType, or PG technologies. */
export function entityTypeDetail(e: DtEntity): string {
	const p = e.properties;
	if (!p) return '';
	if (p.serviceType) return humanizeConstant(p.serviceType);
	if (p.osType) return humanizeConstant(p.osType);
	if (p.softwareTechnologies?.length) {
		const types = [...new Set(p.softwareTechnologies.map((t) => t.type).filter(Boolean))];
		return types.map((t) => humanizeConstant(t as string)).join(', ');
	}
	return '';
}

export const entityList = new EntityListStore();
