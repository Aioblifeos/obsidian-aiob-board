import { TFile, Notice } from 'obsidian';
import type AiobPlugin from '../main';
import { formatLocalDate } from '../utils/date';

export interface MarkdownTodo {
	content: string;
	completed: boolean;
	filePath: string;
	lineNumber: number;
	/** Raw line text from the file */
	rawLine: string;
}

/**
 * Reads and writes todos as markdown checkboxes under a configurable heading.
 * Format: `- [ ] content` / `- [x] content`
 *
 * When targetFile is 'daily-note', also scans recent daily notes
 * for incomplete todos (carry-over behaviour).
 *
 * Optionally scans the entire vault for `- [ ]` tasks from other files (sync mode).
 */
export class MarkdownTodoService {
	constructor(private plugin: AiobPlugin) {}

	/** Create a new todo under the configured heading. */
	async createTodo(content: string): Promise<void> {
		const line = `- [ ] ${content}`;
		try {
			await this.appendUnderHeading(line);
			this.plugin.requestAiobViewRefresh();
		} catch (err) {
			console.error('Aiob: Failed to create todo', err);
			new Notice('Aiob: Todo 保存失败');
		}
	}

	/** Edit a todo's content in its source file. */
	async editTodo(todo: MarkdownTodo, newContent: string): Promise<void> {
		try {
			const file = this.plugin.app.vault.getAbstractFileByPath(todo.filePath);
			if (!(file instanceof TFile)) return;

			const raw = await this.plugin.app.vault.read(file);
			const lines = raw.split('\n');
			if (todo.lineNumber >= lines.length) return;

			const currentLine = lines[todo.lineNumber];
			// Replace content part while keeping checkbox prefix
			const prefix = currentLine.match(/^(\s*-\s*\[[ xX]\]\s*)/);
			if (prefix) {
				lines[todo.lineNumber] = prefix[1] + newContent;
			}
			await this.plugin.app.vault.modify(file, lines.join('\n'));
			this.plugin.requestAiobViewRefresh();
		} catch (err) {
			console.error('Aiob: Failed to edit todo', err);
			new Notice('Aiob: 编辑失败');
		}
	}

	/** Delete a todo line from its source file. */
	async deleteTodo(todo: MarkdownTodo): Promise<void> {
		try {
			const file = this.plugin.app.vault.getAbstractFileByPath(todo.filePath);
			if (!(file instanceof TFile)) return;

			const raw = await this.plugin.app.vault.read(file);
			const lines = raw.split('\n');
			if (todo.lineNumber >= lines.length) return;

			lines.splice(todo.lineNumber, 1);
			// Remove trailing blank line if the previous line is also blank
			if (todo.lineNumber < lines.length && lines[todo.lineNumber]?.trim() === '' &&
				todo.lineNumber > 0 && lines[todo.lineNumber - 1]?.trim() === '') {
				lines.splice(todo.lineNumber, 1);
			}
			await this.plugin.app.vault.modify(file, lines.join('\n'));
			this.plugin.requestAiobViewRefresh();
		} catch (err) {
			console.error('Aiob: Failed to delete todo', err);
			new Notice('Aiob: 删除失败');
		}
	}

	/** Toggle a todo's completion status in its source file. */
	async toggleComplete(todo: MarkdownTodo): Promise<void> {
		try {
			const file = this.plugin.app.vault.getAbstractFileByPath(todo.filePath);
			if (!(file instanceof TFile)) return;

			const raw = await this.plugin.app.vault.read(file);
			const lines = raw.split('\n');
			if (todo.lineNumber >= lines.length) return;

			const currentLine = lines[todo.lineNumber];
			if (todo.completed) {
				// Uncheck: `- [x]` → `- [ ]`
				lines[todo.lineNumber] = currentLine.replace(/^(\s*-\s*)\[x\]/i, '$1[ ]');
			} else {
				// Check: `- [ ]` → `- [x]`
				lines[todo.lineNumber] = currentLine.replace(/^(\s*-\s*)\[\s\]/, '$1[x]');
			}
			await this.plugin.app.vault.modify(file, lines.join('\n'));
			this.plugin.requestAiobViewRefresh();
		} catch (err) {
			console.error('Aiob: Failed to toggle todo', err);
			new Notice('Aiob: 更新失败');
		}
	}

