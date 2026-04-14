import { TFile, Notice } from 'obsidian';
import type AiobPlugin from '../main';
import { formatLocalDate, formatLocalTime } from '../utils/date';

export interface ParsedMemo {
	time: string;
	content: string;
	lineNumber: number;
}

/**
 * Reads and writes memos as markdown lines under a configurable heading.
 *
 * Written format (matches DailyNoteService timeline style):
 *   <font color="808080">HH:MM</font> 💬 content
 *
 * The timestamp color is configurable via memoStorage.timestampColor.
 */
export class MarkdownMemoService {
	constructor(private plugin: AiobPlugin) {}

	/** Append a new memo to the target file under the configured heading. */
	async addMemo(content: string): Promise<void> {
		const time = formatLocalTime();
		const colorCfg = this.plugin.data.config.memoStorage.timestampColor;
		// 'accent' → use Obsidian's interactive-accent CSS variable via a span
		const line = colorCfg === 'accent'
			? `<span style="color:var(--interactive-accent)">${time}</span> 💬 ${content}`
			: `<font color="${colorCfg.replace('#', '')}">${time}</font> 💬 ${content}`;
		try {
			await this.appendUnderHeading(line);
			this.plugin.requestAiobViewRefresh();
		} catch (err) {
			console.error('Aiob: Failed to save memo', err);
			new Notice('Aiob: Memo 保存失败');
		}
	}

	/** Get memos for a given date (reads from that date's target file). */
	async getMemosForDate(dateStr: string): Promise<ParsedMemo[]> {
		const file = await this.resolveTargetFileForDate(dateStr);
		if (!file) return [];
		const raw = await this.plugin.app.vault.cachedRead(file);
		return this.parseMemosFromContent(raw);
	}

	/** Get memo count for today (convenience for stats). */
	async getTodayMemoCount(): Promise<number> {
		const memos = await this.getMemosForDate(formatLocalDate());
		return memos.length;
	}

	/** Edit a memo's content in-place. */
	async editMemo(memo: ParsedMemo, newContent: string): Promise<void> {
		try {
			const file = await this.resolveTargetFileForDate(formatLocalDate());
			if (!file) return;
			const raw = await this.plugin.app.vault.read(file);
			const lines = raw.split('\n');
			if (memo.lineNumber >= lines.length) return;
			// Replace content portion after 💬
			lines[memo.lineNumber] = lines[memo.lineNumber].replace(/💬\s*.*/, `💬 ${newContent}`);
			await this.plugin.app.vault.modify(file, lines.join('\n'));
			this.plugin.requestAiobViewRefresh();
		} catch (err) {
			console.error('Aiob: Failed to edit memo', err);
			new Notice('Aiob: Memo 编辑失败');
		}
	}

	/** Delete a specific memo line. */
	async deleteMemo(memo: ParsedMemo): Promise<void> {
		try {
			const file = await this.resolveTargetFileForDate(formatLocalDate());
			if (!file) return;
			const raw = await this.plugin.app.vault.read(file);
			const lines = raw.split('\n');
			if (memo.lineNumber >= lines.length) return;
			// Remove the memo line and the blank line before it (if any)
			let removeFrom = memo.lineNumber;
			if (removeFrom > 0 && lines[removeFrom - 1].trim() === '') {
				removeFrom--;
			}
			lines.splice(removeFrom, memo.lineNumber - removeFrom + 1);
			await this.plugin.app.vault.modify(file, lines.join('\n'));
			this.plugin.requestAiobViewRefresh();
		} catch (err) {
			console.error('Aiob: Failed to delete memo', err);
			new Notice('Aiob: Memo 删除失败');
		}
	}

	/** Remove the last memo line from today's target file. Returns true if a line was removed. */
	async undoLastMemo(): Promise<boolean> {
		try {
			const file = await this.resolveTargetFileForDate(formatLocalDate());
			if (!file) return false;
			const raw = await this.plugin.app.vault.read(file);
			const memos = this.parseMemosFromContent(raw);
			if (!memos.length) return false;

			const lastMemo = memos[memos.length - 1];
			const lines = raw.split('\n');
			if (lastMemo.lineNumber >= lines.length) return false;

			// Remove the memo line and the blank line before it (if any)
			let removeFrom = lastMemo.lineNumber;
			if (removeFrom > 0 && lines[removeFrom - 1].trim() === '') {
				removeFrom--;
			}
			lines.splice(removeFrom, lastMemo.lineNumber - removeFrom + 1);

			await this.plugin.app.vault.modify(file, lines.join('\n'));
			this.plugin.requestAiobViewRefresh();
			return true;
		} catch (err) {
			console.error('Aiob: Failed to undo memo', err);
			return false;
		}
	}

	// ── Internal helpers ──

	private async appendUnderHeading(line: string): Promise<void> {
		const file = await this.ensureTargetFile();
		const raw = await this.plugin.app.vault.read(file);
		const heading = this.plugin.data.config.memoStorage.heading;
		const updated = this.insertLineUnderHeading(raw, heading, line);
		await this.plugin.app.vault.modify(file, updated);
	}

