<script lang="ts">
	import type { Snippet } from 'svelte';

	let {
		title,
		onclose,
		wide = false,
		children,
		footer
	}: {
		title: string;
		onclose: () => void;
		wide?: boolean;
		children: Snippet;
		footer?: Snippet;
	} = $props();

	function onkeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') onclose();
	}
</script>

<svelte:window {onkeydown} />

<div class="backdrop" onclick={(e) => e.target === e.currentTarget && onclose()} role="presentation">
	<div class="modal" class:wide role="dialog" aria-modal="true" aria-label={title}>
		<header>
			<h2>{title}</h2>
			<button class="close" onclick={onclose} aria-label="Close">&times;</button>
		</header>
		<div class="body">
			{@render children()}
		</div>
		{#if footer}
			<footer>
				{@render footer()}
			</footer>
		{/if}
	</div>
</div>

<style>
	.backdrop {
		position: fixed;
		inset: 0;
		background: rgba(20, 24, 40, 0.45);
		display: flex;
		align-items: flex-start;
		justify-content: center;
		padding: 8vh 16px 16px;
		z-index: 50;
	}

	.modal {
		background: var(--surface);
		border-radius: 12px;
		box-shadow: var(--shadow);
		width: 100%;
		max-width: 480px;
		max-height: 84vh;
		display: flex;
		flex-direction: column;
	}

	.modal.wide {
		max-width: 760px;
	}

	header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 16px 20px 12px;
		border-bottom: 1px solid var(--border);
	}

	header h2 {
		font-size: 16px;
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

	.close:hover {
		color: var(--text);
	}

	.body {
		padding: 16px 20px;
		overflow-y: auto;
	}

	footer {
		display: flex;
		justify-content: flex-end;
		gap: 8px;
		padding: 12px 20px 16px;
		border-top: 1px solid var(--border);
	}
</style>
