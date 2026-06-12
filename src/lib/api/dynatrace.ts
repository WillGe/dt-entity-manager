import { connection } from '$lib/stores/connection.svelte';
import type {
	CallEdgesResult,
	DetectionSettingsSection,
	EntityFilters,
	EntityPage,
	EntityType,
	TagInput
} from '$lib/types';

export class DtApiError extends Error {
	status: number;
	retryAfterSeconds?: number;

	constructor(status: number, message: string, retryAfterSeconds?: number) {
		super(message);
		this.status = status;
		this.retryAfterSeconds = retryAfterSeconds;
	}
}

const MAX_RETRY_WAIT_S = 60;

async function dtFetch<T>(
	path: string,
	opts: {
		params?: Record<string, string>;
		method?: 'GET' | 'POST';
		body?: unknown;
		headers?: Record<string, string>;
	} = {}
): Promise<T> {
	const qs = new URLSearchParams(opts.params ?? {}).toString();

	for (let attempt = 0; ; attempt++) {
		const res = await fetch(`/api/dt/${path}${qs ? `?${qs}` : ''}`, {
			method: opts.method ?? 'GET',
			headers: {
				...(opts.headers ?? connection.headers()),
				...(opts.body !== undefined ? { 'Content-Type': 'application/json' } : {})
			},
			body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined
		});

		if (res.ok) {
			const text = await res.text();
			return (text ? JSON.parse(text) : undefined) as T;
		}

		const retryAfter = res.headers.get('retry-after');

		// Honor Retry-After once so batch operations survive a rate-limit hit.
		if (res.status === 429 && attempt === 0) {
			const waitS = Math.min(Number(retryAfter) || 5, MAX_RETRY_WAIT_S);
			await new Promise((resolve) => setTimeout(resolve, waitS * 1000));
			continue;
		}

		let message = `${res.status} ${res.statusText}`;
		try {
			const data = (await res.json()) as { error?: { message?: string } };
			if (data?.error?.message) message = data.error.message;
		} catch {
			// non-JSON error body, keep the status text
		}
		if (res.status === 401) message = 'Authentication failed — check your API token and its scopes.';
		if (res.status === 403)
			message += " Scopes can't be added to an existing token — create a new token with the missing scope and update it under Connection.";
		if (res.status === 429) message = `Dynatrace rate limit reached${retryAfter ? `, retry in ${retryAfter}s` : ''}.`;
		throw new DtApiError(res.status, message, retryAfter ? Number(retryAfter) : undefined);
	}
}