	/**
	 * Get todos to display.
	 * - Reads from today's target file heading section
	 * - If target is 'daily-note', carries over incomplete todos from recent days
	 * - Returns de-duplicated list
	 */
	async getTodosForDate(dateStr: string): Promise<MarkdownTodo[]> {
		const cfg = this.plugin.data.config.todoStorage;

		// Read from today's target file
		const filePath = this.resolveTargetPathForDate(cfg.targetFile, dateStr);
		const todayTodos = await this.readTodosFromFile(filePath, cfg.heading);

		// If target is daily-note, carry over incomplete todos from recent daily notes
		if (cfg.targetFile === 'daily-note') {
			const carryOver = await this.getCarryOverTodos(dateStr, filePath);
			// Merge: today's todos first, then carry-overs (pending only, de-duped by content)
			const seenContent = new Set(todayTodos.map(t => t.content.trim().toLowerCase()));
			for (const ct of carryOver) {
				const key = ct.content.trim().toLowerCase();
				if (!seenContent.has(key)) {
					seenContent.add(key);
					todayTodos.push(ct);
				}
			}
		}
		return todayTodos;
	}

	/**
	 * Get all pending tasks from the vault (for sync mode).
	 * Scans markdown files for `- [ ]` checkboxes.
	 */
	async getVaultTodos(): Promise<MarkdownTodo[]> {
		const cfg = this.plugin.data.config.todoStorage;
		if (!cfg.syncFromVault) return [];

		// Build set of paths to exclude (today's target + recent daily notes)
		const excludePaths = new Set<string>();
		const targetPath = this.resolveTargetPath(cfg.targetFile);
		excludePaths.add(targetPath);

		// If daily-note mode, exclude recent daily note paths too
		if (cfg.targetFile === 'daily-note') {
			for (let d = 1; d <= 7; d++) {
				const pastDate = new Date();
				pastDate.setDate(pastDate.getDate() - d);
				excludePaths.add(this.plugin.dailyNoteService.getDailyNotePathForDate(pastDate));
			}
		}

		const files = this.plugin.app.vault.getMarkdownFiles()
			.filter(f => {
				if (excludePaths.has(f.path)) return false;
				if (f.path.startsWith('.')) return false;
				if (cfg.syncFolder) {
					const folder = cfg.syncFolder.replace(/\/+$/, '');
					return f.path.startsWith(folder + '/');
				}
				return true;
			});

		const todos: MarkdownTodo[] = [];
		for (const file of files) {
			const raw = await this.plugin.app.vault.cachedRead(file);
			const fileTodos = this.parseAllCheckboxes(raw, file.path);
			// Only include pending (unchecked) tasks from vault
			todos.push(...fileTodos.filter(t => !t.completed));
		}
		return todos;
	}

	/** Count completed and total todos for today (convenience for stats). */
	async getTodayTodoStats(): Promise<{ done: number; total: number }> {
		const todos = await this.getTodosForDate(formatLocalDate());
		let done = 0;
		for (const t of todos) {
			if (t.completed) done++;
		}
		return { done, total: todos.length };
	}

	// ── Internal helpers ──

	/**
	 * Carry over: scan the last N daily notes for incomplete todos.
	 * Returns only pending (unchecked) items not from today's file.
	 */
	private async getCarryOverTodos(todayStr: string, todayFilePath: string): Promise<MarkdownTodo[]> {
		const heading = this.plugin.data.config.todoStorage.heading;
		const carryOver: MarkdownTodo[] = [];
		// Look back up to 7 days
		for (let d = 1; d <= 7; d++) {
			const pastDate = new Date();
			pastDate.setDate(pastDate.getDate() - d);
			const pastPath = this.plugin.dailyNoteService.getDailyNotePathForDate(pastDate);
			if (pastPath === todayFilePath) continue;

			const pastTodos = await this.readTodosFromFile(pastPath, heading);
			for (const t of pastTodos) {
				if (!t.completed) carryOver.push(t);
			}
		}
		return carryOver;
	}

