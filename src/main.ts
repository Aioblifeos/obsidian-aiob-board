import { Plugin, WorkspaceLeaf, TAbstractFile, TFile, Editor, addIcon } from 'obsidian';
import type { AiobData } from './models/types';
import { DEFAULT_CONFIG } from './models/defaults';
import { DailyNoteService } from './services/DailyNoteService';
import { MarkdownMemoService } from './services/MarkdownMemoService';
import { MarkdownTodoService } from './services/MarkdownTodoService';
import { FrontmatterColorizerService } from './services/FrontmatterColorizerService';
import { FolderStatsService } from './services/FolderStatsService';
import { FolderColorizerService } from './services/FolderColorizerService';
import { label, type LabelKey } from './models/labels';
import { AiobView, VIEW_TYPE_AIOB } from './views/AiobView';
import { AiobSettingTab } from './views/AiobSettingTab';
import { runMigrations, CURRENT_SCHEMA_VERSION } from './migrations';
import { formatLocalDate } from './utils/date';
import { setUserAreaColors, setUserAreasColorIndex } from './utils/semanticColors';
import { setUserAreas } from './models/semantic';
import { debugLog } from './utils/logger';

export default class AiobPlugin extends Plugin {
	data: AiobData = { schemaVersion: CURRENT_SCHEMA_VERSION, config: { ...DEFAULT_CONFIG } };
	dailyNoteService: DailyNoteService;
	markdownMemoService: MarkdownMemoService;
	markdownTodoService: MarkdownTodoService;
	frontmatterColorizer: FrontmatterColorizerService;
	folderStatsService: FolderStatsService;
	folderColorizerService: FolderColorizerService;
	/** Get a localized section label. */
	label(key: LabelKey): string { return label(this.data.config.appearance.sectionLanguage ?? 'zh', key); }

	private vaultPropertyTypes: Record<string, string> = {};
	private vaultPropertyRevision = 0;
	private dataRevision = 0;
	private saveQueue: Promise<void> = Promise.resolve();
	// dailyNoteSyncTask/Pending removed — no longer auto-syncing daily notes
	private vaultRefreshTimer: number | null = null;
	/** Fingerprint cache: path -> "length:hash" */
	private noteBodyFingerprints = new Map<string, string>();

