<script lang="ts">
	import Modal from './Modal.svelte';
	import { connection } from '$lib/stores/connection.svelte';
	import { toasts } from '$lib/stores/toasts.svelte';
	import { testScopes, type ScopeCheck } from '$lib/api/dynatrace';
	import { cacheSizeBytes, invalidateCache } from '$lib/cache';

	let { onclose, onsaved }: { onclose: () => void; onsaved: () => void } = $props();

	let baseUrl = $state(connection.baseUrl);
	let token = $state(connection.token);
	let showToken = $state(false);
	let testing = $state(false);
	let checks = $state<ScopeCheck[] | null>(null);

	const valid = $derived(baseUrl.trim().startsWith('https://') && token.trim() !== '');

	// every probe failing for a non-scope reason = the connection itself is broken
	const connError = $derived(
		checks?.every((c) => c.status === 'error') ? (checks[0].message ?? 'Connection failed') : null
	);

	async function test() {
		testing = true;
		checks = null;
		try {
			checks = await testScopes({ baseUrl, token });
		} finally {
			testing = false;
		}
	}

	function save() {
		connection.save(baseUrl, token);
		onsaved();
		onclose();
	}

	let cacheSize = $state(cacheSizeBytes());

	const cacheLabel = $derived(
		cacheSize < 1024 * 100
			? `${Math.round(cacheSize / 1024)} KB`
			: `${(cacheSize / (1024 * 1024)).toFixed(1)} MB`
	);

	function clearCache() {
		invalidateCache();
		cacheSize = cacheSizeBytes();
		toasts.info('Local cache cleared — next loads will fetch fresh data from the API.');
	}
</script>

<Modal title="Dynatrace connection" {onclose}>
	<div class="form">
		<div class="field">
			<label for="dt-url">Environment URL</label>
			<input
				id="dt-url"
				class="input"
				type="url"
				placeholder="https://abc12345.live.dynatrace.com"
				bind:value={baseUrl}
			/>
			<span class="hint muted">SaaS: https://&lt;env-id&gt;.live.dynatrace.com — Managed: https://&lt;domain&gt;/e/&lt;env-id&gt;</span>
		</div>
		<div class="field">
			<label for="dt-token">API token</label>
			<div class="token-row">
				<input
					id="dt-token"
					class="input"
					type={showToken ? 'text' : 'password'}
					placeholder="dt0c01.…"
					bind:value={token}
				/>
				<button class="btn btn-sm" onclick={() => (showToken = !showToken)}>
					{showToken ? 'Hide' : 'Show'}
				</button>
			</div>
			<span class="hint muted">
				Required scopes: <code>entities.read</code>, <code>entities.write</code>,
				<code>settings.read</code>; optional: <code>problems.read</code> (Problems column),
				<code>metrics.read</code> (Req/min column). Scopes are fixed when a token is created —
				to add one, create a new token. Stored in this browser's localStorage only.
			</span>
		</div>
		{#if checks}
			{#if connError}
				<p class="result err">{connError}</p>
			{:else}
				<ul class="scopes">
					{#each checks as c (c.scope)}
						<li>
							<span class="mark" class:ok={c.status === 'ok'} class:bad={c.status !== 'ok'}>
								{c.status === 'ok' ? '✓' : '✗'}
							</span>
							<code>{c.scope}</code>
							<span class="muted">{c.purpose}</span>
							{#if c.status === 'missing'}
								<span class="missing">missing from this token</span>
							{:else if c.status === 'error'}
								<span class="missing" title={c.message}>{c.message}</span>
							{/if}
						</li>
					{/each}
				</ul>
			{/if}
		{/if}

		<div class="cache-row">
			<span class="muted">Cached API data: {cacheLabel} (localStorage quota is ~5 MB)</span>
			<button class="btn btn-sm" onclick={clearCache} disabled={cacheSize === 0}>
				Clear cached data
			</button>
		</div>
	</div>

	{#snippet footer()}
		<button class="btn" onclick={test} disabled={!valid || testing}>
			{testing ? 'Testing…' : 'Test connection'}
		</button>
		<button class="btn btn-primary" onclick={save} disabled={!valid}>Save</button>
	{/snippet}
</Modal>

<style>
	.form {
		display: flex;
		flex-direction: column;
		gap: 14px;
	}

	.scopes {
		list-style: none;
		margin: 0;
		padding: 8px 10px;
		border: 1px solid var(--border);
		border-radius: var(--radius);
		display: flex;
		flex-direction: column;
		gap: 4px;
		font-size: 13px;
	}

	.scopes li {
		display: flex;
		align-items: baseline;
		gap: 8px;
	}

	.mark.ok {
		color: var(--success);
	}

	.mark.bad {
		color: var(--danger);
	}

	.missing {
		color: var(--danger);
		font-size: 12px;
		overflow-wrap: anywhere;
	}

	.token-row {
		display: flex;
		gap: 6px;
	}

	.token-row .input {
		flex: 1;
	}

	.hint {
		font-size: 12px;
	}

	.result {
		margin: 0;
		padding: 8px 10px;
		border-radius: var(--radius);
		font-size: 13px;
	}

	.result.err {
		background: var(--danger-soft);
		color: var(--danger);
	}

	.cache-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 10px;
		padding-top: 12px;
		border-top: 1px solid var(--border);
		font-size: 12px;
	}
</style>
