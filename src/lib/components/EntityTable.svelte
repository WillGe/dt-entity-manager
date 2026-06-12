<script lang="ts">
	import { DETECTION_SCHEMAS } from '$lib/api/dynatrace';
	import { connection } from '$lib/stores/connection.svelte';
	import {
		emptyColumnFilters,
		entityList,
		entityTypeDetail,
		tagLabel
	} from '$lib/stores/entities.svelte';
	import type { ColumnId, DtEntity, EntityType } from '$lib/types';

	let {
		ontag,
		onsettings,
		ongraph
	}: {
		ontag: (entity: DtEntity) => void;
		onsettings: (entity: DtEntity) => void;
		ongraph: (entity: DtEntity) => void;
	} = $props();

	const schemaTitles: Record<string, string> = Object.fromEntries(
		Object.values(DETECTION_SCHEMAS)
			.flat()
			.map((s) => [s.id, s.title])
	);

	const KIND_LABEL: Record<EntityType, string> = {
		SERVICE: 'Service',
		HOST: 'Host',
		PROCESS_GROUP: 'Process group'
	};
	const KIND_ABBR: Record<EntityType, string> = {
		SERVICE: 'SVC',
		HOST: 'HOST',
		PROCESS_GROUP: 'PG'
	};

	const hasServices = $derived(entityList.types.includes('SERVICE'));
	const colCount = $derived(11 + (hasServices ? 2 : 0));

	/** Zone names present in the loaded rows (pre-filter, so options don't vanish while filtering). */
	const mzOptions = $derived(
		[...new Set(entityList.entities.flatMap((e) => (e.managementZones ?? []).map((m) => m.name)))].sort()
	);

	function relTime(ts?: number): string {
		if (!ts) return '—';
		const min = Math.max(0, (Date.now() - ts) / 60000);
		if (min < 1.5) return 'just now';
		if (min < 90) return `${Math.round(min)} min ago`;
		const h = min / 60;
		if (h < 36) return `${Math.round(h)} h ago`;
		return `${Math.round(h / 24)} d ago`;
	}

	function fmtPerMin(n: number): string {
		return new Intl.NumberFormat(undefined, {
			maximumFractionDigits: n < 1 ? 2 : n < 100 ? 1 : 0
		}).format(n);
	}

	function overrideTitle(schemaIds: string[]): string {
		if (schemaIds.length === 0) return 'Inherits the environment defaults';
		return `Overrides: ${schemaIds.map((id) => schemaTitles[id] ?? id).join(', ')}`;
	}

	function arrow(col: ColumnId): string {
		if (entityList.sort?.col !== col) return '';
		return entityList.sort.dir === 'asc' ? '▲' : '▼';
	}

	function clearColumnFilters() {
		entityList.columnFilters = emptyColumnFilters();
		entityList.persistColumnFilters();
	}

	const columnFiltersActive = $derived(
		Object.values(entityList.columnFilters).some((v) => v !== '')
	);

	const allVisibleSelected = $derived(
		entityList.visible.length > 0 &&
			entityList.visible.every((e) => entityList.selected.has(e.entityId))
	);

	function toggleAll() {
		if (allVisibleSelected) {
			for (const e of entityList.visible) entityList.selected.delete(e.entityId);
		} else {
			for (const e of entityList.visible) entityList.selected.add(e.entityId);
		}
	}

	function toggle(entityId: string) {
		if (entityList.selected.has(entityId)) entityList.selected.delete(entityId);
		else entityList.selected.add(entityId);
	}
</script>

