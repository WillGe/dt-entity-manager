import { connection } from '$lib/stores/connection.svelte';
import type {
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
				fields: `+tags,+managementZones,${TYPE_DETAIL_FIELD[type]}`,
				pageSize: String(PAGE_SIZE)
			};
	return dtFetch<EntityPage>('entities', { params });
}

const TAG_CHUNK_SIZE = 50;

export async function addTags(
	entityIds: string[],
	tags: TagInput[],
	onProgress?: (done: number, total: number) => void
): Promise<number> {
	let matched = 0;
	for (let i = 0; i < entityIds.length; i += TAG_CHUNK_SIZE) {
		const chunk = entityIds.slice(i, i + TAG_CHUNK_SIZE);
		const selector = `entityId(${chunk.map((id) => `"${id}"`).join(',')})`;
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

const DETECTION_SCHEMAS: Record<EntityType, SchemaRef[]> = {
	SERVICE: [
		{ id: 'builtin:anomaly-detection.services', title: 'Anomaly detection', environmentScope: true },
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

export async function listManagementZoneNames(): Promise<string[]> {
	const values = (await listSettingsValues('builtin:management-zones', 'environment')) as {
		name?: string;
	}[];
	return values
		.map((v) => v.name ?? '')
		.filter(Boolean)
		.sort((a, b) => a.localeCompare(b));
}

/** Cheapest possible call to validate URL + token (works on unsaved credentials). */
export async function testConnection(creds: { baseUrl: string; token: string }): Promise<void> {
	await dtFetch('entities', {
		params: { entitySelector: 'type("HOST")', pageSize: '1' },
		headers: { 'x-dt-base-url': creds.baseUrl.trim().replace(/\/+$/, ''), 'x-dt-token': creds.token.trim() }
	});
}