	async onload() {
		debugLog('Loading plugin...');

		// Register custom icon
		addIcon('aiob', '<path d="M50 70 C50 42 86 27 93 56 C99 85 64 97 50 70 C36 42 1 27 7 56 C14 85 50 97 50 70 Z" stroke="currentColor" stroke-width="8" fill="none" stroke-linecap="round" stroke-linejoin="round"/><line x1="46" y1="3" x2="46" y2="37" stroke="currentColor" stroke-width="8" stroke-linecap="round"/><line x1="30" y1="20" x2="63" y2="20" stroke="currentColor" stroke-width="8" stroke-linecap="round"/>');

		// Load saved data and run versioned migrations
		const saved = await this.loadData();
		const previousVersion = saved?.schemaVersion ?? 0;
		const migrated = runMigrations(saved);
		// Deep-merge nested config objects so new fields always get defaults
		const migratedConfig = migrated.config ?? {};
		const mergedConfig: AiobData['config'] = { ...DEFAULT_CONFIG, ...migratedConfig };
		// Patch nested objects that shallow spread would miss
		mergedConfig.memoStorage = { ...DEFAULT_CONFIG.memoStorage, ...(migratedConfig.memoStorage ?? {}) };
		mergedConfig.todoStorage = { ...DEFAULT_CONFIG.todoStorage, ...(migratedConfig.todoStorage ?? {}) };
		mergedConfig.dailyNote = { ...DEFAULT_CONFIG.dailyNote, ...(migratedConfig.dailyNote ?? {}) };
		mergedConfig.appearance = { ...DEFAULT_CONFIG.appearance, ...(migratedConfig.appearance ?? {}) };
		mergedConfig.today = { ...DEFAULT_CONFIG.today, ...(migratedConfig.today ?? {}) };

		this.data = {
			schemaVersion: migrated.schemaVersion,
			config: mergedConfig,
		};

		// Push user area color overrides into the color system
		setUserAreaColors(this.data.config.areaColors);
		setUserAreas(this.data.config.areas);
		setUserAreasColorIndex(this.data.config.areas);

		// Runtime operations that require vault access
		await this.loadVaultPropertyTypes();
		await this.ensureManagedPropertyTypes();
		let shouldSave = migrated.schemaVersion !== previousVersion;
		if (this.pruneBodyTouchedNotePathsByDate()) shouldSave = true;
		if (shouldSave) {
			await this.saveData(this.data);
		}

		// Init services
		this.dailyNoteService = new DailyNoteService(this);
		this.markdownMemoService = new MarkdownMemoService(this);
		this.markdownTodoService = new MarkdownTodoService(this);
		this.frontmatterColorizer = new FrontmatterColorizerService(this);
		this.folderStatsService = new FolderStatsService(this);
		this.folderColorizerService = new FolderColorizerService(this);

		this.registerEvent(this.app.vault.on('create', (file) => this.handleVaultMutation('create', file)));
		this.registerEvent(this.app.vault.on('modify', (file) => this.handleVaultMutation('modify', file)));
		this.registerEvent(this.app.vault.on('delete', (file) => this.handleVaultMutation('delete', file)));
		this.registerEvent(this.app.vault.on('rename', (file, oldPath) => this.handleVaultMutation('rename', file, oldPath)));

		// Track typed words via editor changes + file open
		this.registerEvent(this.app.workspace.on('editor-change', (editor) => {
			this.handleEditorChange(editor);
		}));
		this.registerEvent(this.app.workspace.on('active-leaf-change', () => {
			this.handleFileOpen();
		}));

		// Register view
		this.registerView(VIEW_TYPE_AIOB, (leaf) => new AiobView(leaf, this));

		// Ribbon icon
		this.addRibbonIcon('aiob', 'Aiob board', () => {
			void this.activateView('sidebar');
		});

		// Commands
		this.addCommand({
			id: 'open-sidebar',
			name: 'Open sidebar',
			callback: () => { void this.activateView('sidebar'); },
		});

		this.addCommand({
			id: 'open-main',
			name: 'Open main view',
			callback: () => { void this.activateView('main'); },
		});

		this.addCommand({
			id: 'quick-memo',
			name: 'Quick memo',
			callback: () => { void this.activateView('sidebar'); },
		});

		// Settings tab
		this.addSettingTab(new AiobSettingTab(this.app, this));

		// Auto-open on startup
		this.app.workspace.onLayoutReady(() => {
			// Start frontmatter colorizer if enabled
			if (this.data.config.enableFrontmatterColorizer) {
				this.frontmatterColorizer.start();
			}
			// Start folder stats if enabled
			if (this.data.config.enableFolderStats) {
				this.folderStatsService.start();
			}
			// Start folder colorizer if enabled
			if (this.data.config.enableFolderColorizer) {
				this.folderColorizerService.start();
			}
			void (async () => {
				await this.initDailyNoteWordCount();
				await this.ensureAiobLeaf('sidebar');
				await this.activateView('main');
				// Patch word count after views are ready
				this.patchWordCountDOM();
			})();
		});

		debugLog('Plugin loaded successfully');
	}

	onunload(): void {
		this.frontmatterColorizer?.destroy();
		this.folderStatsService?.destroy();
		this.folderColorizerService?.destroy();
		if (this.vaultRefreshTimer) window.clearTimeout(this.vaultRefreshTimer);
		debugLog('Unloading plugin');
	}

	async saveData(data: AiobData): Promise<void> {
		this.dataRevision += 1;
		setUserAreaColors(data.config.areaColors);
		setUserAreas(data.config.areas);
		setUserAreasColorIndex(data.config.areas);
		this.saveQueue = this.saveQueue.then(() => super.saveData(data));
		await this.saveQueue;
	}

	requestAiobViewRefresh(): void {
		this.scheduleAiobViewRefresh();
	}

	async activateView(position: 'sidebar' | 'main' = 'sidebar') {
		const leaf = await this.ensureAiobLeaf(position);
		if (leaf) {
			await this.app.workspace.revealLeaf(leaf);
		}
	}