	/** Read todos from a specific file's heading section. */
	private async readTodosFromFile(filePath: string, heading: string): Promise<MarkdownTodo[]> {
		const file = this.plugin.app.vault.getAbstractFileByPath(filePath);
		if (!(file instanceof TFile)) return [];
		const raw = await this.plugin.app.vault.cachedRead(file);
		return this.parseTodosFromContent(raw, filePath, heading);
	}

	private async appendUnderHeading(line: string): Promise<void> {
		const file = await this.ensureTargetFile();
		const raw = await this.plugin.app.vault.read(file);
		const heading = this.plugin.data.config.todoStorage.heading;
		const updated = this.insertLineUnderHeading(raw, heading, line);
		await this.plugin.app.vault.modify(file, updated);
	}

	/** Parse todos from content under a specific heading. */
	private parseTodosFromContent(content: string, filePath: string, heading: string): MarkdownTodo[] {
		const lines = content.split('\n');
		const headingLevel = (heading.match(/^#+/) || ['##'])[0].length;
		const headingText = heading.replace(/^#+\s*/, '');

		let inSection = false;
		const todos: MarkdownTodo[] = [];

		for (let i = 0; i < lines.length; i++) {
			const line = lines[i];
			const hMatch = line.match(/^(#{1,6})\s+(.*)/);
			if (hMatch) {
				if (inSection && hMatch[1].length <= headingLevel) break;
				if (hMatch[1].length === headingLevel && hMatch[2].trim() === headingText) {
					inSection = true;
					continue;
				}
			}
			if (!inSection) continue;

			const todo = this.parseCheckboxLine(line, filePath, i);
			if (todo) todos.push(todo);
		}
		return todos;
	}

	/** Parse ALL checkbox lines from a file (for vault scan). */
	private parseAllCheckboxes(content: string, filePath: string): MarkdownTodo[] {
		const lines = content.split('\n');
		const todos: MarkdownTodo[] = [];
		for (let i = 0; i < lines.length; i++) {
			const todo = this.parseCheckboxLine(lines[i], filePath, i);
			if (todo) todos.push(todo);
		}
		return todos;
	}

	/** Parse a single checkbox line: `- [ ] content` or `- [x] content`. */
	private parseCheckboxLine(line: string, filePath: string, lineNumber: number): MarkdownTodo | null {
		const match = line.match(/^\s*-\s*\[([ xX])\]\s+(.*)/);
		if (!match || !match[2].trim()) return null;
		return {
			content: match[2],
			completed: match[1].toLowerCase() === 'x',
			filePath,
			lineNumber,
			rawLine: line,
		};
	}

	/** Insert a line at the end of a heading section. */
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
				insertIndex = i;
				break;
			}
			if (hMatch[1].length === headingLevel && hMatch[2].trim() === headingText) {
				headingIndex = i;
			}
		}

		if (headingIndex === -1) {
			// Heading not found — auto-create at end
			const suffix = content.endsWith('\n') ? '' : '\n';
			return content + suffix + '\n' + heading + '\n' + line + '\n';
		}

		if (insertIndex === -1) {
			const suffix = content.endsWith('\n') ? '' : '\n';
			return content + suffix + line + '\n';
		}

		lines.splice(insertIndex, 0, line);
		return lines.join('\n');
	}

	/**
	 * Resolve the TFile for today's target. If 'daily-note' and the daily note
	 * doesn't exist yet, creates it from the user's Obsidian template.
	 */
	private async ensureTargetFile(): Promise<TFile> {
		const cfg = this.plugin.data.config.todoStorage;
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
