<script lang="ts">
	import { entityList, emptyFilters, humanizeConstant } from '$lib/stores/entities.svelte';
	import { toasts } from '$lib/stores/toasts.svelte';
	import type { EntityFilters } from '$lib/types';

	// Frequent serviceType constants; tenant-specific ones are merged in from loaded rows.
	const COMMON_SERVICE_TYPES = [
		'WEB_REQUEST_SERVICE',
		'WEB_SERVICE',
		'DATABASE_SERVICE',
		'MESSAGING_SERVICE',
		'QUEUE_LISTENER_SERVICE',
		'RMI_SERVICE',
		'RPC_SERVICE',
		'CUSTOM_SERVICE',
		'EXTERNAL',
		'BACKGROUND_ACTIVITY'
	];

	let draft = $state<EntityFilters>({ ...entityList.filters, tags: [...entityList.filters.tags] });
	let tagInput = $state('');
	let mzLoadTried = $state(false);

	function addTag() {
		const t = tagInput.trim();
		if (t && !draft.tags.includes(t)) draft.tags.push(t);
		tagInput = '';
	}

	function removeTag(tag: string) {
		draft.tags = draft.tags.filter((t) => t !== tag);
	}

	async function apply() {
		if (tagInput.trim()) addTag();
		try {
			await entityList.applyFilters({ ...draft, tags: [...draft.tags] });
		} catch (e) {
			toasts.error(e instanceof Error ? e.message : String(e));
		}
	}

	async function clear() {
		draft = emptyFilters();
		tagInput = '';
		await apply();
	}

	const serviceTypeOptions = $derived.by(() => {
		const observed = entityList.entities
			.map((e) => e.properties?.serviceType)
			.filter((t): t is string => Boolean(t));
		return [...new Set([...COMMON_SERVICE_TYPES, ...observed])].sort();
	});

	async function loadMzOptions() {
		if (mzLoadTried || entityList.mzNames.length > 0) return;
		mzLoadTried = true;
		try {
			await entityList.loadMzNames();
		} catch {
			// dropdown stays empty; not worth blocking the UI over
		}
	}
</script>

<div class="bar">
	<div class="field">
		<label for="f-name">Name starts with</label>
		<input
			id="f-name"
			class="input"
			placeholder="e.g. checkout"
			bind:value={draft.name}
			onkeydown={(e) => e.key === 'Enter' && apply()}
		/>
	</div>

	<div class="field grow">
		<label for="f-tag">Tags (key or key:value)</label>
		<div class="tag-edit">
			<input
				id="f-tag"
				class="input"
				placeholder="e.g. team:payments"
				bind:value={tagInput}
				onkeydown={(e) => e.key === 'Enter' && (tagInput.trim() ? addTag() : apply())}
			/>
			<button class="btn" onclick={addTag} disabled={!tagInput.trim()}>Add</button>
			{#each draft.tags as tag (tag)}
				<span class="chip">
					{tag}
					<button class="chip-x" onclick={() => removeTag(tag)} aria-label="Remove {tag}">&times;</button>
				</span>
			{/each}
		</div>
	</div>

	<div class="field">
		<label for="f-mz">Management zone</label>
		<select id="f-mz" class="select" bind:value={draft.mzName} onfocus={loadMzOptions}>
			<option value="">Any</option>
			{#each entityList.mzNames as name (name)}
				<option value={name}>{name}</option>
			{/each}
			{#if draft.mzName && !entityList.mzNames.includes(draft.mzName)}
				<option value={draft.mzName}>{draft.mzName}</option>
			{/if}
		</select>
	</div>

	{#if entityList.type === 'SERVICE'}
		<div class="field">
			<label for="f-servicetype">Service type</label>
			<select id="f-servicetype" class="select" bind:value={draft.serviceType}>
				<option value="">Any</option>
				{#each serviceTypeOptions as t (t)}
					<option value={t}>{humanizeConstant(t)}</option>
				{/each}
				{#if draft.serviceType && !serviceTypeOptions.includes(draft.serviceType)}
					<option value={draft.serviceType}>{humanizeConstant(draft.serviceType)}</option>
				{/if}
			</select>
		</div>
	{/if}

	<div class="field">
		<label for="f-health">Health</label>
		<select id="f-health" class="select" bind:value={draft.healthState}>
			<option value="">Any</option>
			<option value="HEALTHY">Healthy</option>
			<option value="UNHEALTHY">Unhealthy</option>
		</select>
	</div>

	<div class="actions">
		<button class="btn btn-primary" onclick={apply} disabled={entityList.loading}>Apply</button>
		<button class="btn" onclick={clear} disabled={entityList.loading}>Clear</button>
	</div>
</div>

<style>
	.bar {
		display: flex;
		flex-wrap: wrap;
		align-items: flex-end;
		gap: 12px;
		padding: 12px 16px;
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius);
	}

	.grow {
		flex: 1;
		min-width: 260px;
	}

	.tag-edit {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 6px;
	}

	.tag-edit .input {
		width: 180px;
	}

	.chip-x {
		border: none;
		background: none;
		color: inherit;
		cursor: pointer;
		font-size: 13px;
		padding: 0;
		line-height: 1;
	}

	.actions {
		display: flex;
		gap: 8px;
		margin-left: auto;
	}
</style>