/** Strip quotes so user input can't break out of selector string literals. */
function sel(value: string): string {
	return value.trim().replace(/"/g, '');
}

export function buildEntitySelector(type: EntityType, filters: EntityFilters): string {
	const parts = [`type("${type}")`];
	const name = sel(filters.name);
	if (name) parts.push(`entityName.startsWith("${name}")`);
	for (const t of filters.tags) {
		const tag = sel(t);
		if (tag) parts.push(`tag("${tag}")`);
	}
	if (filters.mzName) parts.push(`mzName("${sel(filters.mzName)}")`);
	if (filters.healthState) parts.push(`healthState("${filters.healthState}")`);
	if (type === 'SERVICE' && filters.serviceType)
		parts.push(`serviceType("${sel(filters.serviceType)}")`);
	return parts.join(',');
}

const PAGE_SIZE = 200;

/** Per-type entity property requested for the list's "Type" column. */
const TYPE_DETAIL_FIELD: Record<EntityType, string> = {
	SERVICE: '+properties.serviceType',
	HOST: '+properties.osType',
	PROCESS_GROUP: '+properties.softwareTechnologies'
};

export async function listEntities(
	selector: string,
	type: EntityType,
	nextPageKey?: string
): Promise<EntityPage> {
	// Dynatrace requires follow-up pages to be requested with nextPageKey only.
	const params: Record<string, string> = nextPageKey
		? { nextPageKey }
		: {
				entitySelector: selector,
				fields: `+tags,+managementZones,+lastSeenTms,${TYPE_DETAIL_FIELD[type]}`,
				pageSize: String(PAGE_SIZE)
			};
	return dtFetch<EntityPage>('entities', { params });
}

const TAG_CHUNK_SIZE = 50;

function chunks<T>(arr: T[], size: number): T[][] {
	const out: T[][] = [];
	for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
	return out;
}

function idSelector(ids: string[]): string {
	return `entityId(${ids.map((id) => `"${id}"`).join(',')})`;
}

export async function addTags(
	entityIds: string[],
	tags: TagInput[],
	onProgress?: (done: number, total: number) => void
): Promise<number> {
	let matched = 0;
	for (let i = 0; i < entityIds.length; i += TAG_CHUNK_SIZE) {
		const chunk = entityIds.slice(i, i + TAG_CHUNK_SIZE);
		const selector = idSelector(chunk);
		const res = await dtFetch<{ matchedEntitiesCount?: number }>('tags', {
			method: 'POST',
			params: { entitySelector: selector },
			body: { tags: tags.map((t) => ({ key: t.key, ...(t.value ? { value: t.value } : {}) })) }
		});
		matched += res.matchedEntitiesCount ?? chunk.length;
		onProgress?.(Math.min(i + TAG_CHUNK_SIZE, entityIds.length), entityIds.length);
	}
	return matched;
}

interface SchemaRef {
	id: string;
	title: string;
	/** whether the schema also has an environment-wide default object to fall back to */
	environmentScope: boolean;
}

export const SERVICE_ANOMALY_SCHEMA = 'builtin:anomaly-detection.services';

export const DETECTION_SCHEMAS: Record<EntityType, SchemaRef[]> = {
	SERVICE: [
		{ id: SERVICE_ANOMALY_SCHEMA, title: 'Anomaly detection', environmentScope: true },
		{
			id: 'builtin:failure-detection.service.general-parameters',
			title: 'Failure detection — general parameters',
			environmentScope: true
		},
		{
			id: 'builtin:failure-detection.service.http-parameters',
			title: 'Failure detection — HTTP parameters',
			environmentScope: true
		}
	],
	HOST: [
		{
			id: 'builtin:anomaly-detection.infrastructure-hosts',
			title: 'Anomaly detection (infrastructure)',
			environmentScope: true
		}
	],
	PROCESS_GROUP: [
		{
			id: 'builtin:availability.process-group-alerting',
			title: 'Process group availability monitoring',
			environmentScope: false
		}
	]
};

export async function getDetectionSettings(entity: {
	entityId: string;
	type: EntityType;
}): Promise<DetectionSettingsSection[]> {
	const sections: DetectionSettingsSection[] = [];
	for (const schema of DETECTION_SCHEMAS[entity.type]) {
		sections.push(await fetchSection(schema, entity.entityId));
	}
	return sections;
}

async function fetchSection(schema: SchemaRef, entityId: string): Promise<DetectionSettingsSection> {
	const base = { schemaId: schema.id, title: schema.title };
	try {
		const entityScoped = await listSettingsValues(schema.id, entityId);
		if (entityScoped.length > 0) {
			return { ...base, scope: 'entity', value: unwrap(entityScoped) };
		}
		if (schema.environmentScope) {
			const envScoped = await listSettingsValues(schema.id, 'environment');
			if (envScoped.length > 0) {
				return { ...base, scope: 'environment', value: unwrap(envScoped) };
			}
		}
		return { ...base, scope: 'none' };
	} catch (e) {
		return { ...base, scope: 'none', error: e instanceof Error ? e.message : String(e) };
	}
}

async function listSettingsValues(schemaId: string, scope: string): Promise<unknown[]> {
	const res = await dtFetch<{ items?: { value: unknown }[] }>('settings/objects', {
		params: { schemaIds: schemaId, scopes: scope, fields: 'value', pageSize: '25' }
	});
	return (res.items ?? []).map((i) => i.value);
}

function unwrap(values: unknown[]): unknown {
	return values.length === 1 ? values[0] : values;
}

const BATCH_CHUNK_SIZE = 50;

/**
 * Map of entityId → settings objects scoped *directly* to it. An entity present
 * in the map overrides the environment defaults; an absent one inherits them.
 */
export async function getDetectionOverrides(
	type: EntityType,
	entityIds: string[]
): Promise<Map<string, { schemaId: string; value: unknown }[]>> {
	const schemaIds = DETECTION_SCHEMAS[type].map((s) => s.id).join(',');
	const result = new Map<string, { schemaId: string; value: unknown }[]>();
	for (const chunk of chunks(entityIds, BATCH_CHUNK_SIZE)) {
		const res = await dtFetch<{ items?: { scope: string; schemaId: string; value: unknown }[] }>(
			'settings/objects',
			{
				params: {
					schemaIds,
					scopes: chunk.join(','),
					fields: 'scope,schemaId,value',
					pageSize: '500'
				}
			}
		);
		for (const item of res.items ?? []) {
			const list = result.get(item.scope) ?? [];
			list.push({ schemaId: item.schemaId, value: item.value });
			result.set(item.scope, list);
		}
	}
	return result;
}

/** Environment-wide default settings object for a schema, or null if none exists. */
export async function getEnvironmentDefaultValue(schemaId: string): Promise<unknown> {
	const values = await listSettingsValues(schemaId, 'environment');
	return values.length > 0 ? unwrap(values) : null;
}

/** Count of OPEN problems per entity. Requires the problems.read token scope. */
export async function getOpenProblemCounts(entityIds: string[]): Promise<Map<string, number>> {
	const wanted = new Set(entityIds);
	const counts = new Map<string, number>();
	for (const chunk of chunks(entityIds, BATCH_CHUNK_SIZE)) {
		let nextPageKey: string | undefined;
		// page cap so a tenant-wide problem storm can't loop forever
		for (let page = 0; page < 5; page++) {
			const params: Record<string, string> = nextPageKey
				? { nextPageKey }
				: {
						problemSelector: 'status("open")',
						entitySelector: idSelector(chunk),
						from: 'now-90d',
						pageSize: '500'
					};
			const res = await dtFetch<{
				problems?: { affectedEntities?: { entityId?: { id?: string } }[] }[];
				nextPageKey?: string;
			}>('problems', { params });
			for (const p of res.problems ?? []) {
				for (const ae of p.affectedEntities ?? []) {
					const id = ae.entityId?.id;
					if (id && wanted.has(id)) counts.set(id, (counts.get(id) ?? 0) + 1);
				}
			}
			nextPageKey = res.nextPageKey;
			if (!nextPageKey) break;
		}
	}
	return counts;
}

export const THROUGHPUT_WINDOW_MIN = 120;

/** Requests per minute per service over the lookback window. Requires metrics.read. */
export async function getServiceThroughput(entityIds: string[]): Promise<Map<string, number>> {
	const result = new Map<string, number>();
	for (const chunk of chunks(entityIds, BATCH_CHUNK_SIZE)) {
		const res = await dtFetch<{
			result?: {
				data?: {
					dimensionMap?: Record<string, string>;
					dimensions?: string[];
					values?: (number | null)[];
				}[];
			}[];
		}>('metrics/query', {
			params: {
				metricSelector: 'builtin:service.requestCount.total:splitBy("dt.entity.service"):sum',
				entitySelector: `type("SERVICE"),${idSelector(chunk)}`,
				from: `now-${THROUGHPUT_WINDOW_MIN}m`,
				resolution: 'Inf'
			}
		});
		for (const series of res.result?.[0]?.data ?? []) {
			const id = series.dimensionMap?.['dt.entity.service'] ?? series.dimensions?.[0];
			const total = (series.values ?? []).find((v) => v !== null);
			if (id && typeof total === 'number') result.set(id, total / THROUGHPUT_WINDOW_MIN);
		}
	}
	return result;
}

/**
 * Two-hop call topology around one service: the focus, its direct callers and
 * callees, and theirs. The outermost services contribute their outbound calls
 * (so bridging through hidden middlemen keeps working) but are not expanded
 * further; edges to services we have no name for are pruned to keep the
 * universe bounded.
 */
export async function getServiceNeighborhood(entityId: string): Promise<CallEdgesResult> {
	const calls: Record<string, string[]> = {};
	const names: Record<string, string> = {};
	/** inbound callers per service; only used to grow the neighborhood */
	const callers: Record<string, string[]> = {};

	const serviceIds = (rels?: { id: string }[]) =>
		(rels ?? []).map((r) => r.id).filter((id) => id?.startsWith('SERVICE-'));

	const fetchBatch = async (ids: string[]) => {
		for (const chunk of chunks(ids, BATCH_CHUNK_SIZE)) {
			const res = await dtFetch<{
				entities?: {
					entityId: string;
					displayName: string;
					fromRelationships?: { calls?: { id: string }[] };
					toRelationships?: { calls?: { id: string }[]; calledBy?: { id: string }[] };
				}[];
			}>('entities', {
				params: {
					entitySelector: idSelector(chunk),
					fields: '+fromRelationships.calls,+toRelationships.calls',
					pageSize: '100'
				}
			});
			for (const e of res.entities ?? []) {
				names[e.entityId] = e.displayName;
				calls[e.entityId] = serviceIds(e.fromRelationships?.calls);
				callers[e.entityId] = serviceIds(e.toRelationships?.calls ?? e.toRelationships?.calledBy);
			}
		}
	};

	let frontier = [entityId];
	for (let hop = 0; hop <= 2 && frontier.length > 0; hop++) {
		await fetchBatch(frontier);
		frontier = [
			...new Set(frontier.flatMap((id) => [...(calls[id] ?? []), ...(callers[id] ?? [])]))
		].filter((id) => !(id in names));
	}
	for (const id of Object.keys(calls)) calls[id] = calls[id].filter((t) => t in names);
	return { calls, names };
}

export async function listManagementZoneNames(): Promise<string[]> {
	const values = (await listSettingsValues('builtin:management-zones', 'environment')) as {
		name?: string;
	}[];
	return values
		.map((v) => v.name ?? '')
		.filter(Boolean)
		.sort((a, b) => a.localeCompare(b));
}

export interface ScopeCheck {
	scope: string;
	/** what the scope powers in the UI, e.g. "Problems column" */
	purpose: string;
	status: 'ok' | 'missing' | 'error';
	message?: string;
}

/**
 * Probe every documented token scope with the cheapest possible call (works on
 * unsaved credentials). The entities.write probe tags a selector that matches
 * nothing — Dynatrace checks the scope before matching, so nothing is changed.
 */
export async function testScopes(creds: {
	baseUrl: string;
	token: string;
}): Promise<ScopeCheck[]> {
	const headers = {
		'x-dt-base-url': creds.baseUrl.trim().replace(/\/+$/, ''),
		'x-dt-token': creds.token.trim()
	};
	const probes: { scope: string; purpose: string; run: () => Promise<unknown> }[] = [
		{
			scope: 'entities.read',
			purpose: 'entity list',
			run: () =>
				dtFetch('entities', { params: { entitySelector: 'type("HOST")', pageSize: '1' }, headers })
		},
		{
			scope: 'entities.write',
			purpose: 'tagging',
			run: () =>
				dtFetch('tags', {
					method: 'POST',
					params: { entitySelector: 'entityId("SERVICE-0000000000000000")' },
					body: { tags: [{ key: 'dtem-scope-probe' }] },
					headers
				})
		},
		{
			scope: 'settings.read',
			purpose: 'detection settings, MZ filter',
			run: () =>
				dtFetch('settings/objects', {
					params: {
						schemaIds: SERVICE_ANOMALY_SCHEMA,
						scopes: 'environment',
						fields: 'value',
						pageSize: '1'
					},
					headers
				})
		},
		{
			scope: 'problems.read',
			purpose: 'Problems column',
			run: () => dtFetch('problems', { params: { from: 'now-1h', pageSize: '1' }, headers })
		},
		{
			scope: 'metrics.read',
			purpose: 'Req/min column',
			run: () =>
				dtFetch('metrics/query', {
					params: {
						metricSelector: 'builtin:service.requestCount.total',
						from: 'now-5m',
						resolution: 'Inf'
					},
					headers
				})
		}
	];
	return Promise.all(
		probes.map(async ({ scope, purpose, run }) => {
			try {
				await run();
				return { scope, purpose, status: 'ok' as const };
			} catch (e) {
				const missing = e instanceof DtApiError && e.status === 403;
				return {
					scope,
					purpose,
					status: missing ? ('missing' as const) : ('error' as const),
					message: e instanceof Error ? e.message : String(e)
				};
			}
		})
	);
}
