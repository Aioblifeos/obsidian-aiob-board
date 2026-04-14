import { TFile, TFolder, TAbstractFile } from 'obsidian';
import type AiobPlugin from '../main';

/**
 * Displays file count and total word count next to folder names
 * in Obsidian's file explorer.
 */
export class FolderStatsService {
	private mutationObserver: MutationObserver | null = null;
	private styleEl: HTMLStyleElement | null = null;
	private debouncedApply: () => void;

	/** Cached per-file word counts: path → wordCount */
	private fileWordCounts = new Map<string, number>();
	/** Cached per-folder stats: folderPath → { files, words } */
	private folderCache = new Map<string, { files: number; words: number }>();
	private cacheValid = false;

	constructor(private plugin: AiobPlugin) {
		this.debouncedApply = this.debounce(() => this.applyStats(), 200);
	}

	start(): void {
		this.addDynamicCSS();
		this.setupMutationObserver();
		this.registerVaultEvents();
		void this.rebuildAndApply();
	}

	destroy(): void {
		this.mutationObserver?.disconnect();
		this.mutationObserver = null;
		this.styleEl?.remove();
		this.styleEl = null;
		this.cleanupDOM();
		this.fileWordCounts.clear();
		this.folderCache.clear();
	}

	/** Force full refresh (e.g. after toggling the feature on). */
	refresh(): void {
		this.cacheValid = false;
		void this.rebuildAndApply();
	}

	// ── Core logic ──

	private async rebuildAndApply(): Promise<void> {
		await this.buildCache();
		this.applyStats();
	}

	private async buildCache(): Promise<void> {
		const { vault } = this.plugin.app;
		const files = vault.getFiles().filter(f => f.extension === 'md');

		// Read word counts for files not yet cached
		const toRead: TFile[] = [];
		for (const file of files) {
			if (!this.fileWordCounts.has(file.path)) {
				toRead.push(file);
			}
		}

		// Batch read in chunks to avoid blocking
		const CHUNK = 50;
		for (let i = 0; i < toRead.length; i += CHUNK) {
			const chunk = toRead.slice(i, i + CHUNK);
			await Promise.all(chunk.map(async (file) => {
				try {
					const content = await vault.cachedRead(file);
					this.fileWordCounts.set(file.path, this.countWords(content));
				} catch {
					this.fileWordCounts.set(file.path, 0);
				}
			}));
		}

		// Remove stale entries
		for (const path of this.fileWordCounts.keys()) {
			if (!vault.getAbstractFileByPath(path)) {
				this.fileWordCounts.delete(path);
			}
		}

		// Aggregate into folder stats
		this.folderCache.clear();
		for (const file of files) {
			const words = this.fileWordCounts.get(file.path) ?? 0;
			// Walk up the folder hierarchy
			let dir = file.parent;
			while (dir && dir.path !== '/') {
				const key = dir.path;
				const existing = this.folderCache.get(key);
				if (existing) {
					existing.files += 1;
					existing.words += words;
				} else {
					this.folderCache.set(key, { files: 1, words });
				}
				dir = dir.parent;
			}
			// Root folder
			const root = this.folderCache.get('');
			if (root) {
				root.files += 1;
				root.words += words;
			} else {
				this.folderCache.set('', { files: 1, words });
			}
		}

		this.cacheValid = true;
	}

	private applyStats(): void {
		if (!this.cacheValid) return;

		document.querySelectorAll('.nav-folder-title').forEach(titleEl => {
			const el = titleEl as HTMLElement;
			const folderPath = el.getAttribute('data-path');
			if (folderPath == null) return;

			const stats = this.folderCache.get(folderPath);
			if (!stats || stats.files === 0) {
				el.querySelector('.aiob-folder-stats')?.remove();
				return;
			}

			let badge = el.querySelector('.aiob-folder-stats') as HTMLElement | null;
			const text = `${stats.files} · ${this.formatWords(stats.words)}`;

			if (badge) {
				if (badge.textContent !== text) badge.textContent = text;
				badge.classList.add('is-ready');
			} else {
				badge = document.createElement('span');
				badge.className = 'aiob-folder-stats is-ready';
				badge.textContent = text;
				el.appendChild(badge);
			}
		});
	}

	// ── Vault events ──

