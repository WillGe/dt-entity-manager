<script lang="ts">
	import Modal from './Modal.svelte';
	import { connection } from '$lib/stores/connection.svelte';
	import { toasts } from '$lib/stores/toasts.svelte';
	import { testConnection } from '$lib/api/dynatrace';
	import { cacheSizeBytes, invalidateCache } from '$lib/cache';

	let { onclose, onsaved }: { onclose: () => void; onsaved: () => void } = $props();

	let baseUrl = $state(connection.baseUrl);
	let token = $state(connection.token);
	let showToken = $state(false);
	let testing = $state(false);
	let testResult = $state<{ ok: boolean; message: string } | null>(null);

	const valid = $derived(baseUrl.trim().startsWith('https://') && token.trim() !== '');

	async function test() {
		testing = true;
		testResult = null;
		try {
			await testConnection({ baseUrl, token });
			testResult = { ok: true, message: 'Connection OK' };
		} catch (e) {
			testResult = { ok: false, message: e instanceof Error ? e.message : String(e) };
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
				<code>settings.read</code>. Stored in this browser's localStorage only.
			</span>
		</div>
		{#if testResult}
			<p class="result" class:ok={testResult.ok} class:err={!testResult.ok}>{testResult.message}</p>
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

	.result.ok {
		background: var(--success-soft);
		color: var(--success);
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