	private async ensureAiobLeaf(position: 'sidebar' | 'main'): Promise<WorkspaceLeaf | null> {
		const { workspace } = this.app;
		const leaves = workspace.getLeavesOfType(VIEW_TYPE_AIOB);

		if (position === 'main') {
			let leaf = leaves.find(l => l.getRoot() === workspace.rootSplit) || null;
			if (!leaf) {
				leaf = workspace.getLeaf('tab');
				if (leaf) {
					await leaf.setViewState({ type: VIEW_TYPE_AIOB, active: true });
				}
			}
			return leaf;
		}

		let leaf = leaves.find(l => l.getRoot() !== workspace.rootSplit) || null;
		if (!leaf) {
			leaf = workspace.getRightLeaf(false);
			if (leaf) {
				await leaf.setViewState({ type: VIEW_TYPE_AIOB, active: true });
			}
		}
		return leaf;
	}

	getVaultPropertyType(key: string): string | null {
		return this.vaultPropertyTypes[key] || null;
	}

	getVaultPropertyRevision(): number {
		return this.vaultPropertyRevision;
	}

	getDataRevision(): number {
		return this.dataRevision;
	}

	private async loadVaultPropertyTypes(): Promise<void> {
		const path = `${this.app.vault.configDir}/types.json`;
		try {
			if (!(await this.app.vault.adapter.exists(path))) {
				this.vaultPropertyTypes = {};
				return;
			}
			const raw = await this.app.vault.adapter.read(path);
			const parsed = JSON.parse(raw);
			this.vaultPropertyTypes = parsed?.types && typeof parsed.types === 'object' ? parsed.types : {};
		} catch (error) {
			console.error('Aiob: Failed to load vault property types', error);
			this.vaultPropertyTypes = {};
		}
	}

	private async ensureManagedPropertyTypes(): Promise<void> {
		const managed: Record<string, string> = {
			date: 'date',
			day: 'text',
			week: 'multitext',
			month: 'multitext',
		};
		let changed = false;
		for (const [key, type] of Object.entries(managed)) {
			if (!this.vaultPropertyTypes[key]) {
				this.vaultPropertyTypes[key] = type;
				changed = true;
			}
		}
		if (!changed) return;
		const path = `${this.app.vault.configDir}/types.json`;
		try {
			let existing: Record<string, unknown> = {};
			if (await this.app.vault.adapter.exists(path)) {
				const raw = await this.app.vault.adapter.read(path);
				existing = JSON.parse(raw) as Record<string, unknown>;
			}
			const existingTypes = existing.types;
			const types: Record<string, string> = existingTypes && typeof existingTypes === 'object' ? { ...(existingTypes as Record<string, string>) } : {};
			for (const [key, type] of Object.entries(managed)) {
				if (!types[key]) types[key] = type;
			}
			await this.app.vault.adapter.write(path, JSON.stringify({ ...existing, types }, null, 2));
		} catch (error) {
			console.error('Aiob: Failed to write vault property types', error);
		}
	}

	private handleVaultMutation(kind: 'create' | 'modify' | 'delete' | 'rename', file?: TAbstractFile, oldPath?: string): void {
		if (!(file instanceof TFile) || file.extension !== 'md') return;
		this.vaultPropertyRevision += 1;
		void this.trackNoteBodyMutation(kind, file, oldPath);
		// Update word count on modify (lightweight, no full refresh)
		if (kind === 'modify') {
			void this.updateWordCountForFile(file);
			// modify only needs word count patch, not full view refresh
			return;
		}
		if (this.dailyNoteService?.isTodayDailyNotePath(file.path)) return;
		if (kind === 'rename' && oldPath) {
			this.handleTemplatePathRename(file, oldPath);
		}
		if (kind === 'create') {
			this.trackNewFile(file.path);
			void this.applyNewNoteTemplate(file);
		}
		this.scheduleAiobViewRefresh();
	}

