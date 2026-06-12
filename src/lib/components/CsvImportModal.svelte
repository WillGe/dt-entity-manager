<script lang="ts">
	import Modal from './Modal.svelte';
	import {
		IMPORT_TEMPLATE,
		downloadCsv,
		exportTagImportSkeleton,
		groupImportRows,
		parseTagImport,
		type ImportRow,
		type TagBatch
	} from '$lib/csv';
	import { entityList } from '$lib/stores/entities.svelte';
	import { toasts } from '$lib/stores/toasts.svelte';

	let { onclose }: { onclose: () => void } = $props();

	type Step = 'pick' | 'preview' | 'running' | 'done';
	let step = $state<Step>('pick');
	let rows = $state<ImportRow[]>([]);
	let batches = $state<TagBatch[]>([]);
	let progress = $state({ entitiesDone: 0, entitiesTotal: 0 });
	let failures = $state<{ tag: string; error: string }[]>([]);
	let taggedCount = $state(0);

	const validRows = $derived(rows.filter((r) => !r.error));
	const invalidRows = $derived(rows.filter((r) => r.error));
	const previewRows = $derived([...invalidRows, ...validRows].slice(0, 100));

	async function onFilePicked(e: Event) {
		const file = (e.target as HTMLInputElement).files?.[0];
		if (!file) return;
		try {
			rows = await parseTagImport(file);
			batches = groupImportRows(rows);
			step = 'preview';
		} catch (err) {
			toasts.error(err instanceof Error ? err.message : String(err));
		}
	}

	async function run() {
		step = 'running';
		failures = [];
		taggedCount = 0;
		const entitiesTotal = batches.reduce((n, b) => n + b.entityIds.length, 0);
		progress = { entitiesDone: 0, entitiesTotal };

		for (const batch of batches) {
			const base = progress.entitiesDone;
			try {
				const matched = await entityList.tagEntities(batch.entityIds, [batch.tag], (done) => {
					progress = { ...progress, entitiesDone: base + done };
				});
				taggedCount += matched;
			} catch (e) {
				failures.push({
					tag: batch.tag.value ? `${batch.tag.key}:${batch.tag.value}` : batch.tag.key,
					error: e instanceof Error ? e.message : String(e)
				});
			}
			progress = { ...progress, entitiesDone: base + batch.entityIds.length };
		}
		step = 'done';
	}

	function tagOf(row: ImportRow): string {
		return row.tagValue ? `${row.tagKey}:${row.tagValue}` : row.tagKey;
	}

	function downloadSkeleton() {
		const slug = entityList.type.toLowerCase().replace('_', '-');
		downloadCsv(`tag-import-${slug}s.csv`, exportTagImportSkeleton(entityList.visible));
	}
</script>

<Modal title="Import tags from CSV" {onclose} wide>
	{#if step === 'pick'}
		<p>
			Upload a CSV with columns <code>entityId,tagKey,tagValue</code> (one tag per row,
			<code>tagValue</code> optional, multiple rows per entity allowed). Tags are added —
			nothing is removed. Rows left without a <code>tagKey</code> are skipped on import.
		</p>
		<div class="pick-actions">
			<input type="file" accept=".csv,text/csv" onchange={onFilePicked} />
			<button class="btn btn-sm" onclick={() => downloadCsv('tag-import-template.csv', IMPORT_TEMPLATE)}>
				Download template
			</button>
			<button class="btn btn-sm" onclick={downloadSkeleton} disabled={entityList.visible.length === 0}>
				Download current list ({entityList.visible.length})
			</button>
		</div>
	{:else if step === 'preview'}
		<p>
			<strong>{validRows.length}</strong> valid row{validRows.length === 1 ? '' : 's'}
			({batches.length} distinct tag{batches.length === 1 ? '' : 's'},
			{batches.reduce((n, b) => n + b.entityIds.length, 0)} entity assignments)
			{#if invalidRows.length}
				— <strong class="error">{invalidRows.length} invalid row{invalidRows.length === 1 ? '' : 's'} will be skipped</strong>
			{/if}
		</p>
		<div class="preview">
			<table class="table">
				<thead>
					<tr><th>Line</th><th>Entity ID</th><th>Tag</th><th>Status</th></tr>
				</thead>
				<tbody>
					{#each previewRows as row (row.line)}
						<tr class:bad={row.error}>
							<td>{row.line}</td>
							<td><code>{row.entityId || '—'}</code></td>
							<td>{tagOf(row)}</td>
							<td>{row.error ?? 'OK'}</td>
						</tr>
					{/each}
				</tbody>
			</table>
			{#if rows.length > previewRows.length}
				<p class="muted">…and {rows.length - previewRows.length} more rows.</p>
			{/if}
		</div>
	{:else if step === 'running'}
		<p>Applying tags… {progress.entitiesDone} / {progress.entitiesTotal} entity assignments</p>
		<div class="bar">
			<div
				class="fill"
				style="width: {progress.entitiesTotal ? (100 * progress.entitiesDone) / progress.entitiesTotal : 0}%"
			></div>
		</div>
	{:else}
		<p>
			Done — tagged <strong>{taggedCount}</strong> entit{taggedCount === 1 ? 'y' : 'ies'}.
			{#if invalidRows.length}
				{invalidRows.length} invalid row{invalidRows.length === 1 ? '' : 's'} skipped.
			{/if}
		</p>
		{#if failures.length}
			<p class="error">Some batches failed:</p>
			<ul>
				{#each failures as f (f.tag)}
					<li><strong>{f.tag}</strong>: {f.error}</li>
				{/each}
			</ul>
		{/if}
	{/if}

	{#snippet footer()}
		{#if step === 'preview'}
			<button class="btn" onclick={() => (step = 'pick')}>Back</button>
			<button class="btn btn-primary" onclick={run} disabled={validRows.length === 0}>
				Apply {validRows.length} row{validRows.length === 1 ? '' : 's'}
			</button>
		{:else if step === 'done'}
			<button class="btn btn-primary" onclick={onclose}>Close</button>
		{:else if step === 'pick'}
			<button class="btn" onclick={onclose}>Cancel</button>
		{/if}
	{/snippet}
</Modal>

<style>
	.pick-actions {
		display: flex;
		align-items: center;
		gap: 12px;
		margin-top: 8px;
	}

	.preview {
		max-height: calc(45vh / var(--app-zoom, 1));
		overflow: auto;
		border: 1px solid var(--border);
		border-radius: var(--radius);
	}

	tr.bad td {
		background: var(--danger-soft);
	}

	.error {
		color: var(--danger);
	}

	.bar {
		height: 10px;
		border-radius: 999px;
		background: var(--bg);
		border: 1px solid var(--border);
		overflow: hidden;
	}

	.fill {
		height: 100%;
		background: var(--accent);
		transition: width 0.2s;
	}
</style>
