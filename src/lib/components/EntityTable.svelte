<script lang="ts">
	import { connection } from '$lib/stores/connection.svelte';
	import { entityList, tagLabel } from '$lib/stores/entities.svelte';
	import type { DtEntity } from '$lib/types';

	let {
		ontag,
		onsettings
	}: {
		ontag: (entity: DtEntity) => void;
		onsettings: (entity: DtEntity) => void;
	} = $props();

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
				<th>Tags</th>
				<th>Management zones</th>
				<th class="actions-col">Actions</th>
			</tr>
		</thead>
		<tbody>
			{#if entityList.loading}
				<tr><td colspan="6" class="state">Loading entities…</td></tr>
			{:else if entityList.error}
				<tr><td colspan="6" class="state error">{entityList.error}</td></tr>
			{:else if entityList.visible.length === 0}
				<tr>
					<td colspan="6" class="state">
						{entityList.entities.length === 0
							? 'No entities match the current filters.'
							: 'No loaded entities match the quick filter.'}
					</td>
				</tr>
			{:else}
				{#each rows as entity (entity.entityId)}
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
		max-height: calc(100vh - 320px);
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

	.state {
		text-align: center;
		padding: 32px 12px;
		color: var(--muted);
	}

	.state.error {
		color: var(--danger);
	}
</style>
