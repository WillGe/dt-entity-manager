import { SvelteSet } from 'svelte/reactivity';
import {
	addTags,
	buildEntitySelector,
	getDetectionOverrides,
	getEnvironmentDefaultValue,
	getOpenProblemCounts,
	getServiceThroughput,
	listEntities,
	listManagementZoneNames,
	SERVICE_ANOMALY_SCHEMA
} from '$lib/api/dynatrace';
import { getCached, setCached, updateCachedByPrefix } from '$lib/cache';
import type {
	DtEntity,
	DtTag,
	EntityFilters,
	EntityType,
	RowEnrichment,
	TagInput
} from '$lib/types';

const ENTITY_TTL_MS = 30 * 60 * 1000;
const MZ_TTL_MS = 24 * 60 * 60 * 1000;
const VIEW_KEY = 'dtem:view';

const ENTITY_TYPES: EntityType[] = ['SERVICE', 'HOST', 'PROCESS_GROUP'];

export const emptyFilters = (): EntityFilters => ({
	name: '',
	tags: [],
	mzName: '',
	healthState: '',
	serviceType: ''
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

class EntityListStore {
	type = $state<EntityType>('SERVICE');
	/** Server-side filters, applied explicitly via the filter bar. */
	filters = $state<EntityFilters>(emptyFilters());
	/** Client-side substring filter over the loaded rows; never triggers API calls. */
	quickFilter = $state('');

	entities = $state<DtEntity[]>([]);
	totalCount = $state(0);
	nextPageKey = $state<string | null>(null);
	fetchedAt = $state<number | null>(null);
	loading = $state(false);
	loadingMore = $state(false);
	error = $state<string | null>(null);
	selected = new SvelteSet<string>();
	mzNames = $state<string[]>([]);

	/** Per-row batched extras (detection overrides, problems, throughput), keyed by entityId. */
	enrichments = $state<Record<string, RowEnrichment>>({});
	enrichErrors = $state<EnrichErrors>({});
	enriching = $state(false);

	selector = $derived(buildEntitySelector(this.type, this.filters));

	constructor() {
		// restore last-used tab + filters across reloads
		const raw = localStorage.getItem(VIEW_KEY);
		if (raw) {
			try {
				const view = JSON.parse(raw) as { type?: EntityType; filters?: Partial<EntityFilters> };
				if (view.type && ENTITY_TYPES.includes(view.type)) this.type = view.type;
				if (view.filters) this.filters = { ...emptyFilters(), ...view.filters };
			} catch {
				localStorage.removeItem(VIEW_KEY);
			}
		}
	}

	private persistView(): void {
		localStorage.setItem(VIEW_KEY, JSON.stringify({ type: this.type, filters: this.filters }));
	}

	visible = $derived.by(() => {
		const q = this.quickFilter.trim().toLowerCase();
		if (!q) return this.entities;
		return this.entities.filter(
			(e) =>
				e.displayName.toLowerCase().includes(q) ||
				e.entityId.toLowerCase().includes(q) ||
				entityTypeDetail(e).toLowerCase().includes(q) ||
				(e.tags ?? []).some((t) => tagLabel(t).toLowerCase().includes(q))
		);
	});

	async setType(type: EntityType): Promise<void> {
		if (this.type === type) return;
		this.type = type;
		this.selected.clear();
		this.persistView();
		await this.load();
	}

	async applyFilters(filters: EntityFilters): Promise<void> {
		this.filters = filters;
		this.selected.clear();
		this.persistView();
		await this.load();
	}

	async load(force = false): Promise<void> {
		this.loading = true;
		this.error = null;
		try {
			const key = `${LIST_CACHE_PREFIX}${this.selector}`;
			if (!force) {
				const hit = getCached<CachedList>(key, ENTITY_TTL_MS);
				if (hit) {
					this.entities = hit.value.entities;
					this.totalCount = hit.value.totalCount;
					this.nextPageKey = hit.value.nextPageKey;
					this.fetchedAt = hit.fetchedAt;
					void this.loadEnrichments();
					return;
				}
			}
			const page = await listEntities(this.selector, this.type);
			this.entities = page.entities ?? [];
			this.totalCount = page.totalCount;
			this.nextPageKey = page.nextPageKey ?? null;
			this.fetchedAt = Date.now();
			this.saveToCache();
			void this.loadEnrichments(force);
		} catch (e) {
			this.error = e instanceof Error ? e.message : String(e);
			throw e;
		} finally {
			this.loading = false;
		}
	}

	async loadMore(): Promise<void> {
		if (!this.nextPageKey || this.loadingMore) return;
		this.loadingMore = true;
		try {
			const page = await listEntities(this.selector, this.type, this.nextPageKey);
			this.entities = [...this.entities, ...(page.entities ?? [])];
			this.nextPageKey = page.nextPageKey ?? null;
			this.saveToCache();
			void this.loadEnrichments();
		} finally {
			this.loadingMore = false;
		}
	}

	private saveToCache(): void {
		setCached<CachedList>(`${LIST_CACHE_PREFIX}${this.selector}`, {
			entities: this.entities,
			totalCount: this.totalCount,
			nextPageKey: this.nextPageKey
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
	 * Fetch batched per-row extras for the loaded list. Each source fails
	 * independently (e.g. missing problems.read/metrics.read token scope) and
	 * reports into enrichErrors; the rest of the columns still populate.
	 */
	async loadEnrichments(force = false): Promise<void> {
		const selector = this.selector;
		const ids = this.entities.map((e) => e.entityId);
		if (ids.length === 0) {
			this.enrichments = {};
			return;
		}
		const key = `enrich:${LIST_CACHE_PREFIX}${selector}`;
		if (!force) {
			const hit = getCached<Record<string, RowEnrichment>>(key, ENRICH_TTL_MS);
			if (hit && ids.every((id) => id in hit.value)) {
				this.enrichments = hit.value;
				this.enrichErrors = {};
				return;
			}
		}

		this.enriching = true;
		const errors: EnrichErrors = {};
		const next: Record<string, RowEnrichment> = {};
		for (const id of ids) next[id] = {};
		const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

		try {
			const overrides = await getDetectionOverrides(this.type, ids);
			const envDefault =
				this.type === 'SERVICE' ? await this.envAnomalyDefault(force) : null;
			for (const id of ids) {
				const objs = overrides.get(id) ?? [];
				next[id].overriddenSchemas = objs.map((o) => o.schemaId);
				if (this.type === 'SERVICE') {
					const own = objs.find((o) => o.schemaId === SERVICE_ANOMALY_SCHEMA)?.value;
					next[id].detectionSummary = detectionSummary(own ?? envDefault);
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

		if (this.type === 'SERVICE') {
			try {
				const throughput = await getServiceThroughput(ids);
				for (const id of ids) next[id].throughputPerMin = throughput.get(id) ?? 0;
			} catch (e) {
				errors.throughput = msg(e);
			}
		}

		// the list changed while we were fetching (tab/filter switch); drop the result
		if (selector !== this.selector) return;

		this.enrichments = next;
		this.enrichErrors = errors;
		this.enriching = false;
		if (Object.keys(errors).length === 0) setCached(key, next);
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

		this.entities = this.entities.map(patch);
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
