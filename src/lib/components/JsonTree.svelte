<script lang="ts">
	import JsonTree from './JsonTree.svelte';

	let { value }: { value: unknown } = $props();

	const isObject = $derived(typeof value === 'object' && value !== null && !Array.isArray(value));
	const items = $derived(Array.isArray(value) ? (value as unknown[]) : null);
	const objEntries = $derived(isObject ? Object.entries(value as Record<string, unknown>) : []);
</script>

{#if items}
	{#if items.length === 0}
		<span class="empty">empty list</span>
	{:else}
		<ol class="list">
			{#each items as item, i (i)}
				<li><JsonTree value={item} /></li>
			{/each}
		</ol>
	{/if}
{:else if isObject}
	<dl class="obj">
		{#each objEntries as [key, child] (key)}
			<div class="entry">
				<dt>{key}</dt>
				<dd><JsonTree value={child} /></dd>
			</div>
		{/each}
	</dl>
{:else if typeof value === 'boolean'}
	<span class="bool" class:on={value}>{value ? 'enabled' : 'disabled'}</span>
{:else if value === null || value === undefined || value === ''}
	<span class="empty">—</span>
{:else}
	<span class="val">{String(value)}</span>
{/if}

<style>
	.obj {
		margin: 0;
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.entry {
		display: flex;
		gap: 8px;
		align-items: baseline;
	}

	dt {
		color: var(--muted);
		font-size: 12.5px;
		min-width: 180px;
		flex-shrink: 0;
		overflow-wrap: anywhere;
	}

	dd {
		margin: 0;
		flex: 1;
		min-width: 0;
	}

	/* nested objects get an indent guide */
	dd > :global(.obj),
	.list :global(.obj) {
		border-left: 2px solid var(--border);
		padding-left: 10px;
		margin-top: 2px;
	}

	.list {
		margin: 0;
		padding-left: 18px;
		display: flex;
		flex-direction: column;
		gap: 6px;
	}

	.val {
		font-weight: 550;
		overflow-wrap: anywhere;
	}

	.bool {
		font-weight: 600;
		color: var(--danger);
	}

	.bool.on {
		color: var(--success);
	}

	.empty {
		color: var(--muted);
	}
</style>
