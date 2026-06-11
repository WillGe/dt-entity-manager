<script lang="ts">
	import Modal from './Modal.svelte';
	import { entityList } from '$lib/stores/entities.svelte';
	import { toasts } from '$lib/stores/toasts.svelte';

	let {
		entityIds,
		label,
		onclose
	}: {
		entityIds: string[];
		/** human description of the target, e.g. an entity name or "3 selected entities" */
		label: string;
		onclose: () => void;
	} = $props();

	let rows = $state<{ key: string; value: string }[]>([{ key: '', value: '' }]);
	let applying = $state(false);
	let progress = $state<{ done: number; total: number } | null>(null);

	const validTags = $derived(
		rows.map((r) => ({ key: r.key.trim(), value: r.value.trim() })).filter((r) => r.key !== '')
	);

	function addRow() {
		rows.push({ key: '', value: '' });
	}

	function removeRow(i: number) {
		rows.splice(i, 1);
	}

	async function apply() {
		applying = true;
		progress = null;
		try {
			const matched = await entityList.tagEntities(
				entityIds,
				validTags.map((t) => ({ key: t.key, ...(t.value ? { value: t.value } : {}) })),
				(done, total) => (progress = { done, total })
			);
			toasts.success(
				`Added ${validTags.length} tag${validTags.length > 1 ? 's' : ''} to ${matched} entit${matched === 1 ? 'y' : 'ies'}.`
			);
			onclose();
		} catch (e) {
			toasts.error(e instanceof Error ? e.message : String(e));
		} finally {
			applying = false;
		}
	}
</script>

<Modal title="Add tags" {onclose}>
	<p class="target">Target: <strong>{label}</strong></p>

	<div class="rows">
		{#each rows as row, i (i)}
			<div class="row">
				<input class="input" placeholder="key" bind:value={row.key} />
				<input class="input" placeholder="value (optional)" bind:value={row.value} />
				<button
					class="btn btn-sm"
					onclick={() => removeRow(i)}
					disabled={rows.length === 1}
					aria-label="Remove tag row"
				>
					&times;
				</button>
			</div>
		{/each}
	</div>
	<button class="btn btn-sm" onclick={addRow}>+ Another tag</button>

	{#if progress && progress.total > 50}
		<p class="muted">Tagging {progress.done} / {progress.total} entities…</p>
	{/if}

	{#snippet footer()}
		<button class="btn" onclick={onclose} disabled={applying}>Cancel</button>
		<button
			class="btn btn-primary"
			onclick={apply}
			disabled={applying || validTags.length === 0 || entityIds.length === 0}
		>
			{applying ? 'Applying…' : `Apply to ${entityIds.length} entit${entityIds.length === 1 ? 'y' : 'ies'}`}
		</button>
	{/snippet}
</Modal>

<style>
	.target {
		margin: 0 0 12px;
	}

	.rows {
		display: flex;
		flex-direction: column;
		gap: 8px;
		margin-bottom: 10px;
	}

	.row {
		display: flex;
		gap: 6px;
		align-items: center;
	}

	.row .input {
		flex: 1;
	}
</style>
