<script lang="ts">
	import { onMount, untrack } from 'svelte';
	import {
		forceCenter,
		forceCollide,
		forceLink,
		forceManyBody,
		forceSimulation,
		type Simulation,
		type SimulationLinkDatum,
		type SimulationNodeDatum
	} from 'd3-force';
	import { getServiceNeighborhood } from '$lib/api/dynatrace';
	import { getCached, setCached } from '$lib/cache';
	import { buildCallGraph, type CallGraph } from '$lib/graph';
	import { connection } from '$lib/stores/connection.svelte';
	import { entityList } from '$lib/stores/entities.svelte';
	import type { CallEdgesResult, DtEntity } from '$lib/types';

	let { entity, onclose }: { entity: DtEntity; onclose: () => void } = $props();

	const GRAPH_TTL_MS = 30 * 60 * 1000;
	const EXCLUDE_KEY = 'dtem:graphExclude';
	const W = 1200;
	const H = 800;
	const R = 10;

	interface SimNode extends SimulationNodeDatum {
		id: string;
		name: string;
		ghost: boolean;
	}
	interface SimLink extends SimulationLinkDatum<SimNode> {
		via: string[];
	}

	let loading = $state(true);
	let error = $state<string | null>(null);
	let data = $state<CallEdgesResult | null>(null);
	let loadedIds = new Set<string>();
	// svelte-ignore state_referenced_locally -- modal is recreated per entity; refocus is internal
	let focus = $state({ id: entity.entityId, name: entity.displayName });

	let patterns = $state<string[]>(readPatterns());
	let patternInput = $state('');
	let showGhosts = $state(true);
	let hideUnconnected = $state(false);

	let graph = $state<CallGraph | null>(null);
	let nodes = $state<SimNode[]>([]);
	let links = $state<SimLink[]>([]);
	let selectedId = $state<string | null>(null);
	let view = $state({ x: 0, y: 0, k: 1 });
	let sim: Simulation<SimNode, SimLink> | null = null;
	let svgEl: SVGSVGElement | undefined = $state();

	function readPatterns(): string[] {
		try {
			const raw = localStorage.getItem(EXCLUDE_KEY);
			const parsed = raw ? (JSON.parse(raw) as unknown) : [];
			return Array.isArray(parsed) ? parsed.filter((p): p is string => typeof p === 'string') : [];
		} catch {
			return [];
		}
	}

	$effect(() => {
		localStorage.setItem(EXCLUDE_KEY, JSON.stringify(patterns));
	});

	onMount(() => {
		load();
		return () => sim?.stop();
	});

	async function load(force = false) {
		loading = true;
		error = null;
		try {
			loadedIds = new Set(entityList.entities.map((e) => e.entityId));
			const key = `callgraph:focus:v1:${focus.id}`;
			if (!force) {
				const hit = getCached<CallEdgesResult>(key, GRAPH_TTL_MS);
				if (hit) {
					data = hit.value;
					return;
				}
			}
			const fresh = await getServiceNeighborhood(focus.id);
			data = fresh;
			setCached(key, fresh);
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		} finally {
			loading = false;
		}
	}

	function focusOn(node: { id: string; name: string }) {
		focus = { id: node.id, name: node.name };
		selectedId = null;
		load();
	}

	// rebuild + re-layout whenever the data or the display filters change
	$effect(() => {
		if (!data) return;
		const g = buildCallGraph(data, loadedIds, {
			excludePatterns: patterns,
			showGhosts,
			hideUnconnected
		});
		graph = g;
		startSim(g);
	});

	function startSim(g: CallGraph) {
		sim?.stop();
		// keep positions of surviving nodes so filter tweaks don't reshuffle everything
		const prev = untrack(() => new Map(nodes.map((n) => [n.id, { x: n.x, y: n.y }])));
		const ns: SimNode[] = g.nodes.map((n) => ({
			...n,
			x: prev.get(n.id)?.x ?? W / 2 + (Math.random() - 0.5) * 300,
			y: prev.get(n.id)?.y ?? H / 2 + (Math.random() - 0.5) * 300
		}));
		const ls: SimLink[] = g.edges.map((e) => ({ source: e.source, target: e.target, via: e.via }));
		sim = forceSimulation<SimNode>(ns)
			.force(
				'link',
				forceLink<SimNode, SimLink>(ls)
					.id((d) => d.id)
					.distance(90)
					.strength(0.3)
			)
			.force('charge', forceManyBody().strength(-320))
			.force('center', forceCenter(W / 2, H / 2))
			.force('collide', forceCollide(R * 2.4))
			.on('tick', () => {
				nodes = [...ns];
				links = [...ls];
			});
	}

	function relayout() {
		for (const n of nodes) {
			n.x = W / 2 + (Math.random() - 0.5) * 300;
			n.y = H / 2 + (Math.random() - 0.5) * 300;
		}
		sim?.alpha(1).restart();
	}

	const asNode = (v: SimNode | string | number): SimNode | null =>
		typeof v === 'object' ? v : null;

	const idOf = (v: SimNode | string | number): string =>
		typeof v === 'object' ? v.id : String(v);

	const neighborIds = $derived.by(() => {
		if (!selectedId) return null;
		const s = new Set<string>([selectedId]);
		for (const l of links) {
			const a = idOf(l.source);
			const b = idOf(l.target);
			if (a === selectedId) s.add(b);
			if (b === selectedId) s.add(a);
		}
		return s;
	});

	const selectedNode = $derived(nodes.find((n) => n.id === selectedId) ?? null);

	function addPattern(p: string) {
		const v = p.trim();
		if (v && !patterns.includes(v)) patterns = [...patterns, v];
		patternInput = '';
	}

	function hideSelected() {
		if (selectedId) addPattern(selectedId);
		selectedId = null;
	}

	function patternLabel(p: string): string {
		return data?.names[p.toUpperCase()] ?? data?.names[p] ?? p;
	}

	function short(name: string): string {
		return name.length > 40 ? `${name.slice(0, 39)}…` : name;
	}

	function nodeR(id: string): number {
		return id === focus.id ? R * 1.6 : R;
	}

	function trimEnd(a: SimNode, b: SimNode): { x: number; y: number } {
		const dx = (b.x ?? 0) - (a.x ?? 0);
		const dy = (b.y ?? 0) - (a.y ?? 0);
		const d = Math.hypot(dx, dy) || 1;
		const gap = nodeR(b.id) + 5;
		return { x: (b.x ?? 0) - (dx / d) * gap, y: (b.y ?? 0) - (dy / d) * gap };
	}

	// --- pan / zoom / drag -------------------------------------------------

	type Drag =
		| { kind: 'node'; node: SimNode; moved: boolean }
		| { kind: 'pan'; startX: number; startY: number; viewX: number; viewY: number; moved: boolean };
	let drag: Drag | null = null;

	function svgPoint(e: { clientX: number; clientY: number }): { x: number; y: number } {
		const r = svgEl!.getBoundingClientRect();
		const s = Math.min(r.width / W, r.height / H);
		const ox = (r.width - W * s) / 2;
		const oy = (r.height - H * s) / 2;
		return { x: (e.clientX - r.left - ox) / s, y: (e.clientY - r.top - oy) / s };
	}

	function toGraph(p: { x: number; y: number }): { x: number; y: number } {
		return { x: (p.x - view.x) / view.k, y: (p.y - view.y) / view.k };
	}

	function nodeDown(e: PointerEvent, n: SimNode) {
		e.stopPropagation();
		svgEl!.setPointerCapture(e.pointerId);
		n.fx = n.x;
		n.fy = n.y;
		drag = { kind: 'node', node: n, moved: false };
		sim?.alphaTarget(0.25).restart();
	}

	function bgDown(e: PointerEvent) {
		svgEl!.setPointerCapture(e.pointerId);
		const p = svgPoint(e);
		drag = { kind: 'pan', startX: p.x, startY: p.y, viewX: view.x, viewY: view.y, moved: false };
	}

	function onMove(e: PointerEvent) {
		if (!drag) return;
		const p = svgPoint(e);
		if (drag.kind === 'node') {
			const g = toGraph(p);
			drag.node.fx = g.x;
			drag.node.fy = g.y;
			drag.moved = true;
		} else {
			const dx = p.x - drag.startX;
			const dy = p.y - drag.startY;
			if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true;
			view = { ...view, x: drag.viewX + dx, y: drag.viewY + dy };
		}
	}

	function onUp() {
		if (!drag) return;
		if (drag.kind === 'node') {
			sim?.alphaTarget(0);
			const n = drag.node;
			n.fx = null;
			n.fy = null;
			if (!drag.moved) selectedId = selectedId === n.id ? null : n.id;
		} else if (!drag.moved) {
			selectedId = null;
		}
		drag = null;
	}

	function onWheel(e: WheelEvent) {
		e.preventDefault();
		const p = svgPoint(e);
		const k = Math.min(4, Math.max(0.2, view.k * Math.exp(-e.deltaY * 0.0015)));
		const g = toGraph(p);
		view = { x: p.x - g.x * k, y: p.y - g.y * k, k };
	}

	function onkeydown(e: KeyboardEvent) {
		if (e.key !== 'Escape') return;
		if (selectedId) selectedId = null;
		else onclose();
	}
