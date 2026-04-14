import { Menu, TFile, TFolder, TAbstractFile } from 'obsidian';
import type AiobPlugin from '../main';
import { createDialogShell, presentDialogShell, createDialogRow } from '../views/dialogs/core';

/**
 * Lets users right-click folders in the file explorer to set
 * a custom background color and title text color.
 */
export class FolderColorizerService {
	private mutationObserver: MutationObserver | null = null;
	private styleEl: HTMLStyleElement | null = null;
	private debouncedApply: () => void;

	constructor(private plugin: AiobPlugin) {
		this.debouncedApply = this.debounce(() => this.applyColors(), 100);
	}

	start(): void {
		this.injectStyleSheet();
		this.setupMutationObserver();
		this.setupFileMenu();

		this.plugin.registerEvent(
			this.plugin.app.workspace.on('layout-change', () => this.debouncedApply()),
		);
	}

	destroy(): void {
		this.mutationObserver?.disconnect();
		this.mutationObserver = null;
		this.styleEl?.remove();
		this.styleEl = null;
		this.cleanupDOM();
	}

	refresh(): void {
		this.applyColors();
	}

	// ── Apply colors to DOM ──

	/** Re-generate the stylesheet with color rules — no inline styles needed. */
	private applyColors(): void {
		this.injectStyleSheet();
	}

	// ── Inject into Obsidian's native file-menu ──

	private setupFileMenu(): void {
		this.plugin.registerEvent(
			this.plugin.app.workspace.on('file-menu', (menu: Menu, file: TAbstractFile) => {
				const itemPath = file.path;
				const isFolder = file instanceof TFolder;
				const label = isFolder ? '文件夹' : '文件';
				const current = this.plugin.data.config.folderColors?.[itemPath];

				menu.addSeparator();

				menu.addItem(i => i
					.setTitle(`设置${label}颜色`)
					.setIcon('palette')
					.onClick(() => this.showColorDialog(itemPath, current))
				);

				if (current?.bg || current?.text) {
					menu.addItem(i => i
						.setTitle(`清除${label}颜色`)
						.setIcon('eraser')
						.onClick(async () => {
							delete this.plugin.data.config.folderColors[itemPath];
							await this.plugin.saveData(this.plugin.data);
							this.applyColors();
						})
					);
				}
			}),
		);
	}

	private showColorDialog(
		folderPath: string,
		current?: { bg?: string; text?: string },
	): void {
		const folderName = folderPath.split('/').pop() || folderPath;
		const { overlay, card } = createDialogShell(`文件夹颜色 · ${folderName}`);

		let bgColor = current?.bg || '';
		let textColor = current?.text || '';

		// Background color row
		const bgRow = createDialogRow(card, '背景色');
		bgRow.addClass('aiob-fc-color-row');
		const bgInput = bgRow.createEl('input', {
			type: 'color',
			cls: 'aiob-fc-swatch',
			value: bgColor || '#e8e8e8',
		});
		const bgClear = bgRow.createEl('button', {
			cls: 'aiob-fc-clear-btn',
			text: '清除',
		});
		bgInput.addEventListener('input', () => { bgColor = bgInput.value; });
		bgClear.addEventListener('click', () => {
			bgColor = '';
			bgInput.value = '#e8e8e8';
		});

		// Text color row
		const textRow = createDialogRow(card, '文字颜色');
		textRow.addClass('aiob-fc-color-row');
		const textInput = textRow.createEl('input', {
			type: 'color',
			cls: 'aiob-fc-swatch',
			value: textColor || '#333333',
		});
		const textClear = textRow.createEl('button', {
			cls: 'aiob-fc-clear-btn',
			text: '清除',
		});
		textInput.addEventListener('input', () => { textColor = textInput.value; });
		textClear.addEventListener('click', () => {
			textColor = '';
			textInput.value = '#333333';
		});

		// Submit
		const submitRow = card.createDiv({ cls: 'aiob-dialog-submit-row' });
		const saveBtn = submitRow.createEl('button', {
			cls: 'aiob-dialog-submit-btn',
			text: '保存',
		});
		saveBtn.addEventListener('click', async () => {
			if (!this.plugin.data.config.folderColors) {
				this.plugin.data.config.folderColors = {};
			}
			if (bgColor || textColor) {
				this.plugin.data.config.folderColors[folderPath] = {
					...(bgColor ? { bg: bgColor } : {}),
					...(textColor ? { text: textColor } : {}),
				};
			} else {
				delete this.plugin.data.config.folderColors[folderPath];
			}
			await this.plugin.saveData(this.plugin.data);
			this.applyColors();
			overlay.remove();
		});

		presentDialogShell(overlay, card);
	}

