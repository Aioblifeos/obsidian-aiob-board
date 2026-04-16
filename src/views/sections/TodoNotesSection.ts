import { setIcon, Menu } from 'obsidian';
import type { Section, SectionRenderContext } from './Section';
import type { SectionDeps } from './SectionDeps';
import type { MarkdownTodo } from '../../services/MarkdownTodoService';
import { formatLocalDate } from '../../utils/date';

/** How many items are visible before scroll kicks in. */
const VISIBLE_COUNT = 4;
/** Row height (px) — must match CSS .aiob-board-todo-row / .aiob-board-notes-row height. */
const ROW_HEIGHT = 34;

/** Create a scrollable container with bottom fade hint. */
function createScrollList(parent: HTMLElement, itemCount: number): HTMLElement {
	const needsScroll = itemCount > VISIBLE_COUNT;
	if (!needsScroll) return parent.createDiv('aiob-board-tn-scroll');

	const wrap = parent.createDiv('aiob-board-tn-scroll-wrap');
	const list = wrap.createDiv('aiob-board-tn-scroll');
	list.style.setProperty('max-height', `${VISIBLE_COUNT * ROW_HEIGHT}px`);
	list.addEventListener('scroll', () => {
		const atBottom = list.scrollTop + list.clientHeight >= list.scrollHeight - 4;
		wrap.toggleClass('is-scrolled-bottom', atBottom);
	});
	return list;
}

/**
 * Combined Todo + Notes section with an internal tab bar.
 * Reads todos from Markdown files via MarkdownTodoService.
 */
export class TodoNotesSection implements Section {
	readonly id = 'todo' as const;
	private activeTab: 'todo' | 'notes' = 'todo';

	constructor(private deps: SectionDeps) {}

	render(container: HTMLElement, ctx: SectionRenderContext): void {
		// ── Tab bar ──
		const tabBar = container.createDiv('aiob-board-tn-tabs');
		const todoTab = tabBar.createDiv('aiob-board-tn-tab');
		todoTab.setText(this.deps.plugin.label('dailyTodo'));
		const notesTab = tabBar.createDiv('aiob-board-tn-tab');
		notesTab.setText(this.deps.plugin.label('dailyNotes'));

		if (this.activeTab === 'todo') todoTab.addClass('is-active');
		else notesTab.addClass('is-active');

		const body = container.createDiv('aiob-board-tn-body');

		todoTab.addEventListener('click', () => {
			if (this.activeTab === 'todo') return;
			this.activeTab = 'todo';
			todoTab.addClass('is-active');
			notesTab.removeClass('is-active');
			body.empty();
			void this.renderTodo(body);
		});
		notesTab.addEventListener('click', () => {
			if (this.activeTab === 'notes') return;
			this.activeTab = 'notes';
			notesTab.addClass('is-active');
			todoTab.removeClass('is-active');
			body.empty();
			this.renderNotes(body);
		});

		if (this.activeTab === 'todo') void this.renderTodo(body);
		else this.renderNotes(body);
	}

	// ── Todo ──

	private async renderTodo(container: HTMLElement): Promise<void> {
		const { plugin } = this.deps;
		const dateStr = formatLocalDate();

		// Get todos from markdown
		const allTodos = await plugin.markdownTodoService.getTodosForDate(dateStr);

		// Optionally add vault-synced todos
		const vaultTodos = await plugin.markdownTodoService.getVaultTodos();

		const pending: MarkdownTodo[] = [];
		const completed: MarkdownTodo[] = [];
		for (const t of allTodos) {
			if (t.completed) completed.push(t);
			else pending.push(t);
		}

		// Vault todos are always pending (we only sync uncompleted)
		// Newest first (reverse file order so latest-added todo is at top)
		const allPending = [...pending.reverse(), ...vaultTodos];

		if (!container.isConnected) return;

		// Inline create
		const inputRow = container.createDiv('aiob-board-todo-input');
		const input = inputRow.createEl('input', {
			type: 'text',
			placeholder: this.deps.plugin.label('addTodo'),
			cls: 'aiob-board-todo-input-field',
		});
		input.addEventListener('keydown', (e: KeyboardEvent) => {
			if (e.key === 'Enter') {
				const text = input.value.trim();
				if (!text) return;
				void plugin.markdownTodoService.createTodo(text);
				input.value = '';
			}
		});

		// Scrollable list for pending
		const listWrap = createScrollList(container, allPending.length);

		if (allPending.length) {
			for (const todo of allPending) this.renderTodoRow(listWrap, todo, false);
		} else {
			listWrap.createDiv({ cls: 'aiob-board-todo-empty', text: this.deps.plugin.label('noTodo') });
		}

		// Completed (collapsed, also scrollable)
		if (completed.length) {
			const toggle = container.createDiv('aiob-board-todo-done-header');
			toggle.setText(`${this.deps.plugin.label('done')} (${completed.length})`);
			const doneOuter = container.createDiv('aiob-board-todo-done-list is-collapsed');
			const doneList = createScrollList(doneOuter, completed.length);
			toggle.addEventListener('click', () => {
				const wasCollapsed = doneOuter.hasClass('is-collapsed');
				doneOuter.toggleClass('is-collapsed', !wasCollapsed);
				toggle.toggleClass('is-open', wasCollapsed);
			});
			for (const todo of completed) this.renderTodoRow(doneList, todo, true);
		}
	}

