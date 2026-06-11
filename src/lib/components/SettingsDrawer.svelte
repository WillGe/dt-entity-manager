<script lang="ts">
	import JsonTree from './JsonTree.svelte';
	import { getDetectionSettings } from '$lib/api/dynatrace';
	import { getCached, setCached } from '$lib/cache';
	import type { DetectionSettingsSection, DtEntity } from '$lib/types';

	let { entity, onclose }: { entity: DtEntity; onclose: () => void } = $props();

	const SETTINGS_TTL_MS = 30 * 60 * 1000;

	let sections = $state<DetectionSettingsSection[] | null>(null);
	let loading = $state(true);
	let loadError = $state<string | null>(null);
	let cachedAt = $state<number | null>(null);

	async function load(force = false) {
		loading = true;
		loadError = null;
		try {
			const key = `settings:${entity.entityId}`;
			if (!force) {
				const hit = getCached<DetectionSettingsSection[]>(key, SETTINGS_TTL_MS);
				if (hit) {
					sections = hit.value;
					cachedAt = hit.fetchedAt;
					return;
				}
			}
			sections = await getDetectionSettings(entity);
			cachedAt = null;
			setCached(key, sections);
		} catch (e) {
			loadError = e instanceof Error ? e.message : String(e);
		} finally {
			loading = false;
		}
	}

	$effect(() => {
		load();
	});

	function onkeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') onclose();
	}

	const scopeLabel = {
		entity: 'entity-specific',
		environment: 'environment default',
		none: 'not configured'
	} as const;
</script>

<svelte:window {onkeydown} />

<div class="backdrop" onclick={(e) => e.target === e.currentTarget && onclose()} role="presentation">
	<div class="drawer" role="dialog" aria-modal="true" aria-label="Problem detection settings">
		<header>
			<div>
				<h2>Problem detection settings</h2>
				<p class="muted">
					{entity.displayName} <code>{entity.entityId}</code>
				</p>
			</div>
			<div class="header-actions">
				{#if cachedAt}
					<span class="muted cache-note">cached {Math.round((Date.now() - cachedAt) / 60000)} min ago</span>
				{/if}
				<button class="btn btn-sm" onclick={() => load(true)} disabled={loading}>Refresh</button>
				<button class="close" onclick={onclose} aria-label="Close">&times;</button>
			</div>
		</header>

		<div class="content">
			{#if loading}
				<p class="muted">Loading settings…</p>
			{:else if loadError}
				<p class="error">{loadError}</p>
			{:else if sections}
				{#each sections as section (section.schemaId)}
					<section>
						<div class="section-head">
							<h3>{section.title}</h3>
							<span class="badge badge-{section.scope}">{scopeLabel[section.scope]}</span>
						</div>
						<p class="schema-id muted"><code>{section.schemaId}</code></p>
						{#if section.error}
							<p class="error">{section.error}</p>
						{:else if section.scope === 'none'}
							<p class="muted">No settings object found at entity or environment scope.</p>
						{:else}
							<JsonTree value={section.value} />
						{/if}
					</section>
				{/each}
			{/if}
		</div>
	</div>
</div>

<style>
	.backdrop {
		position: fixed;
		inset: 0;
		background: rgba(20, 24, 40, 0.35);
		z-index: 40;
	}

	.drawer {
		position: fixed;
		top: 0;
		right: 0;
		bottom: 0;
		width: min(680px, 94vw);
		background: var(--surface);
		box-shadow: var(--shadow);
		display: flex;
		flex-direction: column;
	}

	header {
		display: flex;
		justify-content: space-between;
		align-items: flex-start;
		gap: 12px;
		padding: 16px 20px;
		border-bottom: 1px solid var(--border);
	}

	header h2 {
		font-size: 16px;
	}

	header p {
		margin: 4px 0 0;
		font-size: 12.5px;
		overflow-wrap: anywhere;
	}

	.header-actions {
		display: flex;
		align-items: center;
		gap: 8px;
		flex-shrink: 0;
	}

	.cache-note {
		font-size: 12px;
	}

	.close {
		border: none;
		background: none;
		font-size: 22px;
		line-height: 1;
		color: var(--muted);
		cursor: pointer;
		padding: 0 4px;
	}

	.content {
		overflow-y: auto;
		padding: 16px 20px;
		display: flex;
		flex-direction: column;
		gap: 20px;
	}

	section {
		border: 1px solid var(--border);
		border-radius: var(--radius);
		padding: 12px 14px;
	}

	.section-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 8px;
	}

	.section-head h3 {
		font-size: 14px;
	}

	.schema-id {
		margin: 2px 0 10px;
		font-size: 11px;
	}

	.error {
		color: var(--danger);
	}
</style>
