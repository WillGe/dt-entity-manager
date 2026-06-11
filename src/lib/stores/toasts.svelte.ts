export interface Toast {
	id: number;
	kind: 'success' | 'error' | 'info';
	message: string;
}

let nextId = 1;

class ToastStore {
	items = $state<Toast[]>([]);

	push(kind: Toast['kind'], message: string, timeoutMs = kind === 'error' ? 8000 : 4000): void {
		const id = nextId++;
		this.items.push({ id, kind, message });
		setTimeout(() => this.dismiss(id), timeoutMs);
	}

	success(message: string): void {
		this.push('success', message);
	}

	error(message: string): void {
		this.push('error', message);
	}

	info(message: string): void {
		this.push('info', message);
	}

	dismiss(id: number): void {
		this.items = this.items.filter((t) => t.id !== id);
	}
}

export const toasts = new ToastStore();