	private handleTemplatePathRename(file: TFile, oldPath: string): void {
		let dirty = false;
		const oldPathNoMd = oldPath.endsWith('.md') ? oldPath.slice(0, -3) : oldPath;
		const newPathNoMd = file.path.endsWith('.md') ? file.path.slice(0, -3) : file.path;

		const dnTpl = this.data.config.dailyNote.templatePath ?? '';
		if (dnTpl === oldPath || dnTpl === oldPathNoMd) {
			// Preserve the user's convention (with or without .md)
			this.data.config.dailyNote.templatePath = dnTpl.endsWith('.md') ? file.path : newPathNoMd;
			dirty = true;
		}
		const nntpl = this.data.config.newNoteTemplatePath;
		if (nntpl === oldPath || nntpl === oldPathNoMd) {
			this.data.config.newNoteTemplatePath = nntpl.endsWith('.md') ? file.path : newPathNoMd;
			dirty = true;
		}
		if (dirty) void this.saveData(this.data);
	}

	/**
	 * Apply the configured template to a newly created empty .md file.
	 * Skips if the feature is disabled, no template configured, or file already has content.
	 */
	private async applyNewNoteTemplate(file: TFile): Promise<void> {
		if (!this.data.config.enableNewNoteTemplate) return;
		const templatePath = this.data.config.newNoteTemplatePath;
		if (!templatePath) return;

		// Check exclude folders
		const excludes = this.data.config.newNoteExcludeFolders || [];
		for (const folder of excludes) {
			if (folder && file.path.startsWith(folder.replace(/\/+$/, '') + '/')) return;
		}

		// Wait for Obsidian to finish creating and initializing the file
		await new Promise(r => setTimeout(r, 50));

		try {
			const content = await this.app.vault.read(file);
			// Only apply template to empty (or near-empty) files
			if (content.trim().length > 0) return;

			// Try both raw path and with .md appended (Obsidian convention: paths omit .md)
			const candidates = templatePath.endsWith('.md')
				? [templatePath]
				: [`${templatePath}.md`, templatePath];

			let tplFile: TFile | null = null;
			for (const candidate of candidates) {
				// Skip template file itself
				if (file.path === candidate) return;
				const f = this.app.vault.getAbstractFileByPath(candidate);
				if (f instanceof TFile) { tplFile = f; break; }
			}
			if (!tplFile) return;

			const tplContent = await this.app.vault.cachedRead(tplFile);
			if (!tplContent.trim()) return;

			// Resolve basic variables
			const now = new Date();
			const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
			const timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
			const resolved = tplContent
				.replace(/\{\{date\}\}/g, dateStr)
				.replace(/\{\{time\}\}/g, timeStr)
				.replace(/\{\{title\}\}/g, file.basename);

			await this.app.vault.modify(file, resolved);
		} catch (err) {
			console.error('Aiob: Failed to apply new note template', err);
		}
	}

	private async trackNoteBodyMutation(kind: 'create' | 'modify' | 'delete' | 'rename', file: TFile, oldPath?: string): Promise<void> {
		if (this.dailyNoteService?.isTodayDailyNotePath(file.path)) return;
		if (kind === 'rename' && oldPath && oldPath !== file.path) {
			this.noteBodyFingerprints.delete(oldPath);
		}
		if (kind === 'delete') {
			this.noteBodyFingerprints.delete(file.path);
			return;
		}
		let raw = '';
		try {
			raw = await this.app.vault.cachedRead(file);
		} catch (error) {
			console.error('Aiob: Failed to read note for mutation tracking', file.path, error);
			return;
		}
		const nextFp = this.computeBodyFingerprint(raw);
		const prevFp = this.noteBodyFingerprints.get(file.path);
		this.noteBodyFingerprints.set(file.path, nextFp);
		if (kind === 'create' || prevFp == null) return;
		if (prevFp === nextFp) return;
		await this.markTodayBodyTouchedNote(file.path);
	}

	private async markTodayBodyTouchedNote(path: string): Promise<void> {
		const today = formatLocalDate();
		const byDate = this.data.config.today.bodyTouchedNotePathsByDate || {};
		const current = Array.isArray(byDate[today]) ? byDate[today] : [];
		const alreadyIncluded = current.includes(path);
		const nextByDate = {
			...byDate,
			[today]: alreadyIncluded ? current : [...current, path],
		};
		this.data.config.today.bodyTouchedNotePathsByDate = nextByDate;
		const pruned = this.pruneBodyTouchedNotePathsByDate();
		if (alreadyIncluded && !pruned) return;
		await this.saveData(this.data);
		this.scheduleAiobViewRefresh();
	}