	/**
	 * Parse memo lines from file content.
	 * Recognises two formats:
	 *   1. <font color="...">HH:MM</font> 💬 content   (written by this service)
	 *   2. - HH:MM content                               (plain bullet fallback)
	 */
	private parseMemosFromContent(content: string): ParsedMemo[] {
		const heading = this.plugin.data.config.memoStorage.heading;
		const lines = content.split('\n');
		const headingLevel = (heading.match(/^#+/) || ['##'])[0].length;
		const headingText = heading.replace(/^#+\s*/, '');

		let inSection = false;
		const memos: ParsedMemo[] = [];

		for (let i = 0; i < lines.length; i++) {
			const line = lines[i];
			// Check if we reached the target heading
			const hMatch = line.match(/^(#{1,6})\s+(.*)/);
			if (hMatch) {
				if (inSection) {
					// Hit another heading of same or higher level → stop
					if (hMatch[1].length <= headingLevel) break;
				}
				if (hMatch[1].length === headingLevel && hMatch[2].trim() === headingText) {
					inSection = true;
					continue;
				}
			}
			if (!inSection) continue;

			// Format 1a: <font color="...">HH:MM</font> 💬 content
			// Format 1b: <span style="...">HH:MM</span> 💬 content
			const fontMatch = line.match(/<(?:font|span)[^>]*>(\d{2}:\d{2})<\/(?:font|span)>\s*💬\s*(.*)/);
			if (fontMatch) {
				memos.push({ time: fontMatch[1], content: fontMatch[2], lineNumber: i });
				continue;
			}

			// Format 2: - HH:MM content (plain fallback)
			const bulletMatch = line.match(/^-\s+(\d{2}:\d{2})\s+(.*)/);
			if (bulletMatch) {
				memos.push({ time: bulletMatch[1], content: bulletMatch[2], lineNumber: i });
			}
		}
		return memos;
	}

	/** Insert a line at the end of a heading section (before the next heading). */
	private insertLineUnderHeading(content: string, heading: string, line: string): string {
		const lines = content.split('\n');
		const headingLevel = (heading.match(/^#+/) || ['##'])[0].length;
		const headingText = heading.replace(/^#+\s*/, '');

		let headingIndex = -1;
		let insertIndex = -1;

		for (let i = 0; i < lines.length; i++) {
			const hMatch = lines[i].match(/^(#{1,6})\s+(.*)/);
			if (!hMatch) continue;
			if (headingIndex >= 0 && hMatch[1].length <= headingLevel) {
				// Found the next heading at same or higher level
				insertIndex = i;
				break;
			}
			if (hMatch[1].length === headingLevel && hMatch[2].trim() === headingText) {
				headingIndex = i;
			}
		}

		if (headingIndex === -1) {
			// Heading not found — auto-create it at the end
			const suffix = content.endsWith('\n') ? '' : '\n';
			return content + suffix + '\n' + heading + '\n\n' + line + '\n';
		}

		if (insertIndex === -1) {
			// Heading is last section — append at end of file
			const suffix = content.endsWith('\n') ? '' : '\n';
			return content + suffix + '\n' + line + '\n';
		}

		// Insert before the next heading, with a blank line above
		lines.splice(insertIndex, 0, '\n' + line);
		return lines.join('\n');
	}

	/**
	 * Resolve the TFile for today's target. If 'daily-note' and the daily note
	 * doesn't exist yet, creates it from the user's Obsidian template (not the
	 * plugin's built-in template).
	 */
	private async ensureTargetFile(): Promise<TFile> {
		const cfg = this.plugin.data.config.memoStorage;
		const filePath = this.resolveTargetPath(cfg.targetFile);

		const existing = this.plugin.app.vault.getAbstractFileByPath(filePath);
		if (existing instanceof TFile) return existing;

		// For daily-note, use DailyNoteService to create from user template
		if (cfg.targetFile === 'daily-note') {
			const file = await this.plugin.dailyNoteService.createDailyNoteFromUserTemplate(new Date());
			if (file) return file;
		}

		// Non daily-note: create file with heading
		const folder = filePath.substring(0, filePath.lastIndexOf('/'));
		if (folder) await this.ensureFolderExists(folder);
		await this.plugin.app.vault.create(filePath, `${cfg.heading}\n`);
		const created = this.plugin.app.vault.getAbstractFileByPath(filePath);
		if (created instanceof TFile) return created;
		throw new Error(`Failed to create file: ${filePath}`);
	}

	/** Resolve TFile for a specific date (for reading). */
	private async resolveTargetFileForDate(dateStr: string): Promise<TFile | null> {
		const cfg = this.plugin.data.config.memoStorage;
		const filePath = this.resolveTargetPathForDate(cfg.targetFile, dateStr);
		const existing = this.plugin.app.vault.getAbstractFileByPath(filePath);
		return existing instanceof TFile ? existing : null;
	}

	/** Convert config target to actual vault path. */
	private resolveTargetPath(target: string, dateStr?: string): string {
		if (target === 'daily-note') {
			const date = dateStr ? new Date(`${dateStr}T12:00:00`) : new Date();
			return this.plugin.dailyNoteService.getDailyNotePathForDate(date);
		}
		return target.endsWith('.md') ? target : `${target}.md`;
	}

	private resolveTargetPathForDate(target: string, dateStr: string): string {
		return this.resolveTargetPath(target, dateStr);
	}

	private async ensureFolderExists(folderPath: string): Promise<void> {
		if (this.plugin.app.vault.getAbstractFileByPath(folderPath)) return;
		await this.plugin.app.vault.createFolder(folderPath);
	}
}
