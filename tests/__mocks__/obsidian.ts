// Minimal obsidian mock for unit tests
import { vi } from 'vitest';

export class Plugin {}
export class Notice {
	constructor(_msg: string) {}
}
export class App {}
export class Menu {
	items: any[] = [];

	addItem(callback: (item: {
		setTitle: (_title: string) => any;
		setIcon: (_icon: string) => any;
		onClick: (_handler: () => void) => any;
	}) => void): this {
		const item = {
			setTitle: (_title: string) => item,
			setIcon: (_icon: string) => item,
			onClick: (_handler: () => void) => item,
		};
		callback(item);
		this.items.push(item);
		return this;
	}

	addSeparator(): this {
		return this;
	}

	showAtMouseEvent(_event: MouseEvent): void {}

	showAtPosition(_position: { x: number; y: number }): void {}
}
export class TAbstractFile {
	path = '';
}
export class TFile extends TAbstractFile {
	name = '';
	basename = '';
	extension = 'md';
	stat = { ctime: 0, mtime: 0, size: 0 };
}
export class TFolder extends TAbstractFile {
	children: TAbstractFile[] = [];
	isRoot(): boolean {
		return this.path === '';
	}
}
export class WorkspaceLeaf {
	view: any = {};
	async setViewState(_state: any): Promise<void> {}
	async openFile(_file: TFile): Promise<void> {}
}
export const Platform = { isMobile: false };
export const MarkdownRenderer = {
	renderMarkdown: async (_markdown: string, _container: HTMLElement, _sourcePath: string, _component: unknown): Promise<void> => {},
};
export const requestUrl = vi.fn(async () => ({ json: {} }));

export function setIcon(_element: HTMLElement, _icon: string): void {}

export function parseLinktext(linktext: string): { path: string; subpath: string } {
	const raw = String(linktext ?? '');
	const hashIndex = raw.indexOf('#');
	return {
		path: hashIndex >= 0 ? raw.slice(0, hashIndex) : raw,
		subpath: hashIndex >= 0 ? raw.slice(hashIndex) : '',
	};
}

export function parseYaml(raw: string): Record<string, unknown> {
	const text = String(raw ?? '').trim();
	if (!text) return {};
	try {
		return JSON.parse(text) as Record<string, unknown>;
	} catch {
		// Fall through to a tiny YAML subset parser used by tests.
	}
	const views: Array<Record<string, string>> = [];
	let inViews = false;
	let currentView: Record<string, string> | null = null;
	for (const line of text.split('\n')) {
		if (/^\s*views:\s*$/.test(line)) {
			inViews = true;
			currentView = null;
			continue;
		}
		if (!inViews) continue;
		if (/^\S/.test(line) && !/^\s*-\s*/.test(line) && !/^\s*name:\s*/.test(line)) {
			break;
		}
		if (/^\s*-\s*/.test(line)) {
			currentView = {};
			views.push(currentView);
			const inlineName = line.match(/name:\s*(.+?)\s*$/);
			if (inlineName) currentView.name = inlineName[1].replace(/^['"]|['"]$/g, '').trim();
			continue;
		}
		const nameMatch = line.match(/^\s*name:\s*(.+?)\s*$/);
		if (nameMatch && currentView) {
			currentView.name = nameMatch[1].replace(/^['"]|['"]$/g, '').trim();
		}
	}
	return views.length ? { views } : {};
}
