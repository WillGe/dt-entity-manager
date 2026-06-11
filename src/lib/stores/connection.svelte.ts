import { invalidateCache } from '$lib/cache';

const STORAGE_KEY = 'dtem:connection';

class ConnectionStore {
	baseUrl = $state('');
	token = $state('');

	configured = $derived(this.baseUrl.trim() !== '' && this.token.trim() !== '');

	constructor() {
		const raw = localStorage.getItem(STORAGE_KEY);
		if (raw) {
			try {
				const saved = JSON.parse(raw) as { baseUrl: string; token: string };
				this.baseUrl = saved.baseUrl ?? '';
				this.token = saved.token ?? '';
			} catch {
				localStorage.removeItem(STORAGE_KEY);
			}
		}
	}

	save(baseUrl: string, token: string): void {
		const next = baseUrl.trim().replace(/\/+$/, '');
		// Cached entities from another environment would be silently wrong.
		if (this.baseUrl && this.baseUrl !== next) invalidateCache();
		this.baseUrl = next;
		this.token = token.trim();
		localStorage.setItem(STORAGE_KEY, JSON.stringify({ baseUrl: this.baseUrl, token: this.token }));
	}

	headers(): Record<string, string> {
		return { 'x-dt-base-url': this.baseUrl, 'x-dt-token': this.token };
	}
}

export const connection = new ConnectionStore();
