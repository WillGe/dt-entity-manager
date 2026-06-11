<script lang="ts">
	import JsonTree from './JsonTree.svelte';

	let { value }: { value: unknown } = $props();

	const isObject = $derived(typeof value === 'object' && value !== null && !Array.isArray(value));
	const items = $derived(Array.isArray(value) ? (value as unknown[]) : null);
	const objEntries = $derived(isObject ? Object.entries(value as Record<string, unknown>) : []);

	// Complex children render on their own line below the key; primitives stay beside it.
	// Empty objects/arrays count as primitive so they show inline as "—"/"empty list".
	function isComplex(v: unknown): boolean {
		if (v === null || typeof v !== 'object') return false;
		return Array.isArray(v) ? v.length > 0 : Object.keys(v).length > 0;
	}
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
	{#if objEntries.length === 0}
		<span class="empty">—</span>
	{:else}
		<dl class="obj">
			{#each objEntries as [key, child] (key)}
				<div class="entry" class:nested={isComplex(child)}>
					<dt>{key}</dt>
					<dd><JsonTree value={child} /></dd>
				</div>
			{/each}
		</dl>
	{/if}
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
		gap: 3px;
	}

	/* primitive value: key and value side by side */
	.entry {
		display: flex;
		gap: 12px;
		align-items: baseline;
		justify-content: space-between;
	}

	.entry dt {
		color: var(--muted);
		font-size: 12.5px;
		overflow-wrap: anywhere;
	}

	.entry dd {
		margin: 0;
		min-width: 0;
		text-align: right;
	}

	/* object/array value: key becomes a heading, value indented below */
	.entry.nested {
		flex-direction: column;
		align-items: stretch;
		gap: 2px;
		margin: 4px 0;
	}

	.entry.nested > dt {
		font-weight: 600;
		color: var(--text);
	}

	.entry.nested > dd {
		text-align: left;
		border-left: 2px solid var(--border);
		padding-left: 10px;
	}

	.list {
		margin: 0;
		padding-left: 18px;
		display: flex;
		flex-direction: column;
		gap: 8px;
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
