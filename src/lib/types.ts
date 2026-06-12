export type EntityType = 'SERVICE' | 'HOST' | 'PROCESS_GROUP';

export interface DtTag {
	context?: string;
	key: string;
	value?: string;
	stringRepresentation?: string;
}

export interface DtManagementZone {
	id: string;
	name: string;
}

export interface DtEntityProperties {
	serviceType?: string;
	osType?: string;
	softwareTechnologies?: { type?: string; edition?: string; version?: string }[];
}

export interface DtEntity {
	entityId: string;
	displayName: string;
	type: EntityType;
	tags?: DtTag[];
	managementZones?: DtManagementZone[];
	properties?: DtEntityProperties;
	lastSeenTms?: number;
}

/** Batched per-row data fetched after the entity list itself. */
export interface RowEnrichment {
	/** schemaIds with an entity-scoped settings object; empty = inherits environment defaults */
	overriddenSchemas?: string[];
	/** compact anomaly-detection summary (services only), e.g. "failure auto · resp auto" */
	detectionSummary?: string;
	openProblems?: number;
	/** services only; requests per minute averaged over the lookback window */
	throughputPerMin?: number;
	/** services only; names of requests marked as key requests */
	keyRequests?: string[];
}

export interface EntityPage {
	entities: DtEntity[];
	totalCount: number;
	nextPageKey?: string;
}

export interface EntityFilters {
	name: string;
	tags: string[]; // "key" or "key:value"
	mzName: string;
	healthState: '' | 'HEALTHY' | 'UNHEALTHY';
	/** Service-type constant (e.g. WEB_REQUEST_SERVICE); only used on the Services tab. */
	serviceType: string;
}

export interface TagInput {
	key: string;
	value?: string;
}

/** Service call topology: adjacency + display names for every id involved. */
export interface CallEdgesResult {
	/** entityId → SERVICE ids it calls (includes one hop for out-of-list services) */
	calls: Record<string, string[]>;
	names: Record<string, string>;
	/** true when a fan-in/out or total-size cap cut the neighborhood short */
	truncated?: boolean;
}

/** One schema section of the detection-settings view for an entity. */
export interface DetectionSettingsSection {
	schemaId: string;
	title: string;
	/** 'entity' = configured on the entity, 'environment' = inherited default */
	scope: 'entity' | 'environment' | 'none';
	value?: unknown;
	error?: string;
}