	// ── Word count ─────────────────────────────────────────────────
	//
	// Today's words = new-file words + edit deltas.
	//
	// New file: created today → baseline 0, all words count.
	// Existing file: baseline = word count when first opened today.
	// Edit delta = current words − baseline (per file, min 0).
	//
	// Baselines persisted in wordBaselinesByDate so mid-day restarts
	// don't lose progress. On restart, current counts are re-read.

	/** Per-file baseline: word count when file was first opened today (0 for new files). */
	private _wordBaselines = new Map<string, number>();
	/** Per-file current word count (updated on editor-change). */
	private _wordCurrent = new Map<string, number>();
	/** Paths of files created today (baseline = 0). */
	private _todayNewFiles = new Set<string>();

	private countWords(text: string): number {
		const body = text.replace(/^---[\s\S]*?---\n?/, '').replace(/<[^>]+>/g, '');
		const chinese = (body.match(/[\u4e00-\u9fff]/g) || []).length;
		const english = (body.match(/[a-zA-Z]+/g) || []).length;
		return chinese + english;
	}

	/** When a file is opened, record its word count as baseline (once per day). */
	private handleFileOpen(): void {
		const file = this.app.workspace.getActiveFile();
		if (!file || file.extension !== 'md') return;
		if (this._wordBaselines.has(file.path)) return; // already baselined today
		void this.recordBaseline(file);
	}

	private async recordBaseline(file: TFile): Promise<void> {
		const content = await this.app.vault.cachedRead(file);
		const words = this.countWords(content);
		this._wordBaselines.set(file.path, words);
		this._wordCurrent.set(file.path, words);
		this.persistBaselines();
	}

	/** On editor change, update current word count for this file. */
	private handleEditorChange(editor: Editor): void {
		const file = this.app.workspace.getActiveFile();
		if (!file || file.extension !== 'md') return;
		const words = this.countWords(editor.getValue());
		// If no baseline yet (file opened before plugin loaded), set it now
		if (!this._wordBaselines.has(file.path)) {
			const oldWords = this._wordCurrent.get(file.path) ?? words;
			this._wordBaselines.set(file.path, oldWords);
			this.persistBaselines();
		}
		const prev = this._wordCurrent.get(file.path) ?? words;
		this._wordCurrent.set(file.path, words);
		// Refresh stats if word count actually changed (debounced separately to avoid excessive refreshes)
		if (words !== prev) {
			this.scheduleWordCountRefresh();
		}
	}

	/** Mark a newly created file so its baseline is 0. */
	trackNewFile(path: string): void {
		this._todayNewFiles.add(path);
		this._wordBaselines.set(path, 0);
		this._wordCurrent.set(path, 0);
		this.persistBaselines();
	}

	/** Update word count for a file modified programmatically (e.g. memo written to daily note). */
	private async updateWordCountForFile(file: TFile): Promise<void> {
		const content = await this.app.vault.cachedRead(file);
		const words = this.countWords(content);
		if (!this._wordBaselines.has(file.path)) {
			// First time seeing this file today — set baseline to previous word count or current
			const oldWords = this._wordCurrent.get(file.path) ?? words;
			this._wordBaselines.set(file.path, oldWords);
			this.persistBaselines();
		}
		this._wordCurrent.set(file.path, words);
	}

	/** Today's new words = sum of per-file deltas. Falls back to last persisted total before init completes. */
	getTodayTypedWords(): number {
		if (!this._wordBaselines.size) {
			// Before init completes, return last persisted total
			return this.data.config.today.lastWordCount ?? 0;
		}
		let total = 0;
		for (const [path, baseline] of this._wordBaselines) {
			const current = this._wordCurrent.get(path) ?? baseline;
			total += Math.max(0, current - baseline);
		}
		return total;
	}

