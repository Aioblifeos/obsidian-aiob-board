import type { Section, SectionRenderContext } from './Section';
import type { SectionDeps } from './SectionDeps';
import { formatLocalDate } from '../../utils/date';

export class SidebarStatsSection implements Section {
	readonly id = 'sidebarStats' as const;

	constructor(private deps: SectionDeps) {}

	render(container: HTMLElement, ctx: SectionRenderContext): void {
		void this.renderAsync(container, ctx);
	}

	private async renderAsync(container: HTMLElement, ctx: SectionRenderContext): Promise<void> {
		const { plugin } = this.deps;
		const todayStr = formatLocalDate();

		// Get stats from Markdown services
		const todoStats = await plugin.markdownTodoService.getTodayTodoStats();
		const memoCount = await plugin.markdownMemoService.getTodayMemoCount();

		// Today word count (from typed words tracker)
		const todayWords = plugin.getTodayTypedWords();

		// Single vault scan for all file stats
		const allFiles = plugin.app.vault.getFiles();
		const dailyNotePath = plugin.dailyNoteService.getDailyNotePathForDate(new Date());
		const todayStart = new Date(`${todayStr}T00:00:00`).getTime();
		let earliest = Date.now();
		let todayNotesCount = 0;
		let recentMtime = 0;
		for (const f of allFiles) {
			if (f.stat.ctime < earliest) earliest = f.stat.ctime;
			if (f.extension !== 'md') continue;
			if (f.stat.mtime > recentMtime) recentMtime = f.stat.mtime;
			if (f.path !== dailyNotePath && f.stat.ctime >= todayStart) todayNotesCount++;
		}
		const vaultDays = Math.ceil((Date.now() - earliest) / 86400000);
		const recentTime = recentMtime ? this.formatTime(new Date(recentMtime)) : '--';

		if (!container.isConnected) return;
		container.empty();

		// Cards grid — sidebar gets compact set, main gets full set
		const isZh = (plugin.data.config.appearance.sectionLanguage ?? 'zh') === 'zh';
		const isSidebar = ctx.tab === 'sidebar';
		const cards = isSidebar
			? [
				{ stat: 'words', label: plugin.label('statWords'), value: `${todayWords}` },
				{ stat: 'todo', label: plugin.label('statTodo'), value: `${todoStats.done}/${todoStats.total}` },
				{ stat: 'memos', label: plugin.label('statMemos'), value: `${memoCount}` },
				{ stat: 'notes', label: plugin.label('statNotes'), value: `${todayNotesCount}` },
			]
			: [
			{ stat: 'vault', label: 'Obsidian', value: `${vaultDays} ${isZh ? '天' : 'd'}` },
			{ stat: 'updated', label: isZh ? '最近更新' : 'Updated', value: recentTime },
			{ stat: 'words', label: plugin.label('statWords'), value: `${todayWords}` },
			{ stat: 'todo', label: plugin.label('statTodo'), value: `${todoStats.done}/${todoStats.total}` },
			{ stat: 'memos', label: plugin.label('statMemos'), value: `${memoCount}` },
			{ stat: 'notes', label: plugin.label('statNotes'), value: `${todayNotesCount}` },
		];
		const grid = container.createDiv('aiob-sb-overview-grid');
		for (const { stat, label, value } of cards) {
			const card = grid.createDiv('aiob-sb-overview-card');
			card.dataset.stat = stat;
			card.createDiv({ cls: 'aiob-sb-overview-label', text: label });
			card.createDiv({ cls: 'aiob-sb-overview-value', text: value });
		}
	}

	private formatTime(d: Date): string {
		return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
	}
}
