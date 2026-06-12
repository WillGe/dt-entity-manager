<script lang="ts">
	import { DETECTION_SCHEMAS } from '$lib/api/dynatrace';
	import { connection } from '$lib/stores/connection.svelte';
	import { entityList, entityTypeDetail, tagLabel } from '$lib/stores/entities.svelte';
	import type { DtEntity } from '$lib/types';

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

	const isServices = $derived(entityList.type === 'SERVICE');
	const colCount = $derived(isServices ? 12 : 10);

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

	let sortDir = $state<'none' | 'asc' | 'desc'>('none');

	const rows = $derived(
		sortDir === 'none'
			? entityList.visible
			: [...entityList.visible].sort(
					(a, b) => (sortDir === 'asc' ? 1 : -1) * a.displayName.localeCompare(b.displayName)
				)
	);

	function cycleSort() {
		sortDir = sortDir === 'none' ? 'asc' : sortDir === 'asc' ? 'desc' : 'none';
	}

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
					<button class="sort" onclick={cycleSort}>
						Name {sortDir === 'asc' ? '▲' : sortDir === 'desc' ? '▼' : ''}
					</button>
				</th>
				<th>Entity ID</th>
				<th>Type</th>
				<th>
					Detection
					{#if entityList.enrichErrors.detection}
						<span class="warn" title={entityList.enrichErrors.detection}>⚠</span>
					{/if}
				</th>
				<th class="num" title="Open problems (last 90 days)">
					Problems
					{#if entityList.enrichErrors.problems}
						<span class="warn" title={entityList.enrichErrors.problems}>⚠</span>
					{/if}
				</th>
				{#if isServices}
					<th class="num" title="Average requests per minute over the last 2 h">
						Req/min
						{#if entityList.enrichErrors.throughput}
							<span class="warn" title={entityList.enrichErrors.throughput}>⚠</span>
						{/if}
					</th>
					<th class="num" title="Requests marked as key requests (hover a count for the names)">
						Key reqs
						{#if entityList.enrichErrors.detection}
							<span class="warn" title={entityList.enrichErrors.detection}>⚠</span>
						{/if}
					</th>
				{/if}
				<th>Last seen</th>
				<th>Tags</th>
				<th>Management zones</th>
				<th class="actions-col">Actions</th>
			</tr>
		</thead>
		<tbody>
			{#if entityList.loading}
				<tr><td colspan={colCount} class="state">Loading entities…</td></tr>
			{:else if entityList.error}
				<tr><td colspan={colCount} class="state error">{entityList.error}</td></tr>
			{:else if entityList.visible.length === 0}
				<tr>
					<td colspan={colCount} class="state">
						{entityList.entities.length === 0
							? 'No entities match the current filters.'
							: 'No loaded entities match the quick filter.'}
					</td>
				</tr>
			{:else}
				{#each rows as entity (entity.entityId)}
					{@const enr = entityList.enrichments[entity.entityId]}
					<tr>
						<td class="check">
							<input
								type="checkbox"
								checked={entityList.selected.has(entity.entityId)}
								onchange={() => toggle(entity.entityId)}
								aria-label="Select {entity.displayName}"
							/>
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
								<span class="muted">{entityList.enriching ? '…' : '—'}</span>
							{/if}
						</td>
						<td class="num">
							{#if enr?.openProblems !== undefined}
								<span class:has-problems={enr.openProblems > 0}>{enr.openProblems}</span>
							{:else}
								<span class="muted">{entityList.enriching ? '…' : '—'}</span>
							{/if}
						</td>
						{#if isServices}
							<td class="num">
								{#if enr?.throughputPerMin !== undefined}
									{fmtPerMin(enr.throughputPerMin)}
								{:else}
									<span class="muted">{entityList.enriching ? '…' : '—'}</span>
								{/if}
							</td>
							<td class="num">
								{#if enr?.keyRequests !== undefined}
									{#if enr.keyRequests.length > 0}
										<span class="key-reqs" title={enr.keyRequests.join('\n')}>
											{enr.keyRequests.length}
										</span>
									{:else}
										<span class="muted">—</span>
									{/if}
								{:else}
									<span class="muted">{entityList.enriching ? '…' : '—'}</span>
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
						<td>
							{(entity.managementZones ?? []).map((m) => m.name).join(', ') || '—'}
						</td>
						<td class="actions-col">
							<button class="btn btn-sm" onclick={() => ontag(entity)}>Tag</button>
							<button class="btn btn-sm" onclick={() => onsettings(entity)}>Settings</button>
							{#if isServices}
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
