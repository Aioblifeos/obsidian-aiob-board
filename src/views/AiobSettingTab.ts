import { App, PluginSettingTab, Setting, AbstractInputSuggest, TFile, TFolder } from 'obsidian';
import type AiobPlugin from '../main';
import { getChannelPathSuggestions, type ChannelPathApp } from '../utils/channelPaths';

/** Obsidian internal API for accessing the built-in templates plugin */
interface ObsidianInternalPlugins {
	getPluginById?: (id: string) => {
		instance?: { options?: { folder?: string } };
	} | undefined;
}

// ── Suggest classes ─────────────────────────────────────────

class FileSuggest extends AbstractInputSuggest<TFile> {
	private _cb?: (file: TFile) => void;
	constructor(app: App, inputEl: HTMLInputElement, private extensions = ['md'], private folder?: string) {
		super(app, inputEl);
	}
	getSuggestions(query: string): TFile[] {
		const lq = query.toLowerCase();
		return this.app.vault.getFiles()
			.filter(f => this.extensions.includes(f.extension) && f.path.toLowerCase().includes(lq))
			.filter(f => !this.folder || f.path.startsWith(this.folder + '/') || f.path.startsWith(this.folder))
			.sort((a, b) => a.path.localeCompare(b.path))
			.slice(0, 50);
	}
	renderSuggestion(file: TFile, el: HTMLElement): void { el.setText(file.path.replace(/\.md$/, '')); }
	selectSuggestion(file: TFile): void {
		this.setValue(file.path.replace(/\.md$/, '')); this.close();
		this._cb?.(file);
	}
	onPick(cb: (file: TFile) => void): this { this._cb = cb; return this; }
}

class FolderSuggest extends AbstractInputSuggest<TFolder> {
	private _cb?: (folder: TFolder) => void;
	constructor(app: App, inputEl: HTMLInputElement) { super(app, inputEl); }
	getSuggestions(query: string): TFolder[] {
		const lq = query.toLowerCase();
		const folders: TFolder[] = [];
		const walk = (f: TFolder) => {
			if (f.path && f.path.toLowerCase().includes(lq)) folders.push(f);
			for (const c of f.children) { if (c instanceof TFolder) walk(c); }
		};
		walk(this.app.vault.getRoot());
		return folders.sort((a, b) => a.path.localeCompare(b.path)).slice(0, 50);
	}
	renderSuggestion(f: TFolder, el: HTMLElement): void { el.setText(f.path || '/'); }
	selectSuggestion(f: TFolder): void {
		this.setValue(f.path); this.close();
		this._cb?.(f);
	}
	onPick(cb: (folder: TFolder) => void): this { this._cb = cb; return this; }
}

/** Suggest channel paths: root (/), .base files, base#view */
class ChannelPathSuggest extends AbstractInputSuggest<{ value: string; label: string; description: string }> {
	constructor(app: App, inputEl: HTMLInputElement) { super(app, inputEl); }
	async getSuggestions(query: string) {
		return getChannelPathSuggestions(this.app as ChannelPathApp, query, 20);
	}
	renderSuggestion(item: { value: string; label: string; description: string }, el: HTMLElement): void {
		el.createDiv({ text: item.label, cls: 'aiob-suggest-main' });
		if (item.description) el.createDiv({ text: item.description, cls: 'aiob-suggest-sub' });
	}
	selectSuggestion(item: { value: string; label: string }): void {
		this.setValue(item.value); this.close();
		this._cb?.(item);
	}
	private _cb?: (item: { value: string; label: string }) => void;
	onPick(cb: (item: { value: string; label: string }) => void): this { this._cb = cb; return this; }
}

class HeadingSuggest extends AbstractInputSuggest<string> {
	private _cb?: (h: string) => void;
	constructor(app: App, inputEl: HTMLInputElement, private getTarget?: () => string) { super(app, inputEl); }
	getSuggestions(query: string): string[] {
		const lq = query.toLowerCase();
		const headings: string[] = [];
		const tp = this.getTarget?.();
		if (tp && tp !== 'daily-note') {
			const file = this.app.vault.getAbstractFileByPath(tp.endsWith('.md') ? tp : `${tp}.md`)
				|| this.app.vault.getAbstractFileByPath(tp);
			if (file instanceof TFile) {
				const cache = this.app.metadataCache.getFileCache(file);
				if (cache?.headings) for (const h of cache.headings) headings.push(`${'#'.repeat(h.level)} ${h.heading}`);
			}
		}
		for (const d of ['## Memos', '## Todo', '## Notes', '## Journal', '## Log'])
			if (!headings.includes(d)) headings.push(d);
		return headings.filter(h => h.toLowerCase().includes(lq));
	}
	renderSuggestion(h: string, el: HTMLElement): void { el.setText(h); }
	selectSuggestion(h: string): void {
		this.setValue(h); this.close();
		this._cb?.(h);
	}
	onPick(cb: (h: string) => void): this { this._cb = cb; return this; }
}

