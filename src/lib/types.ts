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

export interface DtEntity {
	entityId: string;
	displayName: string;
	type: EntityType;
	tags?: DtTag[];
	managementZones?: DtManagementZone[];
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
}

export interface TagInput {
	key: string;
	value?: string;
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
