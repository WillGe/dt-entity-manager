const STORAGE_KEY = 'dtem:theme';

export type Theme = 'auto' | 'light' | 'dark';

/**
 * Colors are defined with CSS light-dark() in app.css; this store only flips
 * the color-scheme via data-theme on <html>. 'auto' follows the OS preference.
 */
class ThemeStore {
	current = $state<Theme>('auto');

	constructor() {
		const saved = localStorage.getItem(STORAGE_KEY);
		if (saved === 'light' || saved === 'dark') this.current = saved;
		this.apply();
	}

	cycle(): void {
		this.current = this.current === 'auto' ? 'dark' : this.current === 'dark' ? 'light' : 'auto';
		if (this.current === 'auto') localStorage.removeItem(STORAGE_KEY);
		else localStorage.setItem(STORAGE_KEY, this.current);
		this.apply();
	}

	label = $derived(
		this.current === 'auto' ? '◐ Auto' : this.current === 'dark' ? '☾ Dark' : '☀ Light'
	);

	private apply(): void {
		if (this.current === 'auto') delete document.documentElement.dataset.theme;
		else document.documentElement.dataset.theme = this.current;
	}
}

export const theme = new ThemeStore();