	private renderTodoRow(parent: HTMLElement, todo: MarkdownTodo, isDone: boolean): void {
		const row = parent.createDiv(`aiob-board-todo-row${isDone ? ' is-done' : ''}`);
		const checkbox = row.createDiv('aiob-board-todo-checkbox');
		setIcon(checkbox, isDone ? 'check-circle-2' : 'circle');
		checkbox.addEventListener('click', (e) => {
			e.stopPropagation();
			void this.deps.plugin.markdownTodoService.toggleComplete(todo);
		});
		const contentSpan = row.createSpan({ cls: 'aiob-board-todo-content', text: todo.content });

		// Show source file hint for vault-synced todos (not from primary target)
		const cfg = this.deps.plugin.data.config.todoStorage;
		const primaryPath = cfg.targetFile === 'daily-note'
			? this.deps.plugin.dailyNoteService.getDailyNotePathForDate(new Date())
			: (cfg.targetFile.endsWith('.md') ? cfg.targetFile : `${cfg.targetFile}.md`);
		if (todo.filePath !== primaryPath) {
			const basename = todo.filePath.replace(/\.md$/, '').split('/').pop() || '';
			row.createSpan({ cls: 'aiob-board-todo-source', text: basename });
		}

		// Context menu: edit & delete
		row.addEventListener('contextmenu', (e) => {
			e.preventDefault();
			e.stopPropagation();
			this.showTodoContextMenu(e, todo, contentSpan, row);
		});
	}

	private showTodoContextMenu(e: MouseEvent, todo: MarkdownTodo, contentSpan: HTMLSpanElement, row: HTMLElement): void {
		const { plugin } = this.deps;
		const menu = new Menu();

		menu.addItem(i => i
			.setTitle(plugin.label('editTodo'))
			.setIcon('pencil')
			.onClick(() => {
				// Replace content span with inline input
				const input = document.createElement('input');
				input.type = 'text';
				input.value = todo.content;
				input.className = 'aiob-board-todo-edit-input';
				contentSpan.replaceWith(input);
				input.focus();
				input.select();

				const save = () => {
					const newText = input.value.trim();
					if (newText && newText !== todo.content) {
						void plugin.markdownTodoService.editTodo(todo, newText);
					} else {
						// Restore original
						input.replaceWith(contentSpan);
					}
				};
				input.addEventListener('blur', save);
				input.addEventListener('keydown', (ke: KeyboardEvent) => {
					if (ke.key === 'Enter') save();
					if (ke.key === 'Escape') input.replaceWith(contentSpan);
				});
			})
		);

		menu.addItem(i => i
			.setTitle(plugin.label('deleteTodo'))
			.setIcon('trash-2')
			.onClick(() => {
				void plugin.markdownTodoService.deleteTodo(todo);
			})
		);

		menu.showAtMouseEvent(e);
	}

	// ── Notes ──

	private renderNotes(container: HTMLElement): void {
		const { plugin } = this.deps;
		const today = formatLocalDate();
		const todayStart = new Date(`${today}T00:00:00`).getTime();
		const dailyNotePath = plugin.dailyNoteService.getDailyNotePathForDate(new Date());

		const recentFiles = plugin.app.vault.getFiles()
			.filter(f => f.extension === 'md')
			.filter(f => f.path !== dailyNotePath)
			.filter(f => !f.path.startsWith('.'))
			.sort((a, b) => b.stat.mtime - a.stat.mtime)
			.slice(0, 20);

		if (!recentFiles.length) {
			container.createDiv({ cls: 'aiob-board-notes-empty', text: this.deps.plugin.label('noNotes') });
			return;
		}

		const listWrap = createScrollList(container, recentFiles.length);

		for (const file of recentFiles) {
			const row = listWrap.createDiv('aiob-board-notes-row');
			const isNew = file.stat.ctime >= todayStart;
			if (isNew) {
				row.createSpan({ cls: 'aiob-board-notes-badge', text: 'NEW' });
			}
			row.createSpan({ cls: 'aiob-board-notes-name', text: file.basename });
			const time = new Date(file.stat.mtime);
			const timeStr = `${String(time.getHours()).padStart(2, '0')}:${String(time.getMinutes()).padStart(2, '0')}`;
			const mtimeDate = formatLocalDate(time);
			row.createSpan({ cls: 'aiob-board-notes-time', text: mtimeDate === today ? timeStr : mtimeDate.slice(5) });
			row.addEventListener('click', () => {
				void plugin.app.workspace.getLeaf(false).openFile(file);
			});
		}
	}
}