<div class="wrap">
	<table class="table">
		<thead>
			<tr>
				<th class="check">
					<input
						type="checkbox"
						checked={allVisibleSelected}
						onchange={toggleAll}
						aria-label="Select all visible"
					/>
				</th>
				<th>
					<button class="sort" onclick={() => entityList.cycleSort('kind')}>
						Kind {arrow('kind')}
					</button>
				</th>
				<th>
					<button class="sort" onclick={() => entityList.cycleSort('name')}>
						Name {arrow('name')}
					</button>
				</th>
				<th>
					<button class="sort" onclick={() => entityList.cycleSort('entityId')}>
						Entity ID {arrow('entityId')}
					</button>
				</th>
				<th>
					<button class="sort" onclick={() => entityList.cycleSort('typeDetail')}>
						Type {arrow('typeDetail')}
					</button>
				</th>
				<th>
					<button class="sort" onclick={() => entityList.cycleSort('detection')}>
						Detection {arrow('detection')}
					</button>
					{#if entityList.enrichErrors.detection}
						<span class="warn" title={entityList.enrichErrors.detection}>⚠</span>
					{/if}
				</th>
				<th class="num" title="Open problems (last 90 days)">
					<button class="sort" onclick={() => entityList.cycleSort('problems')}>
						Problems {arrow('problems')}
					</button>
					{#if entityList.enrichErrors.problems}
						<span class="warn" title={entityList.enrichErrors.problems}>⚠</span>
					{/if}
				</th>
				{#if hasServices}
					<th class="num" title="Average requests per minute over the last 2 h">
						<button class="sort" onclick={() => entityList.cycleSort('reqPerMin')}>
							Req/min {arrow('reqPerMin')}
						</button>
						{#if entityList.enrichErrors.throughput}
							<span class="warn" title={entityList.enrichErrors.throughput}>⚠</span>
						{/if}
					</th>
					<th class="num" title="Requests marked as key requests (hover a count for the names)">
						<button class="sort" onclick={() => entityList.cycleSort('keyReqs')}>
							Key reqs {arrow('keyReqs')}
						</button>
						{#if entityList.enrichErrors.detection}
							<span class="warn" title={entityList.enrichErrors.detection}>⚠</span>
						{/if}
					</th>
				{/if}
				<th>
					<button class="sort" onclick={() => entityList.cycleSort('lastSeen')}>
						Last seen {arrow('lastSeen')}
					</button>
				</th>
				<th>
					<button class="sort" onclick={() => entityList.cycleSort('tags')}>
						Tags {arrow('tags')}
					</button>
				</th>
				<th>
					<button class="sort" onclick={() => entityList.cycleSort('mz')}>
						Management zones {arrow('mz')}
					</button>
				</th>
				<th class="actions-col">Actions</th>
			</tr>
			{#if entityList.showColumnFilters}
				<tr class="filter-row">
					<th class="check">
						<button
							class="btn btn-sm"
							onclick={clearColumnFilters}
							disabled={!columnFiltersActive}
							title="Clear view filters"
						>
							✕
						</button>
					</th>
					<th>
						{#if entityList.types.length > 1}
							<select
								class="select cf"
								bind:value={entityList.columnFilters.kind}
								onchange={() => entityList.persistColumnFilters()}
								aria-label="Filter by kind"
							>
								<option value="">Any</option>
								{#each entityList.types as t (t)}
									<option value={t}>{KIND_LABEL[t]}</option>
								{/each}
							</select>
						{/if}
					</th>
					<th>
						<input
							class="input cf"
							placeholder="contains…"
							bind:value={entityList.columnFilters.name}
							oninput={() => entityList.persistColumnFilters()}
							aria-label="Filter by name"
						/>
					</th>
					<th>
						<input
							class="input cf"
							placeholder="contains…"
							bind:value={entityList.columnFilters.entityId}
							oninput={() => entityList.persistColumnFilters()}
							aria-label="Filter by entity ID"
						/>
					</th>
					<th>
						<input
							class="input cf"
							placeholder="contains…"
							bind:value={entityList.columnFilters.typeDetail}
							oninput={() => entityList.persistColumnFilters()}
							aria-label="Filter by type detail"
						/>
					</th>
					<th>
						<select
							class="select cf"
							bind:value={entityList.columnFilters.detection}
							onchange={() => entityList.persistColumnFilters()}
							aria-label="Filter by detection"
						>
							<option value="">Any</option>
							<option value="custom">Custom</option>
							<option value="default">Default</option>
						</select>
					</th>
					<th>
						<select
							class="select cf"
							bind:value={entityList.columnFilters.problems}
							onchange={() => entityList.persistColumnFilters()}
							aria-label="Filter by problems"
						>
							<option value="">Any</option>
							<option value="has">Has problems</option>
							<option value="none">No problems</option>
						</select>
					</th>
					{#if hasServices}
						<th></th>
						<th></th>
					{/if}
					<th></th>
					<th>
						<input
							class="input cf"
							placeholder="contains…"
							bind:value={entityList.columnFilters.tags}
							oninput={() => entityList.persistColumnFilters()}
							aria-label="Filter by tag"
						/>
					</th>
					<th>
						<select
							class="select cf"
							bind:value={entityList.columnFilters.mz}
							onchange={() => entityList.persistColumnFilters()}
							aria-label="Filter by management zone"
						>
							<option value="">Any</option>
							{#each mzOptions as name (name)}
								<option value={name}>{name}</option>
							{/each}
							{#if entityList.columnFilters.mz && !mzOptions.includes(entityList.columnFilters.mz)}
								<option value={entityList.columnFilters.mz}>{entityList.columnFilters.mz}</option>
							{/if}
						</select>
					</th>
					<th></th>
				</tr>
			{/if}
		</thead>
		<tbody>
			{#if entityList.loading && entityList.entities.length === 0}
				<tr><td colspan={colCount} class="state">Loading entities…</td></tr>
			{:else if entityList.error && entityList.entities.length === 0}
				<tr><td colspan={colCount} class="state error">{entityList.error}</td></tr>
			{:else if entityList.visible.length === 0}
				<tr>
					<td colspan={colCount} class="state">
						{entityList.entities.length === 0
							? 'No entities match the current filters.'
							: 'No loaded entities match the view filters.'}
					</td>
				</tr>
			{:else}
				{#each entityList.visible as entity (entity.entityId)}
					{@const enr = entityList.enrichments[entity.entityId]}
					{@const enriching = entityList.pages[entity.type].enriching}
					{@const zones = entity.managementZones ?? []}
					<tr>
						<td class="check">
							<input
								type="checkbox"
								checked={entityList.selected.has(entity.entityId)}
								onchange={() => toggle(entity.entityId)}
								aria-label="Select {entity.displayName}"
							/>
						</td>
						<td class="kind">
							<span class="badge badge-none" title={KIND_LABEL[entity.type]}>
								{KIND_ABBR[entity.type]}
							</span>
						</td>
						<td class="name">
							<a
								href="{connection.baseUrl}/ui/entity/{entity.entityId}"
								target="_blank"
								rel="noopener noreferrer"
								title="Open in Dynatrace"
							>
								{entity.displayName}
							</a>
						</td>
						<td><code>{entity.entityId}</code></td>
						<td class="type-detail">{entityTypeDetail(entity) || '—'}</td>
						<td class="det">
							{#if enr?.overriddenSchemas}
								<span
									class="badge {enr.overriddenSchemas.length ? 'badge-entity' : 'badge-environment'}"
									title={overrideTitle(enr.overriddenSchemas)}
								>
									{enr.overriddenSchemas.length ? 'custom' : 'default'}
								</span>
								{#if enr.detectionSummary}
									<div class="det-summary">{enr.detectionSummary}</div>
								{/if}
							{:else}
								<span class="muted">{enriching ? '…' : '—'}</span>
							{/if}
						</td>
						<td class="num">
							{#if enr?.openProblems !== undefined}
								<span class:has-problems={enr.openProblems > 0}>{enr.openProblems}</span>
							{:else}
								<span class="muted">{enriching ? '…' : '—'}</span>
							{/if}
						</td>
						{#if hasServices}
							<td class="num">
								{#if entity.type !== 'SERVICE'}
									<span class="muted">—</span>
								{:else if enr?.throughputPerMin !== undefined}
									{fmtPerMin(enr.throughputPerMin)}
								{:else}
									<span class="muted">{enriching ? '…' : '—'}</span>
								{/if}
							</td>
							<td class="num">
								{#if entity.type !== 'SERVICE'}
									<span class="muted">—</span>
								{:else if enr?.keyRequests !== undefined}
									{#if enr.keyRequests.length > 0}
										<span class="key-reqs" title={enr.keyRequests.join('\n')}>
											{enr.keyRequests.length}
										</span>
									{:else}
										<span class="muted">—</span>
									{/if}
								{:else}
									<span class="muted">{enriching ? '…' : '—'}</span>
								{/if}
							</td>
						{/if}
						<td class="last-seen" title={entity.lastSeenTms ? new Date(entity.lastSeenTms).toLocaleString() : undefined}>
							{relTime(entity.lastSeenTms)}
						</td>
						<td>
							<div class="chips">
								{#each entity.tags ?? [] as tag (tagLabel(tag))}
									<span class="chip" title={tagLabel(tag)}>{tagLabel(tag)}</span>
								{:else}
									<span class="muted">—</span>
								{/each}
							</div>
						</td>
						<td class="mz" title={zones.length ? zones.map((m) => m.name).join(', ') : undefined}>
							{#if zones.length}
								<span class="mz-name">{zones[0].name}</span>
								{#if zones.length > 1}
									<span class="chip mz-more">+{zones.length - 1}</span>
								{/if}
							{:else}
								<span class="muted">—</span>
							{/if}
						</td>
						<td class="actions-col">
							<button class="btn btn-sm" onclick={() => ontag(entity)}>Tag</button>
							<button class="btn btn-sm" onclick={() => onsettings(entity)}>Settings</button>
							{#if entity.type === 'SERVICE'}
								<button class="btn btn-sm" onclick={() => ongraph(entity)}>Graph</button>
							{/if}
						</td>
					</tr>
				{/each}
			{/if}
		</tbody>
	</table>
</div>

<style>
	.wrap {
		border: 1px solid var(--border);
		border-radius: var(--radius);
		overflow: auto;
		/* divided by --app-zoom so the zoomed UI still fits the real viewport */
		max-height: calc(100vh / var(--app-zoom, 1) - 320px);
		background: var(--surface);
	}

	.check {
		width: 32px;
	}

	.kind {
		white-space: nowrap;
	}

	.name {
		font-weight: 550;
		max-width: 320px;
		overflow-wrap: anywhere;
	}

	.name a {
		color: inherit;
		text-decoration: none;
	}

	.name a:hover {
		color: var(--accent);
		text-decoration: underline;
	}

	.sort {
		border: none;
		background: none;
		padding: 0;
		font: inherit;
		color: inherit;
		cursor: pointer;
	}

	.sort:hover {
		color: var(--accent);
	}

	/* scrolls away with the content instead of stacking under the sticky header row */
	.filter-row th {
		position: static;
		padding: 4px 8px;
		border-bottom: 2px solid var(--border);
	}

	.cf {
		width: 100%;
		min-width: 70px;
		padding: 3px 6px;
		font-size: 12px;
	}

	.chips {
		display: flex;
		flex-wrap: wrap;
		gap: 4px;
		max-width: 360px;
	}

	.actions-col {
		white-space: nowrap;
		width: 130px;
	}

	.type-detail {
		color: var(--muted);
		max-width: 200px;
	}

	.det {
		white-space: nowrap;
	}

	.det-summary {
		margin-top: 2px;
		font-size: 11px;
		color: var(--muted);
		white-space: normal;
		max-width: 200px;
	}

	.num {
		text-align: right;
		white-space: nowrap;
	}

	.has-problems {
		color: var(--danger);
		font-weight: 700;
	}

	.last-seen {
		white-space: nowrap;
		color: var(--muted);
	}

	.mz {
		white-space: nowrap;
	}

	.mz-name {
		display: inline-block;
		max-width: 160px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		vertical-align: bottom;
	}

	.mz-more {
		cursor: help;
	}

	.warn,
	.key-reqs {
		cursor: help;
	}

	.state {
		text-align: center;
		padding: 32px 12px;
		color: var(--muted);
	}

	.state.error {
		color: var(--danger);
	}
</style>