	/**
	 * Called once on plugin load.
	 * Restores persisted baselines; re-reads current word counts so deltas
	 * are accurate after a restart.
	 */
	async initDailyNoteWordCount(): Promise<void> {
		const today = formatLocalDate();
		const stored = this.data.config.today.wordBaselinesByDate || {};
		const todayData = stored[today];

		// Clean up legacy data (old format was {baseline,current} objects)
		if (todayData) {
			const hasLegacy = Object.values(todayData).some(v => typeof v !== 'number');
			if (hasLegacy) {
				delete stored[today];
				this.data.config.today.wordBaselinesByDate = stored;
				void this.saveData(this.data);
			} else {
				for (const [path, baseline] of Object.entries(todayData)) {
					this._wordBaselines.set(path, baseline);
					if (baseline === 0) this._todayNewFiles.add(path);
					const file = this.app.vault.getAbstractFileByPath(path);
					if (file instanceof TFile) {
						const content = await this.app.vault.cachedRead(file);
						this._wordCurrent.set(path, this.countWords(content));
					} else {
						this._wordCurrent.set(path, baseline);
					}
				}
			}
		}

		// Also baseline the currently open file
		const activeFile = this.app.workspace.getActiveFile();
		if (activeFile && activeFile.extension === 'md' && !this._wordBaselines.has(activeFile.path)) {
			await this.recordBaseline(activeFile);
		}
	}

	private _wordRefreshTimer: ReturnType<typeof setTimeout> | null = null;
	/** Lightweight refresh: only update word count card text in existing DOM. */
	private scheduleWordCountRefresh(): void {
		if (this._wordRefreshTimer) clearTimeout(this._wordRefreshTimer);
		this._wordRefreshTimer = setTimeout(() => {
			this._wordRefreshTimer = null;
			this.patchWordCountDOM();
		}, 500);
	}

	/** Immediately patch word count cards in all views. */
	private patchWordCountDOM(): void {
		const total = this.getTodayTypedWords();
		const text = `${total}`;
		this.data.config.today.lastWordCount = total;
		for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_AIOB)) {
			const cards = leaf.view.containerEl.querySelectorAll('.aiob-sb-overview-card[data-stat="words"] .aiob-sb-overview-value');
			cards.forEach(el => { el.textContent = text; });
		}
	}

	private _persistTimer: ReturnType<typeof setTimeout> | null = null;
	private persistBaselines(): void {
		if (this._persistTimer) clearTimeout(this._persistTimer);
		this._persistTimer = setTimeout(() => {
			this._persistTimer = null;
			const today = formatLocalDate();
			const stored = this.data.config.today.wordBaselinesByDate || {};
			// Prune old days
			for (const d of Object.keys(stored)) { if (d < today) delete stored[d]; }
			// Save today's baselines
			const obj: Record<string, number> = {};
			for (const [path, baseline] of this._wordBaselines) obj[path] = baseline;
			stored[today] = obj;
			this.data.config.today.wordBaselinesByDate = stored;
			this.data.config.today.lastWordCount = this.getTodayTypedWords();
			void this.saveData(this.data);
		}, 3000);
	}

	private pruneBodyTouchedNotePathsByDate(retainDays = 30): boolean {
		const todayConfig = this.data.config.today;
		const byDate = todayConfig.bodyTouchedNotePathsByDate || {};
		const entries = Object.entries(byDate)
			.filter(([dateStr, paths]) => /^\d{4}-\d{2}-\d{2}$/.test(dateStr) && Array.isArray(paths) && paths.length > 0)
			.sort((a, b) => b[0].localeCompare(a[0]));
		const next: Record<string, string[]> = {};
		for (const [dateStr, paths] of entries.slice(0, retainDays)) {
			const normalized = [...new Set(paths.filter((path) => typeof path === 'string' && path.trim()))];
			if (!normalized.length) continue;
			next[dateStr] = normalized;
		}
		if (JSON.stringify(byDate) === JSON.stringify(next)) return false;
		todayConfig.bodyTouchedNotePathsByDate = next;
		return true;
	}

	private computeBodyFingerprint(raw: string): string {
		const body = raw.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '');
		const len = body.length;
		let hash = 5381;
		for (let i = 0; i < body.length; i++) {
			hash = ((hash << 5) + hash + body.charCodeAt(i)) | 0;
		}
		return `${len}:${(hash >>> 0).toString(36)}`;
	}

	private scheduleAiobViewRefresh(): void {
		if (this.vaultRefreshTimer) window.clearTimeout(this.vaultRefreshTimer);
		this.vaultRefreshTimer = window.setTimeout(() => {
			this.vaultRefreshTimer = null;
			for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_AIOB)) {
				const view = leaf.view as unknown as AiobView;
				view?.refresh?.();
			}
		}, 50);
	}

}
