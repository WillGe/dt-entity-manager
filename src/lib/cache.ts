/**
 * localStorage cache with TTL. Every Dynatrace read goes through here first
 * so repeat browsing doesn't burn API rate limits.
 */
const NS = 'dtem:cache:';

interface CacheEntry<T> {
	fetchedAt: number;
	value: T;
}

export interface CacheHit<T> {
	value: T;
	fetchedAt: number;
}

export function getCached<T>(key: string, ttlMs: number): CacheHit<T> | null {
	const raw = localStorage.getItem(NS + key);
	if (!raw) return null;
	try {
		const entry = JSON.parse(raw) as CacheEntry<T>;
		if (Date.now() - entry.fetchedAt > ttlMs) return null;
		return { value: entry.value, fetchedAt: entry.fetchedAt };
	} catch {
		localStorage.removeItem(NS + key);
		return null;
	}
}

export function setCached<T>(key: string, value: T): void {
	const entry: CacheEntry<T> = { fetchedAt: Date.now(), value };
	try {
		localStorage.setItem(NS + key, JSON.stringify(entry));
	} catch {
		// Quota exceeded: evict the oldest half of cache entries and retry once.
		evictOldest(Math.max(1, Math.floor(cacheKeys().length / 2)));
		try {
			localStorage.setItem(NS + key, JSON.stringify(entry));
		} catch {
			// Give up silently; the app works without cache, just less efficiently.
		}
	}
}

/** Patch a cached value in place (e.g. after adding tags) without touching its age. */
export function updateCached<T>(key: string, update: (value: T) => T): void {
	const raw = localStorage.getItem(NS + key);
	if (!raw) return;
	try {
		const entry = JSON.parse(raw) as CacheEntry<T>;
		entry.value = update(entry.value);
		localStorage.setItem(NS + key, JSON.stringify(entry));
	} catch {
		localStorage.removeItem(NS + key);
	}
}

/** Patch every cached value whose key starts with the prefix. */
export function updateCachedByPrefix<T>(prefix: string, update: (value: T) => T): void {
	for (const k of cacheKeys()) {
		if (k.startsWith(NS + prefix)) updateCached(k.slice(NS.length), update);
	}
}

/** Approximate bytes used by cached API data (JS strings are UTF-16). */
export function cacheSizeBytes(): number {
	let chars = 0;
	for (const k of cacheKeys()) chars += k.length + (localStorage.getItem(k)?.length ?? 0);
	return chars * 2;
}

export function invalidateCache(prefix = ''): void {
	for (const k of cacheKeys()) {
		if (k.startsWith(NS + prefix)) localStorage.removeItem(k);
	}
}

function cacheKeys(): string[] {
	const keys: string[] = [];
	for (let i = 0; i < localStorage.length; i++) {
		const k = localStorage.key(i);
		if (k?.startsWith(NS)) keys.push(k);
	}
	return keys;
}

function evictOldest(count: number): void {
	const aged = cacheKeys()
		.map((k) => {
			try {
				return { k, fetchedAt: (JSON.parse(localStorage.getItem(k)!) as CacheEntry<unknown>).fetchedAt };
			} catch {
				return { k, fetchedAt: 0 };
			}
		})
		.sort((a, b) => a.fetchedAt - b.fetchedAt);
	for (const { k } of aged.slice(0, count)) localStorage.removeItem(k);
}