	private registerVaultEvents(): void {
		const handler = (kind: string, file: TAbstractFile) => {
			if (!(file instanceof TFile) || file.extension !== 'md') return;
			if (kind === 'delete') {
				this.fileWordCounts.delete(file.path);
				this.invalidateAndApply();
			} else {
				// create or modify — re-read word count
				void this.updateFile(file);
			}
		};

		this.plugin.registerEvent(this.plugin.app.vault.on('create', (f) => handler('create', f)));
		this.plugin.registerEvent(this.plugin.app.vault.on('modify', (f) => handler('modify', f)));
		this.plugin.registerEvent(this.plugin.app.vault.on('delete', (f) => handler('delete', f)));
		this.plugin.registerEvent(this.plugin.app.vault.on('rename', (f, oldPath) => {
			if (!(f instanceof TFile) || f.extension !== 'md') return;
			this.fileWordCounts.delete(oldPath);
			void this.updateFile(f);
		}));
	}

	private async updateFile(file: TFile): Promise<void> {
		try {
			const content = await this.plugin.app.vault.cachedRead(file);
			this.fileWordCounts.set(file.path, this.countWords(content));
		} catch {
			this.fileWordCounts.set(file.path, 0);
		}
		this.invalidateAndApply();
	}

	private invalidateAndApply(): void {
		// Rebuild folder aggregation from fileWordCounts (cheap — no disk I/O)
		const { vault } = this.plugin.app;
		const files = vault.getFiles().filter(f => f.extension === 'md');
		this.folderCache.clear();
		for (const file of files) {
			const words = this.fileWordCounts.get(file.path) ?? 0;
			let dir = file.parent;
			while (dir && dir.path !== '/') {
				const key = dir.path;
				const existing = this.folderCache.get(key);
				if (existing) {
					existing.files += 1;
					existing.words += words;
				} else {
					this.folderCache.set(key, { files: 1, words });
				}
				dir = dir.parent;
			}
			const root = this.folderCache.get('');
			if (root) {
				root.files += 1;
				root.words += words;
			} else {
				this.folderCache.set('', { files: 1, words });
			}
		}
		this.cacheValid = true;
		this.debouncedApply();
	}

	// ── Word counting (same logic as main.ts) ──

	private countWords(text: string): number {
		const body = text.replace(/^---[\s\S]*?---\n?/, '').replace(/<[^>]+>/g, '');
		const chinese = (body.match(/[\u4e00-\u9fff]/g) || []).length;
		const english = (body.match(/[a-zA-Z]+/g) || []).length;
		return chinese + english;
	}

	// ── Formatting ──

	private formatWords(count: number): string {
		if (count < 1000) return `${count}`;
		if (count < 10000) return `${(count / 1000).toFixed(1)}k`;
		return `${Math.round(count / 1000)}k`;
	}

	// ── DOM observation ──

	private setupMutationObserver(): void {
		this.mutationObserver = new MutationObserver((mutations) => {
			let relevant = false;
			for (const m of mutations) {
				if (m.addedNodes.length > 0 || m.removedNodes.length > 0) {
					m.addedNodes.forEach(node => {
						if (relevant) return;
						if (node instanceof HTMLElement && (
							node.classList?.contains('nav-folder') ||
							node.classList?.contains('nav-folder-title') ||
							node.querySelector?.('.nav-folder-title')
						)) {
							relevant = true;
						}
					});
					if (relevant) break;
				}
			}
			if (relevant) this.debouncedApply();
		});
		this.mutationObserver.observe(document.body, {
			childList: true,
			subtree: true,
		});
	}

	private addDynamicCSS(): void {
		this.styleEl?.remove();
		const style = document.createElement('style');
		style.id = 'aiob-folder-stats-css';
		style.textContent = `
			.aiob-folder-stats {
				display: none;
				margin-left: auto;
				padding-right: 4px;
				font-size: 0.85em;
				color: inherit;
				opacity: 0.6;
				font-weight: 400;
				pointer-events: none;
				white-space: nowrap;
			}
			.aiob-folder-stats.is-ready {
				display: inline-block;
			}
		`;
		document.head.appendChild(style);
		this.styleEl = style;
	}

	private cleanupDOM(): void {
		document.querySelectorAll('.aiob-folder-stats').forEach(el => el.remove());
	}

	private debounce(func: () => void, wait: number): () => void {
		let timeout: number | undefined;
		return () => {
			clearTimeout(timeout);
			timeout = window.setTimeout(func, wait);
		};
	}
}
