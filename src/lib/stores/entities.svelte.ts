import { SvelteSet } from 'svelte/reactivity';
import {
	addTags,
	buildEntitySelector,
	listEntities,
	listManagementZoneNames
} from '$lib/api/dynatrace';
import { getCached, setCached, updateCachedByPrefix } from '$lib/cache';
import type { DtEntity, DtTag, EntityFilters, EntityType, TagInput } from '$lib/types';

const ENTITY_TTL_MS = 30 * 60 * 1000;
const MZ_TTL_MS = 24 * 60 * 60 * 1000;

export const emptyFilters = (): EntityFilters => ({
	name: '',
	tags: [],
	mzName: '',
	healthState: ''
});

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

	selector = $derived(buildEntitySelector(this.type, this.filters));

	visible = $derived.by(() => {
		const q = this.quickFilter.trim().toLowerCase();
		if (!q) return this.entities;
		return this.entities.filter(
			(e) =>
				e.displayName.toLowerCase().includes(q) ||
				e.entityId.toLowerCase().includes(q) ||
				(e.tags ?? []).some((t) => tagLabel(t).toLowerCase().includes(q))
		);
	});

	async setType(type: EntityType): Promise<void> {
		if (this.type === type) return;
		this.type = type;
		this.selected.clear();
		await this.load();
	}

	async applyFilters(filters: EntityFilters): Promise<void> {
		this.filters = filters;
		this.selected.clear();
		await this.load();
	}

	async load(force = false): Promise<void> {
		this.loading = true;
		this.error = null;
		try {
			const key = `entities:${this.selector}`;
			if (!force) {
				const hit = getCached<CachedList>(key, ENTITY_TTL_MS);
				if (hit) {
					this.entities = hit.value.entities;
					this.totalCount = hit.value.totalCount;
					this.nextPageKey = hit.value.nextPageKey;
					this.fetchedAt = hit.fetchedAt;
					return;
				}
			}
			const page = await listEntities(this.selector);
			this.entities = page.entities ?? [];
			this.totalCount = page.totalCount;
			this.nextPageKey = page.nextPageKey ?? null;
			this.fetchedAt = Date.now();
			this.saveToCache();
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
			const page = await listEntities(this.selector, this.nextPageKey);
			this.entities = [...this.entities, ...(page.entities ?? [])];
			this.nextPageKey = page.nextPageKey ?? null;
			this.saveToCache();
		} finally {
			this.loadingMore = false;
		}
	}

	private saveToCache(): void {
		setCached<CachedList>(`entities:${this.selector}`, {
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

export const entityList = new EntityListStore();