class TargetFileSuggest extends AbstractInputSuggest<string> {
	private _cb?: (v: string) => void;
	constructor(app: App, inputEl: HTMLInputElement) { super(app, inputEl); }
	getSuggestions(query: string): string[] {
		const lq = query.toLowerCase();
		const r: string[] = [];
		if ('daily-note'.includes(lq)) r.push('daily-note');
		for (const f of this.app.vault.getMarkdownFiles()) {
			const d = f.path.replace(/\.md$/, '');
			if (d.toLowerCase().includes(lq)) r.push(d);
		}
		return r.slice(0, 50);
	}
	renderSuggestion(v: string, el: HTMLElement): void { el.setText(v === 'daily-note' ? 'daily-note  (当天日记)' : v); }
	selectSuggestion(v: string): void {
		this.setValue(v); this.close();
		this._cb?.(v);
	}
	onPick(cb: (v: string) => void): this { this._cb = cb; return this; }
}

// ── Settings Tab ────────────────────────────────────────────

export class AiobSettingTab extends PluginSettingTab {
	constructor(app: App, private plugin: AiobPlugin) { super(app, plugin); }

	display(): void {
		const { containerEl } = this;
		containerEl.empty();
		containerEl.addClass('aiob-settings');

		// ════ 外观 ════
		this.section(containerEl, '外观');

		new Setting(containerEl)
			.setName('插件界面语言')
			.setDesc('今日 / 本周 / 本月 / 今年、todo、notes、常用数据库等标题')
			.addDropdown(dd => dd
				.addOption('zh', '中文').addOption('en', 'English')
				.setValue(this.plugin.data.config.appearance.sectionLanguage ?? 'zh')
				.onChange(val => { void (async () => {
					this.plugin.data.config.appearance.sectionLanguage = val as 'zh' | 'en';
					await this.plugin.saveData(this.plugin.data);
					this.plugin.requestAiobViewRefresh();
				})(); }));

		const bannerCfg = this.plugin.data.config;
		const hasBanner = !!bannerCfg.bannerImage;
		const bs = new Setting(containerEl).setName('顶部背景图');
		bs.addButton(btn => btn.setButtonText(hasBanner ? '更换' : '选择').onClick(() => {
			const input = document.createElement('input');
			input.type = 'file'; input.accept = 'image/*';
			input.addEventListener('change', () => { void (async () => {
				const file = input.files?.[0]; if (!file) return;
				const ab = await file.arrayBuffer();
				const ext = file.name.split('.').pop() || 'png';
				const dp = `_lifeos_banner_${Date.now()}.${ext}`;
				for (const f of this.app.vault.getFiles()) { if (f.name.startsWith('_lifeos_banner_')) await this.app.fileManager.trashFile(f); }
				await this.app.vault.createBinary(dp, ab);
				bannerCfg.bannerImage = dp; bannerCfg.bannerPosition = { x: 50, y: 50 };
				await this.plugin.saveData(this.plugin.data);
				this.plugin.requestAiobViewRefresh(); this.display();
			})(); });
			input.click();
		}));
		if (hasBanner) bs.addButton(btn => btn.setButtonText('移除').setWarning().onClick(() => { void (async () => {
			bannerCfg.bannerImage = ''; await this.plugin.saveData(this.plugin.data);
			this.plugin.requestAiobViewRefresh(); this.display();
		})(); }));

		// ════ 常用数据库 ════
		this.section(containerEl, '常用数据库');

		const channels = this.plugin.data.config.channels;
		for (const ch of channels) {
			const row = containerEl.createDiv({ cls: 'aiob-s-ch-row' });

			// Icon (editable)
			const iconInput = row.createEl('input', { cls: 'aiob-s-ch-icon-input', value: ch.icon });
			iconInput.maxLength = 4;
			iconInput.addEventListener('change', () => { void (async () => { ch.icon = iconInput.value.trim() || '📂'; await this.plugin.saveData(this.plugin.data); })(); });

			// Name (editable)
			const nameInput = row.createEl('input', { cls: 'aiob-s-ch-name-input', value: ch.name });
			nameInput.placeholder = '名称';
			nameInput.addEventListener('change', () => { void (async () => { ch.name = nameInput.value.trim() || '未命名'; await this.plugin.saveData(this.plugin.data); })(); });

			// Path (with suggest)
			const pathInput = row.createEl('input', { cls: 'aiob-s-ch-path-input', value: ch.path });
			pathInput.placeholder = '文件夹路径';
			pathInput.addEventListener('change', () => { void (async () => { ch.path = pathInput.value.trim(); await this.plugin.saveData(this.plugin.data); })(); });
			new ChannelPathSuggest(this.app, pathInput).onPick((item) => { void (async () => {
				ch.path = item.value; await this.plugin.saveData(this.plugin.data);
			})(); });

			// Delete
			const del = row.createEl('span', { cls: 'aiob-s-ch-del', text: '\u00d7' });
			del.addEventListener('click', () => { void (async () => {
				this.plugin.data.config.channels = channels.filter(c => c.id !== ch.id);
				await this.plugin.saveData(this.plugin.data);
				this.display();
			})(); });
		}

		// Add row — inline inputs
		const addRow = containerEl.createDiv({ cls: 'aiob-s-ch-row aiob-s-ch-add' });
		const addIcon = addRow.createEl('input', { cls: 'aiob-s-ch-icon-input', placeholder: '📂' });
		addIcon.maxLength = 4;
		const addName = addRow.createEl('input', { cls: 'aiob-s-ch-name-input', placeholder: '名称' });
		const addPath = addRow.createEl('input', { cls: 'aiob-s-ch-path-input', placeholder: '路径，点击添加' });
		new ChannelPathSuggest(this.app, addPath);

		const doAdd = async () => {
			const name = addName.value.trim();
			const path = addPath.value.trim();
			if (!name && !path) return;
			this.plugin.data.config.channels.push({
				id: `ch_${Date.now()}`,
				name: name || '新频道',
				icon: addIcon.value.trim() || '📂',
				path,
			});
			await this.plugin.saveData(this.plugin.data);
			this.display();
		};
		// Enter on any input triggers add
		for (const el of [addIcon, addName, addPath]) {
			el.addEventListener('keydown', (e: KeyboardEvent) => { if (e.key === 'Enter') { e.preventDefault(); void doAdd(); } });
		}

		// ════ Memo ════
		this.section(containerEl, 'Memo');
		const memoCfg = this.plugin.data.config.memoStorage;

		new Setting(containerEl)
			.setName('闪念存储位置')
			.addText(text => {
				text.setPlaceholder('daily-note (当天日记)').setValue(memoCfg.targetFile)
					.onChange(val => { void (async () => { memoCfg.targetFile = val.trim() || 'daily-note'; await this.plugin.saveData(this.plugin.data); })(); });
				new TargetFileSuggest(this.app, text.inputEl).onPick((v) => { void (async () => {
					memoCfg.targetFile = v || 'daily-note'; await this.plugin.saveData(this.plugin.data);
				})(); });
			});

		new Setting(containerEl)
			.setName('插入文档的哪个标题块下')
			.addText(text => {
				text.setPlaceholder('若无则自动新建').setValue(memoCfg.heading)
					.onChange(val => { void (async () => { memoCfg.heading = val.trim() || '## Memos'; await this.plugin.saveData(this.plugin.data); })(); });
				new HeadingSuggest(this.app, text.inputEl, () => memoCfg.targetFile).onPick((h) => { void (async () => {
					memoCfg.heading = h || '## Memos'; await this.plugin.saveData(this.plugin.data);
				})(); });
			});

		const tcs = new Setting(containerEl).setName('时间戳颜色').setClass('aiob-s-color-row');
		tcs.addDropdown(dd => {
			dd.addOption('accent', '主题色');
			dd.addOption('#808080', '灰色');
			dd.addOption('#E06C75', '红'); dd.addOption('#61AFEF', '蓝');
			dd.addOption('#98C379', '绿'); dd.addOption('#D19A66', '橙'); dd.addOption('#C678DD', '紫');
			const cur = memoCfg.timestampColor;
			const presets = ['accent', '#808080', '#E06C75', '#61AFEF', '#98C379', '#D19A66', '#C678DD'];
			if (!presets.includes(cur)) dd.addOption(cur, cur);
			dd.setValue(cur);
			dd.onChange(val => { void (async () => {
				memoCfg.timestampColor = val; await this.plugin.saveData(this.plugin.data);
				const p = tcs.settingEl.querySelector('.aiob-s-swatch') as HTMLInputElement;
				if (p && val.startsWith('#')) p.value = val;
			})(); });
		});
		const swatch = tcs.controlEl.createEl('input', { type: 'color', cls: 'aiob-s-swatch' });
		swatch.value = memoCfg.timestampColor.startsWith('#') ? memoCfg.timestampColor : '#808080';
		swatch.addEventListener('input', () => { void (async () => {
			memoCfg.timestampColor = swatch.value; await this.plugin.saveData(this.plugin.data);
			const dd = tcs.settingEl.querySelector('select') as HTMLSelectElement;
			if (dd) {
				const presets = ['accent', '#808080', '#E06C75', '#61AFEF', '#98C379', '#D19A66', '#C678DD'];
				if (!presets.includes(swatch.value)) {
					let opt = dd.querySelector(`option[value="${swatch.value}"]`) as HTMLOptionElement;
					if (!opt) { opt = document.createElement('option'); opt.value = swatch.value; opt.text = swatch.value; dd.appendChild(opt); }
				}
				dd.value = swatch.value;
			}
		})(); });

		// ════ Todo ════
		this.section(containerEl, 'Todo');
		const todoCfg = this.plugin.data.config.todoStorage;

		new Setting(containerEl)
			.setName('待办存储位置')
			.addText(text => {
				text.setPlaceholder('daily-note (当天日记)').setValue(todoCfg.targetFile)
					.onChange(val => { void (async () => { todoCfg.targetFile = val.trim() || 'daily-note'; await this.plugin.saveData(this.plugin.data); })(); });
				new TargetFileSuggest(this.app, text.inputEl).onPick((v) => { void (async () => {
					todoCfg.targetFile = v || 'daily-note'; await this.plugin.saveData(this.plugin.data);
				})(); });
			});

		new Setting(containerEl)
			.setName('插入文档的哪个标题块下')
			.addText(text => {
				text.setPlaceholder('若无则自动新建').setValue(todoCfg.heading)
					.onChange(val => { void (async () => { todoCfg.heading = val.trim() || '## Todo'; await this.plugin.saveData(this.plugin.data); })(); });
				new HeadingSuggest(this.app, text.inputEl, () => todoCfg.targetFile).onPick((h) => { void (async () => {
					todoCfg.heading = h || '## Todo'; await this.plugin.saveData(this.plugin.data);
				})(); });
			});

		new Setting(containerEl)
			.setName('同步库内任务')
			.setDesc('扫描其他文档中的 - [ ] 任务')
			.addToggle(toggle => toggle.setValue(todoCfg.syncFromVault).onChange(val => { void (async () => {
				todoCfg.syncFromVault = val; await this.plugin.saveData(this.plugin.data);
				this.plugin.requestAiobViewRefresh(); this.display();
			})(); }));

		if (todoCfg.syncFromVault) {
			new Setting(containerEl)
				.setName('同步范围')
				.setDesc('留空 = 整个库')
				.addText(text => {
					text.setPlaceholder('/').setValue(todoCfg.syncFolder)
						.onChange(val => { void (async () => { todoCfg.syncFolder = val.trim(); await this.plugin.saveData(this.plugin.data); })(); });
					new FolderSuggest(this.app, text.inputEl).onPick((folder) => { void (async () => {
						todoCfg.syncFolder = folder.path; await this.plugin.saveData(this.plugin.data);
					})(); });
				});
		}

		// ════ 增强功能 ════
		this.section(containerEl, '增强功能');

		new Setting(containerEl)
			.setName('多选属性彩色标签')
			.setDesc('自动为笔记属性为列表的属性添加背景色')
			.addToggle(toggle => toggle.setValue(this.plugin.data.config.enableFrontmatterColorizer).onChange(val => { void (async () => {
				this.plugin.data.config.enableFrontmatterColorizer = val; await this.plugin.saveData(this.plugin.data);
				if (val) this.plugin.frontmatterColorizer.start(); else this.plugin.frontmatterColorizer.destroy();
			})(); }));

		new Setting(containerEl)
			.setName('文件夹数据统计')
			.setDesc('在文件浏览器的文件夹名称旁显示文件数与字数')
			.addToggle(toggle => toggle.setValue(this.plugin.data.config.enableFolderStats).onChange(val => { void (async () => {
				this.plugin.data.config.enableFolderStats = val; await this.plugin.saveData(this.plugin.data);
				if (val) this.plugin.folderStatsService.start(); else this.plugin.folderStatsService.destroy();
			})(); }));

		new Setting(containerEl)
			.setName('文件夹颜色标记')
			.setDesc('右键文件夹可设置背景色和标题文字颜色')
			.addToggle(toggle => toggle.setValue(this.plugin.data.config.enableFolderColorizer).onChange(val => { void (async () => {
				this.plugin.data.config.enableFolderColorizer = val; await this.plugin.saveData(this.plugin.data);
				if (val) this.plugin.folderColorizerService.start(); else this.plugin.folderColorizerService.destroy();
			})(); }));

		new Setting(containerEl)
			.setName('多状态复选框')
			.setDesc('支持 - [/] 进行中、- [-] 已取消、- [?] 疑问、- [!] 重要 等多种任务状态，纯 CSS 实现')
			.setDisabled(true)
			.addToggle(toggle => toggle.setValue(true).setDisabled(true));

		new Setting(containerEl)
			.setName('新建文档默认属性')
			.setDesc('新建 .md 时自动填入模板 frontmatter')
			.addToggle(toggle => toggle.setValue(this.plugin.data.config.enableNewNoteTemplate).onChange(val => { void (async () => {
				this.plugin.data.config.enableNewNoteTemplate = val; await this.plugin.saveData(this.plugin.data); this.display();
			})(); }));

		if (this.plugin.data.config.enableNewNoteTemplate) {
			// Get Obsidian's configured templates folder
			const tplFolder = (this.app.vault as { config?: { templates?: { folder?: string } } }).config?.templates?.folder
				|| (this.app as unknown as { internalPlugins?: ObsidianInternalPlugins }).internalPlugins?.getPluginById?.('templates')?.instance?.options?.folder
				|| '';
			new Setting(containerEl)
				.setName('默认属性模板')
				.setDesc('支持 {{date}} {{time}} {{title}}' + (tplFolder ? `（从 ${tplFolder}/ 选择）` : ''))
				.addText(text => {
					text.setPlaceholder('template/默认模板').setValue(this.plugin.data.config.newNoteTemplatePath)
						.onChange(val => { void (async () => { this.plugin.data.config.newNoteTemplatePath = val.trim(); await this.plugin.saveData(this.plugin.data); })(); });
					new FileSuggest(this.app, text.inputEl, ['md'], tplFolder || undefined).onPick((file) => { void (async () => {
						this.plugin.data.config.newNoteTemplatePath = file.path.replace(/\.md$/, '');
						await this.plugin.saveData(this.plugin.data);
					})(); });
				});

			// Exclude folders
			const excludes = this.plugin.data.config.newNoteExcludeFolders || [];
			const exSetting = new Setting(containerEl)
				.setName('排除文件夹')
				.setDesc('这些文件夹下新建文档不自动添加属性');
			exSetting.setClass('aiob-s-exclude');

			const exContainer = containerEl.createDiv({ cls: 'aiob-s-exclude-list' });
			for (let i = 0; i < excludes.length; i++) {
				const tag = exContainer.createDiv({ cls: 'aiob-s-exclude-tag' });
				tag.createSpan({ text: excludes[i] });
				const rm = tag.createSpan({ cls: 'aiob-s-exclude-rm', text: '\u00d7' });
				rm.addEventListener('click', () => { void (async () => {
					excludes.splice(i, 1);
					this.plugin.data.config.newNoteExcludeFolders = excludes;
					await this.plugin.saveData(this.plugin.data);
					this.display();
				})(); });
			}
			// Add input — always visible so user can keep adding
			const addExInput = exContainer.createEl('input', { cls: 'aiob-s-exclude-input', placeholder: '+ 添加文件夹' });
			const folderSuggest = new FolderSuggest(this.app, addExInput);
			const addExFolder = async () => {
				const val = addExInput.value.trim();
				if (val && !excludes.includes(val)) {
					excludes.push(val);
					this.plugin.data.config.newNoteExcludeFolders = [...excludes];
					await this.plugin.saveData(this.plugin.data);
					this.display();
				}
			};
			folderSuggest.onPick(() => { void addExFolder(); });
			addExInput.addEventListener('keydown', (e: KeyboardEvent) => {
				if (e.key === 'Enter') { e.preventDefault(); void addExFolder(); }
			});
		}

		// ════ 日记 ════
		this.section(containerEl, '日记');
		this.hint(containerEl, '使用 Obsidian 核心插件「日记」的设置。目标为 daily-note 时，日记不存在会按日记模板自动创建。');
	}

	// ── Helpers ──

	private section(parent: HTMLElement, text: string): void {
		parent.createEl('div', { cls: 'aiob-s-divider' });
		parent.createEl('div', { cls: 'aiob-s-section', text });
	}

	private hint(parent: HTMLElement, text: string): void {
		parent.createEl('p', { text, cls: 'aiob-s-hint' });
	}
}
