import { App, TFile } from 'obsidian';
import type AiobPlugin from '../main';
import { formatLocalDate, formatLocalTime } from '../utils/date';

const WEEKDAY_MAP = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];

export class DailyNoteService {
	constructor(private plugin: AiobPlugin) {}

	private get app(): App { return this.plugin.app; }
	private get config() { return this.plugin.data.config; }

	private getObsidianDailyNoteOptions(): { format: string; folder: string; template: string } {
		const options = (this.app as any).internalPlugins?.getPluginById?.('daily-notes')?.instance?.options;
		return {
			format: options?.format || 'YYYY-MM-DD',
			folder: options?.folder || '',
			template: options?.template || '',
		};
	}

	// ── Public API ──────────────────────────────────────────────

	getTodayDailyNotePath(): string {
		return this.getDailyNotePathForDate(new Date());
	}

	getDailyNotePathForDate(date: Date): string {
		return this.getDailyNotePath(date);
	}

	isTodayDailyNotePath(path: string): boolean {
		return path === this.getTodayDailyNotePath();
	}

	getDailyNoteFolder(): string {
		return this.getObsidianDailyNoteOptions().folder.trim().replace(/\/+$/, '');
	}

	getTodayDailyNoteFile(): TFile | null {
		const abstract = this.app.vault.getAbstractFileByPath(this.getTodayDailyNotePath());
		return abstract instanceof TFile ? abstract : null;
	}

	getDailyNoteFileForDate(dateStr: string): TFile | null {
		const target = new Date(`${dateStr}T12:00:00`);
		const abstract = this.app.vault.getAbstractFileByPath(this.getDailyNotePathForDate(target));
		return abstract instanceof TFile ? abstract : null;
	}

	getOnThisDayDailyNotes(targetDate = new Date()): Array<{ date: string; file: TFile }> {
		const targetDateStr = formatLocalDate(targetDate);
		const targetMonthDay = targetDateStr.slice(5, 10);
		return this.app.vault.getMarkdownFiles()
			.filter(file => this.isDailyNoteFilePath(file.path))
			.map(file => {
				const date = this.getDailyNoteDateFromFile(file);
				return date ? { date, file } : null;
			})
			.filter((entry): entry is { date: string; file: TFile } =>
				!!entry
				&& entry.date.slice(5, 10) === targetMonthDay
				&& entry.date < targetDateStr,
			)
			.sort((a, b) => b.date.localeCompare(a.date));
	}

	/**
	 * Ensure today's daily note exists. Creates from user template if needed.
	 */
	async ensureTodayDailyNoteFile(): Promise<TFile | null> {
		const existing = this.getTodayDailyNoteFile();
		if (existing) return existing;
		return this.createDailyNoteFromUserTemplate(new Date());
	}

	/**
	 * Create a daily note from the user's Obsidian template.
	 * Does NOT inject any plugin-managed sections or frontmatter.
	 */
	async createDailyNoteFromUserTemplate(date: Date): Promise<TFile | null> {
		const dateStr = formatLocalDate(date);
		const weekday = WEEKDAY_MAP[date.getDay()];
		const filePath = this.getDailyNotePath(date);

		const existing = this.app.vault.getAbstractFileByPath(filePath);
		if (existing instanceof TFile) return existing;

		const dnFolder = this.getObsidianDailyNoteOptions().folder.trim().replace(/\/+$/, '');
		if (dnFolder) await this.ensureFolderExists(dnFolder);

		const templateContent = await this.readTemplateContent(dateStr, weekday);
		const content = templateContent ?? '';
		await this.app.vault.create(filePath, content);

		const created = this.app.vault.getAbstractFileByPath(filePath);
		return created instanceof TFile ? created : null;
	}

	// ── Private helpers ─────────────────────────────────────────

	private getDailyNotePath(date: Date): string {
		const opts = this.getObsidianDailyNoteOptions();
		const filename = window.moment(date).format(opts.format);
		const folder = opts.folder.trim().replace(/\/+$/, '');
		return folder ? `${folder}/${filename}.md` : `${filename}.md`;
	}

	private isDailyNoteFilePath(path: string): boolean {
		const folder = this.getObsidianDailyNoteOptions().folder.trim().replace(/\/+$/, '');
		return folder ? path.startsWith(`${folder}/`) : true;
	}

	private getDailyNoteDateFromFile(file: TFile): string | null {
		const raw = this.app.metadataCache.getFileCache(file)?.frontmatter?.date;
		const frontmatterDate = this.normalizeDailyNoteDate(raw);
		if (frontmatterDate) return frontmatterDate;
		const pathMatch = file.path.match(/(?:^|\/)(\d{4}-\d{2}-\d{2})(?=[^0-9]|$)/);
		return pathMatch?.[1] || null;
	}

	private normalizeDailyNoteDate(value: unknown): string | null {
		if (typeof value !== 'string') return null;
		const match = value.trim().match(/^(\d{4}-\d{2}-\d{2})(?:$|[T\s])/);
		return match?.[1] || null;
	}

	private async readTemplateContent(dateStr: string, weekday: string): Promise<string | null> {
		const pluginTemplate = this.config.dailyNote.templatePath?.trim() || '';
		const obsidianTemplate = this.getObsidianDailyNoteOptions().template;
		const rawPaths = [pluginTemplate, obsidianTemplate].filter(Boolean);

		const candidates: string[] = [];
		for (const p of rawPaths) {
			if (p.endsWith('.md')) {
				candidates.push(p);
			} else {
				candidates.push(`${p}.md`);
				candidates.push(p);
			}
		}

		for (const path of candidates) {
			const file = this.app.vault.getAbstractFileByPath(path);
			if (!(file instanceof TFile)) continue;
			const raw = await this.app.vault.cachedRead(file);
			return this.resolveTemplateVariables(raw, dateStr, weekday);
		}
		return null;
	}

	private resolveTemplateVariables(content: string, dateStr: string, weekday: string): string {
		const now = new Date();
		const replacements: Record<string, string> = {
			'{{date}}': dateStr,
			'{{time}}': formatLocalTime(now),
			'{{weekday}}': weekday,
			'<% tp.date.now("YYYY-MM-DD") %>': dateStr,
			'<% tp.date.now("HH:mm") %>': formatLocalTime(now),
		};
		let resolved = content;
		for (const [from, to] of Object.entries(replacements)) {
			resolved = resolved.split(from).join(to);
		}
		return resolved;
	}

	private async ensureFolderExists(folderPath: string): Promise<void> {
		if (this.app.vault.getAbstractFileByPath(folderPath)) return;
		await this.app.vault.createFolder(folderPath);
	}
}
