import { Menu, TFolder, TAbstractFile } from 'obsidian';
import type AiobPlugin from '../main';
import { createDialogShell, presentDialogShell, createDialogRow } from '../views/dialogs/core';

/**
 * Lets users right-click folders in the file explorer to set
 * a custom background color and title text color.
 */
export class FolderColorizerService {
	private mutationObserver: MutationObserver | null = null;
	private debouncedApply: () => void;

	constructor(private plugin: AiobPlugin) {
		this.debouncedApply = this.debounce(() => this.applyColors(), 100);
	}

	start(): void {
		this.applyColors();
		this.setupMutationObserver();
		this.setupFileMenu();

		this.plugin.registerEvent(
			this.plugin.app.workspace.on('layout-change', () => this.debouncedApply()),
		);
	}

	destroy(): void {
		this.mutationObserver?.disconnect();
		this.mutationObserver = null;
		this.cleanupDOM();
	}

	refresh(): void {
		this.applyColors();
	}

	// ── Apply colors to DOM ──

	private applyColors(): void {
		const colors = this.plugin.data.config.folderColors || {};

		// Clean up elements that no longer have color config
		document.querySelectorAll('.aiob-folder-colored').forEach(el => {
			const path = el.getAttribute('data-path');
			if (!path || !colors[path]) {
				el.classList.remove('aiob-folder-colored');
				(el as HTMLElement).style.removeProperty('--aiob-fc-bg');
				(el as HTMLElement).style.removeProperty('--aiob-fc-text');
			}
		});

		// Apply colors to matching elements
		for (const [path, cfg] of Object.entries(colors)) {
			if (!cfg.bg && !cfg.text) continue;
			const els = document.querySelectorAll(
				`.nav-folder-title[data-path="${CSS.escape(path)}"], .nav-file-title[data-path="${CSS.escape(path)}"]`,
			);
			els.forEach(el => {
				const htmlEl = el as HTMLElement;
				htmlEl.classList.add('aiob-folder-colored');
				if (cfg.bg) {
					htmlEl.style.setProperty('--aiob-fc-bg', cfg.bg);
				} else {
					htmlEl.style.removeProperty('--aiob-fc-bg');
				}
				if (cfg.text) {
					htmlEl.style.setProperty('--aiob-fc-text', cfg.text);
				} else {
					htmlEl.style.removeProperty('--aiob-fc-text');
				}
			});
		}
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
		saveBtn.addEventListener('click', () => {
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
			void this.plugin.saveData(this.plugin.data);
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

	private cleanupDOM(): void {
		document.querySelectorAll('.aiob-folder-colored').forEach(el => {
			el.classList.remove('aiob-folder-colored');
			(el as HTMLElement).style.removeProperty('--aiob-fc-bg');
			(el as HTMLElement).style.removeProperty('--aiob-fc-text');
		});
	}

	private debounce(func: () => void, wait: number): () => void {
		let timeout: number | undefined;
		return () => {
			clearTimeout(timeout);
			timeout = window.setTimeout(func, wait);
		};
	}
}
