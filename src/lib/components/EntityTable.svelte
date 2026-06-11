<script lang="ts">
	import { entityList, tagLabel } from '$lib/stores/entities.svelte';
	import type { DtEntity } from '$lib/types';

	let {
		ontag,
		onsettings
	}: {
		ontag: (entity: DtEntity) => void;
		onsettings: (entity: DtEntity) => void;
	} = $props();

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
				<th>Name</th>
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
				{#each entityList.visible as entity (entity.entityId)}
					<tr>
						<td class="check">
							<input
								type="checkbox"
								checked={entityList.selected.has(entity.entityId)}
								onchange={() => toggle(entity.entityId)}
								aria-label="Select {entity.displayName}"
							/>
						</td>
						<td class="name">{entity.displayName}</td>
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
