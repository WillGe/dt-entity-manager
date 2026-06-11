<script lang="ts">
	import { toasts } from '$lib/stores/toasts.svelte';
</script>

<div class="stack" aria-live="polite">
	{#each toasts.items as toast (toast.id)}
		<div class="toast {toast.kind}">
			<span>{toast.message}</span>
			<button onclick={() => toasts.dismiss(toast.id)} aria-label="Dismiss">&times;</button>
		</div>
	{/each}
</div>

<style>
	.stack {
		position: fixed;
		bottom: 16px;
		right: 16px;
		display: flex;
		flex-direction: column;
		gap: 8px;
		z-index: 100;
		max-width: 420px;
	}

	.toast {
		display: flex;
		align-items: flex-start;
		gap: 10px;
		padding: 10px 14px;
		border-radius: var(--radius);
		box-shadow: var(--shadow);
		/* fixed colors: dark chips with white text read well on both themes */
		background: #262b36;
		color: #fff;
		font-size: 13px;
	}

	.toast.success {
		background: #196c4e;
	}

	.toast.error {
		background: #b3261e;
	}

	.toast button {
		border: none;
		background: none;
		color: inherit;
		font-size: 16px;
		line-height: 1;
		cursor: pointer;
		padding: 0;
		opacity: 0.8;
	}
</style>
