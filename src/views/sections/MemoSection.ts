import { MarkdownRenderer, Component, Menu } from 'obsidian';
import type { Section } from './Section';
import type { SectionDeps } from './SectionDeps';
import type { ParsedMemo } from '../../services/MarkdownMemoService';
import { formatLocalDate } from '../../utils/date';

export class MemoSection implements Section {
	readonly id = 'memo' as const;
	private _renderComponents: Component[] = [];

	constructor(private deps: SectionDeps) {}

	render(container: HTMLElement): void {
		// Clean up previous render's components
		for (const c of this._renderComponents) c.unload();
		this._renderComponents = [];
		this.deps.memoInput.render(container);
		void this.renderRecentMemos(container);
	}

	private async renderRecentMemos(container: HTMLElement): Promise<void> {
		const { plugin } = this.deps;
		const todayStr = formatLocalDate();
		const memos = await plugin.markdownMemoService.getMemosForDate(todayStr);
		if (!memos.length || !container.isConnected) return;

		const recent = memos.slice(-3).reverse();
		const list = container.createDiv('aiob-memo-recent');
		const sourcePath = plugin.app.workspace.getActiveFile()?.path ?? '';

		// Delegate internal-link clicks to Obsidian's native openLinkText
		list.addEventListener('click', (e) => {
			const link = (e.target as HTMLElement).closest('a.internal-link');
			if (!link) return;
			e.preventDefault();
			e.stopPropagation();
			const href = link.getAttribute('data-href') || link.getAttribute('href') || '';
			// openLinkText opens existing files or creates new ones — standard Obsidian behavior
			void plugin.app.workspace.openLinkText(href, sourcePath, false);
		});

		for (const memo of recent) {
			const row = list.createDiv('aiob-memo-recent-row');
			row.createSpan({ cls: 'aiob-memo-recent-time', text: memo.time });
			const textEl = row.createDiv({ cls: 'aiob-memo-recent-text' });
			const comp = new Component();
			comp.load();
			this._renderComponents.push(comp);
			await MarkdownRenderer.render(
				plugin.app,
				memo.content,
				textEl,
				sourcePath,
				comp,
			);
			row.addEventListener('contextmenu', (e) => {
				e.preventDefault();
				e.stopPropagation();
				this.showMemoContextMenu(e, memo, textEl, row);
			});
		}
	}

	private showMemoContextMenu(e: MouseEvent, memo: ParsedMemo, textEl: HTMLElement, row: HTMLElement): void {
		const { plugin } = this.deps;
		const menu = new Menu();

		menu.addItem(i => i
			.setTitle(plugin.label('editTodo'))
			.setIcon('pencil')
			.onClick(() => {
				// Replace text element with inline input
				const input = document.createElement('input');
				input.type = 'text';
				input.className = 'aiob-board-todo-edit-input';
				input.value = memo.content;
				textEl.replaceWith(input);
				input.focus();
				input.select();

				const save = () => {
					const newText = input.value.trim();
					if (newText && newText !== memo.content) {
						void plugin.markdownMemoService.editMemo(memo, newText);
					} else {
						input.replaceWith(textEl);
					}
				};
				input.addEventListener('blur', save);
				input.addEventListener('keydown', (ke) => {
					if (ke.key === 'Enter') { ke.preventDefault(); input.blur(); }
					if (ke.key === 'Escape') { input.removeEventListener('blur', save); input.replaceWith(textEl); }
				});
			})
		);

		menu.addItem(i => i
			.setTitle(plugin.label('deleteTodo'))
			.setIcon('trash-2')
			.onClick(() => {
				void plugin.markdownMemoService.deleteMemo(memo);
			})
		);

		menu.showAtMouseEvent(e);
	}
}
