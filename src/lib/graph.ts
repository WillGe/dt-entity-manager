import type { CallEdgesResult } from '$lib/types';

export interface GraphNode {
	id: string;
	name: string;
	/** true when the service is outside the currently loaded list */
	ghost: boolean;
}

export interface GraphEdge {
	source: string;
	target: string;
	/** names of hidden nodes this edge was bridged through (empty = direct call) */
	via: string[];
}

export interface CallGraph {
	nodes: GraphNode[];
	edges: GraphEdge[];
	hiddenCount: number;
}

export interface GraphOptions {
	/** lowercase name substrings, or exact entity IDs, to hide */
	excludePatterns: string[];
	/** include services that are called but not part of the loaded list */
	showGhosts: boolean;
	hideUnconnected: boolean;
}

const ENTITY_ID_RE = /^[A-Z][A-Z0-9_]*-[0-9A-F]{16}$/i;

export function matchesPattern(pattern: string, id: string, name: string): boolean {
	const p = pattern.trim().toLowerCase();
	if (!p) return false;
	if (ENTITY_ID_RE.test(p)) return id.toLowerCase() === p;
	return name.toLowerCase().includes(p);
}

/**
 * Build the renderable graph. Nodes excluded by pattern or by the ghost toggle
 * are not simply dropped: edges are bridged through them (A → hidden → B becomes
 * a dashed A → B "via hidden"), so hiding an L7 middleman keeps the real
 * service-to-service dependencies visible.
 */
export function buildCallGraph(data: CallEdgesResult, loadedIds: Set<string>, opts: GraphOptions): CallGraph {
	const ids = Object.keys(data.names);
	const nameOf = (id: string) => data.names[id] ?? id;
	const isGhost = (id: string) => !loadedIds.has(id);

	const visible = new Set(
		ids.filter(
			(id) =>
				!(isGhost(id) && !opts.showGhosts) &&
				!opts.excludePatterns.some((p) => matchesPattern(p, id, nameOf(id)))
		)
	);

	const edgeMap = new Map<string, GraphEdge>();
	for (const source of visible) {
		for (const [target, via] of bridgedTargets(source, data.calls, visible)) {
			if (target === source) continue;
			const key = `${source}>${target}`;
			const existing = edgeMap.get(key);
			const edge = { source, target, via: via.map(nameOf) };
			if (!existing || existing.via.length > edge.via.length) edgeMap.set(key, edge);
		}
	}
	const edges = [...edgeMap.values()];

	let nodeIds = [...visible];
	if (opts.hideUnconnected) {
		const connected = new Set(edges.flatMap((e) => [e.source, e.target]));
		nodeIds = nodeIds.filter((id) => connected.has(id));
	}

	return {
		nodes: nodeIds.map((id) => ({ id, name: nameOf(id), ghost: isGhost(id) })),
		edges,
		hiddenCount: ids.length - visible.size
	};
}

/** Visible successors of `start`, walking through any chain of non-visible nodes. */
function bridgedTargets(
	start: string,
	calls: Record<string, string[]>,
	visible: Set<string>
): Map<string, string[]> {
	const out = new Map<string, string[]>();
	const seenHidden = new Set<string>();
	const stack: [string, string[]][] = (calls[start] ?? []).map((t) => [t, []]);
	while (stack.length > 0) {
		const [current, via] = stack.pop()!;
		if (visible.has(current)) {
			const existing = out.get(current);
			if (!existing || existing.length > via.length) out.set(current, via);
			continue;
		}
		if (seenHidden.has(current) || current === start) continue;
		seenHidden.add(current);
		for (const next of calls[current] ?? []) stack.push([next, [...via, current]]);
	}
	return out;
}