	// ── DOM observation ──

	private setupMutationObserver(): void {
		this.mutationObserver = new MutationObserver((mutations) => {
			let relevant = false;
			for (const m of mutations) {
				if (m.addedNodes.length > 0) {
					m.addedNodes.forEach(node => {
						if (relevant) return;
						if (node instanceof HTMLElement && (
							node.classList?.contains('nav-folder') ||
							node.classList?.contains('nav-file') ||
							node.classList?.contains('nav-folder-title') ||
							node.classList?.contains('nav-file-title') ||
							node.querySelector?.('.nav-folder-title, .nav-file-title')
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

	/** Escape a file path for use in a CSS attribute selector. */
	private cssEscape(s: string): string {
		return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
	}

	/**
	 * Build and inject a single <style> that contains both the dialog UI styles
	 * and per-path color rules. Called on start and whenever colors change.
	 */
	private injectStyleSheet(): void {
		this.styleEl?.remove();
		const style = document.createElement('style');
		style.id = 'aiob-folder-colorizer-css';

		// Static dialog styles
		let css = `
			.aiob-fc-color-row {
				display: flex;
				align-items: center;
				gap: 8px;
			}
			.aiob-fc-color-row .aiob-dialog-label {
				flex: 1;
			}
			.aiob-fc-swatch {
				width: 36px;
				height: 36px;
				padding: 0;
				border: 2px solid var(--background-modifier-border);
				border-radius: 8px;
				cursor: pointer;
				background: none;
				-webkit-appearance: none;
				appearance: none;
			}
			.aiob-fc-swatch::-webkit-color-swatch-wrapper { padding: 2px; }
			.aiob-fc-swatch::-webkit-color-swatch { border: none; border-radius: 4px; }
			.aiob-fc-clear-btn {
				font-size: 0.78em;
				padding: 4px 8px;
				border-radius: 6px;
				border: 1px solid var(--background-modifier-border);
				background: var(--background-secondary);
				color: var(--text-muted);
				cursor: pointer;
			}
			.aiob-fc-clear-btn:hover {
				color: var(--text-normal);
				border-color: var(--interactive-accent);
			}
		`;

		// Per-path color rules — CSS attribute selectors, instant on render
		const colors = this.plugin.data.config.folderColors || {};
		for (const [path, cfg] of Object.entries(colors)) {
			const escaped = this.cssEscape(path);
			const sel = `.nav-folder-title[data-path="${escaped}"], .nav-file-title[data-path="${escaped}"]`;
			if (cfg.bg) {
				css += `${sel}, ${sel}:hover { background-color: ${cfg.bg} !important; border-radius: 6px; }\n`;
			}
			if (cfg.text) {
				css += `${sel} > .nav-folder-title-content, ${sel} > .nav-file-title-content, ${sel} .aiob-folder-stats { color: ${cfg.text} !important; opacity: 1 !important; }\n`;
			}
		}

		style.textContent = css;
		document.head.appendChild(style);
		this.styleEl = style;
	}

	private cleanupDOM(): void {
		// All styles are in the <style> tag — just removing it is enough.
	}

	private debounce(func: () => void, wait: number): () => void {
		let timeout: number | undefined;
		return () => {
			clearTimeout(timeout);
			timeout = window.setTimeout(func, wait);
		};
	}
}