</script>

<svelte:window {onkeydown} />

<div class="backdrop" onclick={(e) => e.target === e.currentTarget && onclose()} role="presentation">
	<div class="panel" role="dialog" aria-modal="true" aria-label="Service call graph">
		<header>
			<h2>Service call graph — {focus.name}</h2>
			{#if graph}
				<span class="muted stats">
					{graph.nodes.length} services · {graph.edges.length} calls
					{#if graph.hiddenCount}· {graph.hiddenCount} hidden{/if}
				</span>
			{/if}
			<div class="head-actions">
				<button class="btn btn-sm" onclick={relayout} disabled={!graph}>Re-layout</button>
				<button class="btn btn-sm" onclick={() => load(true)} disabled={loading}>Refresh</button>
				<button class="close" onclick={onclose} aria-label="Close">&times;</button>
			</div>
		</header>

		<div class="controls">
			<div class="exclude">
				<input
					class="input"
					placeholder="Hide: name contains, or entity ID"
					bind:value={patternInput}
					onkeydown={(e) => e.key === 'Enter' && addPattern(patternInput)}
				/>
				<button class="btn btn-sm" onclick={() => addPattern(patternInput)} disabled={!patternInput.trim()}>
					Hide
				</button>
				{#each patterns as p (p)}
					<span class="chip" title={p}>
						{short(patternLabel(p))}
						<button
							class="chip-x"
							onclick={() => (patterns = patterns.filter((x) => x !== p))}
							aria-label="Stop hiding {p}">&times;</button
						>
					</span>
				{/each}
			</div>
			<label class="toggle">
				<input type="checkbox" bind:checked={showGhosts} /> Outside services
			</label>
			<label class="toggle">
				<input type="checkbox" bind:checked={hideUnconnected} /> Hide unconnected
			</label>
		</div>

		<div class="canvas">
			{#if loading}
				<p class="muted center">Loading call topology…</p>
			{:else if error}
				<p class="error center">{error}</p>
			{:else if graph && graph.nodes.length === 0}
				<p class="muted center">Nothing to draw — every service is hidden or unconnected.</p>
			{:else}
				<svg
					bind:this={svgEl}
					viewBox="0 0 {W} {H}"
					onpointerdown={bgDown}
					onpointermove={onMove}
					onpointerup={onUp}
					onwheel={onWheel}
					role="presentation"
				>
					<defs>
						<marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
							<path d="M 0 1 L 9 5 L 0 9 z" class="arrow-head" />
						</marker>
					</defs>
					<g transform="translate({view.x} {view.y}) scale({view.k})">
						{#each links as l (idOf(l.source) + '>' + idOf(l.target))}
							{@const a = asNode(l.source)}
							{@const b = asNode(l.target)}
							{#if a && b}
								{@const end = trimEnd(a, b)}
								{@const dimmed =
									neighborIds && idOf(l.source) !== selectedId && idOf(l.target) !== selectedId}
								<line
									x1={a.x}
									y1={a.y}
									x2={end.x}
									y2={end.y}
									class="edge"
									class:bridged={l.via.length > 0}
									class:dim={dimmed}
									marker-end="url(#arrow)"
								>
									<title>{a.name} → {b.name}{l.via.length ? ` via ${l.via.join(' → ')}` : ''}</title>
								</line>
								{#if l.via.length > 0}
									<text
										class="via-label"
										class:dim={dimmed}
										x={((a.x ?? 0) + (b.x ?? 0)) / 2}
										y={((a.y ?? 0) + (b.y ?? 0)) / 2 - 4}
									>
										via {short(l.via.join(' → '))}
									</text>
								{/if}
							{/if}
						{/each}
						{#each nodes as n (n.id)}
							<g
								transform="translate({n.x ?? 0} {n.y ?? 0})"
								class="node"
								class:ghost={n.ghost}
								class:focus={n.id === focus.id}
								class:selected={n.id === selectedId}
								class:dim={neighborIds && !neighborIds.has(n.id)}
								onpointerdown={(e) => nodeDown(e, n)}
								role="presentation"
							>
								<circle r={nodeR(n.id)} />
								<text y={nodeR(n.id) + 13}>{short(n.name)}</text>
								<title>{n.name}</title>
							</g>
						{/each}
					</g>
				</svg>

				{#if selectedNode}
					<div class="info">
						<strong>{selectedNode.name}</strong>
						<code>{selectedNode.id}</code>
						<div class="info-actions">
							<a
								class="btn btn-sm"
								href="{connection.baseUrl}/ui/entity/{selectedNode.id}"
								target="_blank"
								rel="noopener noreferrer">Open in Dynatrace</a
							>
							{#if selectedNode.id !== focus.id}
								<button class="btn btn-sm" onclick={() => focusOn(selectedNode!)}>
									Focus graph here
								</button>
							{/if}
							<button class="btn btn-sm" onclick={hideSelected}>Hide this service</button>
						</div>
					</div>
				{/if}

				<div class="legend muted">
					<span><svg width="22" height="8"><line x1="0" y1="4" x2="22" y2="4" class="edge" /></svg> direct call</span>
					<span><svg width="22" height="8"><line x1="0" y1="4" x2="22" y2="4" class="edge bridged" /></svg> via hidden service</span>
					<span><svg width="14" height="14"><circle cx="7" cy="7" r="5" class="ghost-swatch" /></svg> outside current list</span>
				</div>
			{/if}
		</div>
	</div>
</div>

<style>
	.backdrop {
		position: fixed;
		inset: 0;
		background: rgba(20, 24, 40, 0.45);
		display: flex;
		align-items: center;
		justify-content: center;
		z-index: 50;
	}

	.panel {
		display: flex;
		flex-direction: column;
		width: min(1500px, calc(96vw / var(--app-zoom, 1)));
		height: calc(92vh / var(--app-zoom, 1));
		background: var(--surface);
		border-radius: 12px;
		box-shadow: var(--shadow);
		overflow: hidden;
	}

	header {
		display: flex;
		align-items: center;
		gap: 12px;
		padding: 14px 18px 10px;
		border-bottom: 1px solid var(--border);
	}

	header h2 {
		font-size: 16px;
	}

	.stats {
		font-size: 12.5px;
	}

	.head-actions {
		margin-left: auto;
		display: flex;
		align-items: center;
		gap: 8px;
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

	.controls {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 12px;
		padding: 10px 18px;
		border-bottom: 1px solid var(--border);
	}

	.exclude {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 6px;
		flex: 1;
		min-width: 280px;
	}

	.exclude .input {
		width: 240px;
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

	.toggle {
		display: flex;
		align-items: center;
		gap: 5px;
		font-size: 13px;
		white-space: nowrap;
	}

	.canvas {
		position: relative;
		flex: 1;
		min-height: 0;
		background: var(--bg);
	}

	svg {
		width: 100%;
		height: 100%;
		display: block;
		touch-action: none;
		cursor: grab;
	}

	.center {
		position: absolute;
		inset: 0;
		display: flex;
		align-items: center;
		justify-content: center;
	}

	.error {
		color: var(--danger);
	}

	.edge {
		stroke: var(--muted);
		stroke-opacity: 0.45;
		stroke-width: 1.4;
	}

	.edge.bridged {
		stroke-dasharray: 5 4;
	}

	.arrow-head {
		fill: var(--muted);
		fill-opacity: 0.6;
	}

	.node {
		cursor: pointer;
	}

	.node circle {
		fill: var(--accent);
		stroke: var(--surface);
		stroke-width: 1.5;
	}

	.node.ghost circle,
	.ghost-swatch {
		fill: var(--surface);
		stroke: var(--muted);
		stroke-dasharray: 3 2;
	}

	.node.selected circle {
		stroke: var(--accent-strong);
		stroke-width: 3;
		stroke-dasharray: none;
	}

	.node.focus circle {
		fill: var(--accent-strong);
	}

	.node.focus text {
		font-weight: 650;
	}

	.via-label {
		fill: var(--muted);
		font-size: 9px;
		text-anchor: middle;
		paint-order: stroke;
		stroke: var(--bg);
		stroke-width: 3;
		stroke-linejoin: round;
		pointer-events: none;
	}

	.via-label.dim {
		opacity: 0.18;
	}

	.node text {
		fill: var(--text);
		font-size: 10.5px;
		text-anchor: middle;
		paint-order: stroke;
		stroke: var(--bg);
		stroke-width: 3;
		stroke-linejoin: round;
	}

	.node.dim,
	.edge.dim {
		opacity: 0.18;
	}

	.info {
		position: absolute;
		top: 12px;
		left: 12px;
		max-width: 320px;
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius);
		padding: 10px 12px;
		display: flex;
		flex-direction: column;
		gap: 6px;
	}

	.info code {
		font-size: 11px;
		overflow-wrap: anywhere;
	}

	.info-actions {
		display: flex;
		gap: 6px;
	}

	.legend {
		position: absolute;
		bottom: 10px;
		left: 12px;
		display: flex;
		gap: 16px;
		font-size: 12px;
		align-items: center;
	}

	.legend span {
		display: inline-flex;
		align-items: center;
		gap: 5px;
	}

	.legend .edge {
		stroke-opacity: 0.8;
	}
</style>
