<script lang="ts">
	import ConnectionModal from '$lib/components/ConnectionModal.svelte';
	import CsvImportModal from '$lib/components/CsvImportModal.svelte';
	import EntityTable from '$lib/components/EntityTable.svelte';
	import FilterBar from '$lib/components/FilterBar.svelte';
	import GraphModal from '$lib/components/GraphModal.svelte';
	import Logo from '$lib/components/Logo.svelte';
	import SettingsDrawer from '$lib/components/SettingsDrawer.svelte';
	import TagModal from '$lib/components/TagModal.svelte';
	import Toasts from '$lib/components/Toasts.svelte';
	import { connection } from '$lib/stores/connection.svelte';
	import { entityList } from '$lib/stores/entities.svelte';
	import { theme } from '$lib/stores/theme.svelte';
	import { toasts } from '$lib/stores/toasts.svelte';
	import { downloadCsv, exportEntitiesCsv } from '$lib/csv';
	import type { DtEntity, EntityType } from '$lib/types';

	const TABS: { type: EntityType; label: string }[] = [
		{ type: 'SERVICE', label: 'Services' },
		{ type: 'HOST', label: 'Hosts' },
		{ type: 'PROCESS_GROUP', label: 'Process groups' }
	];

	let showConnection = $state(false);
	let showImport = $state(false);
	let showGraph = $state(false);
	let tagTarget = $state<{ ids: string[]; label: string } | null>(null);
	let settingsEntity = $state<DtEntity | null>(null);

	$effect(() => {
		if (!connection.configured) showConnection = true;
	});

	// initial load once a connection exists
	let loadedOnce = false;
	$effect(() => {
		if (connection.configured && !loadedOnce) {
			loadedOnce = true;
			entityList.load().catch((e) => toasts.error(e instanceof Error ? e.message : String(e)));
		}
	});

	async function switchTab(type: EntityType) {
		try {
			await entityList.setType(type);
		} catch (e) {
			toasts.error(e instanceof Error ? e.message : String(e));
		}
	}

	async function refresh() {
		try {
			await entityList.load(true);
		} catch (e) {
			toasts.error(e instanceof Error ? e.message : String(e));
		}
	}

	async function loadMore() {
		try {
			await entityList.loadMore();
		} catch (e) {
			toasts.error(e instanceof Error ? e.message : String(e));
		}
	}

	function exportCsv() {
		const rows = entityList.visible;
		const date = new Date().toISOString().slice(0, 10);
		downloadCsv(`dynatrace-${entityList.type.toLowerCase()}-${date}.csv`, exportEntitiesCsv(rows));
		toasts.info(`Exported ${rows.length} entities to CSV.`);
	}

	function tagSelected() {
		const ids = [...entityList.selected];
		tagTarget = { ids, label: `${ids.length} selected entit${ids.length === 1 ? 'y' : 'ies'}` };
	}

	function onConnectionSaved() {
		loadedOnce = true;
		entityList.load(true).catch((e) => toasts.error(e instanceof Error ? e.message : String(e)));
	}

	const fetchedTime = $derived(
		entityList.fetchedAt
			? new Date(entityList.fetchedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
			: null
	);
</script>

<svelte:head>
	<title>Dynatrace Entity Manager</title>
</svelte:head>

<div class="page">
	<header class="top">
		<h1><Logo /> <span>Dynatrace Entity Manager</span></h1>
		<div class="top-right">
			{#if connection.configured}
				<span class="muted env">{connection.baseUrl.replace('https://', '')}</span>
			{/if}
			<button class="btn" onclick={() => theme.cycle()} title="Cycle theme (auto / dark / light)">
				{theme.label}
			</button>
			<button class="btn" onclick={() => (showConnection = true)}>Connection</button>
		</div>
	</header>

	<nav class="tabs">
		{#each TABS as tab (tab.type)}
			<button
				class="tab"
				class:active={entityList.type === tab.type}
				onclick={() => switchTab(tab.type)}
			>
				{tab.label}
			</button>
		{/each}
	</nav>

	<FilterBar />

	<div class="toolbar">
		<input
			class="input quick"
			placeholder="Quick filter loaded rows (no API call)"
			bind:value={entityList.quickFilter}
		/>
		<span class="muted">
			{entityList.visible.length} of {entityList.totalCount} entities
			{#if fetchedTime}
				· data as of {fetchedTime}
			{/if}
		</span>
		<div class="spacer"></div>
		{#if entityList.selected.size > 0}
			<button class="btn" onclick={tagSelected}>Tag {entityList.selected.size} selected</button>
		{/if}
		{#if entityList.type === 'SERVICE'}
			<button class="btn" onclick={() => (showGraph = true)} disabled={entityList.visible.length === 0}>
				Graph
			</button>
		{/if}
		<button class="btn" onclick={exportCsv} disabled={entityList.visible.length === 0}>
			Export CSV
		</button>
		<button class="btn" onclick={() => (showImport = true)} disabled={!connection.configured}>
			Import tags CSV
		</button>
		<button class="btn" onclick={refresh} disabled={entityList.loading || !connection.configured}>
			Refresh
		</button>
	</div>

	<EntityTable
		ontag={(e) => (tagTarget = { ids: [e.entityId], label: e.displayName })}
		onsettings={(e) => (settingsEntity = e)}
	/>

	{#if entityList.nextPageKey}
		<div class="more">
			<button class="btn" onclick={loadMore} disabled={entityList.loadingMore}>
				{entityList.loadingMore
					? 'Loading…'
					: `Load more (${entityList.entities.length} of ${entityList.totalCount} loaded)`}
			</button>
		</div>
	{/if}
</div>

{#if showConnection}
	<ConnectionModal onclose={() => (showConnection = false)} onsaved={onConnectionSaved} />
{/if}
{#if tagTarget}
	<TagModal entityIds={tagTarget.ids} label={tagTarget.label} onclose={() => (tagTarget = null)} />
{/if}
{#if settingsEntity}
	<SettingsDrawer entity={settingsEntity} onclose={() => (settingsEntity = null)} />
{/if}
{#if showImport}
	<CsvImportModal onclose={() => (showImport = false)} />
{/if}
{#if showGraph}
	<GraphModal onclose={() => (showGraph = false)} />
{/if}

<Toasts />

<style>
	.page {
		max-width: 1840px;
		margin: 0 auto;
		padding: 20px clamp(24px, 2.5vw, 56px) 48px;
		display: flex;
		flex-direction: column;
		gap: 14px;
	}

	.top {
		display: flex;
		align-items: center;
		justify-content: space-between;
	}

	.top h1 {
		font-size: 19px;
		display: flex;
		align-items: center;
		gap: 10px;
	}

	.top-right {
		display: flex;
		align-items: center;
		gap: 10px;
	}

	.env {
		font-size: 12.5px;
	}

	.tabs {
		display: flex;
		gap: 4px;
		border-bottom: 1px solid var(--border);
	}

	.tab {
		border: none;
		background: none;
		padding: 8px 14px;
		font-size: 14px;
		font-weight: 550;
		color: var(--muted);
		cursor: pointer;
		border-bottom: 2px solid transparent;
		margin-bottom: -1px;
	}

	.tab:hover {
		color: var(--text);
	}

	.tab.active {
		color: var(--accent);
		border-bottom-color: var(--accent);
	}

	.toolbar {
		display: flex;
		align-items: center;
		gap: 10px;
		flex-wrap: wrap;
	}

	.quick {
		width: 280px;
	}

	.spacer {
		flex: 1;
	}

	.more {
		display: flex;
		justify-content: center;
	}
</style>
