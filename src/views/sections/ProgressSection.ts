import type { Section, SectionRenderContext } from './Section';
import type { SectionDeps } from './SectionDeps';

/** Segmented progress bars for today/week/month/year as a 2x2 grid. */
export class ProgressSection implements Section {
	readonly id = 'progress' as const;

	constructor(private deps: SectionDeps) {}

	render(container: HTMLElement, ctx: SectionRenderContext): void {
		const { plugin } = this.deps;
		const now = new Date();
		const isSidebar = ctx.tab === 'sidebar';
		const grid = container.createDiv('aiob-home-progress-grid');

		// ── Today: 24 segments (hours) ──
		const currentHour = now.getHours();
		const todayPct = Math.round((currentHour / 24) * 100);
		const todayRemainHours = 24 - currentHour;
		this.renderProgressCard(grid, plugin.label('today'), `已过${todayPct}%，剩${todayRemainHours}小时`, 24, currentHour);

		if (isSidebar) return;

		// ── This Week: 7 segments (days, Mon=0) ──
		const dow = now.getDay();
		const weekDayIndex = dow === 0 ? 6 : dow - 1;
		const weekPct = Math.round(((weekDayIndex + 1) / 7) * 100);
		const weekRemain = 6 - weekDayIndex;
		this.renderProgressCard(grid, plugin.label('thisWeek'), `已过${weekPct}%，剩${weekRemain}天`, 7, weekDayIndex);

		// ── This Month: days in month segments ──
		const currentDay = now.getDate();
		const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
		const monthPct = Math.round((currentDay / daysInMonth) * 100);
		const monthRemain = daysInMonth - currentDay;
		this.renderProgressCard(grid, plugin.label('thisMonth'), `已过${monthPct}%，剩${monthRemain}天`, daysInMonth, currentDay - 1);

		// ── This Year: 12 segments (months) ──
		const currentMonth = now.getMonth();
		const daysInYear = ((now.getFullYear() % 4 === 0 && now.getFullYear() % 100 !== 0) || now.getFullYear() % 400 === 0) ? 366 : 365;
		const dayOfYear = Math.ceil((now.getTime() - new Date(now.getFullYear(), 0, 1).getTime()) / 86400000);
		const yearPct = Math.round((dayOfYear / daysInYear) * 100);
		const yearRemain = daysInYear - dayOfYear;
		this.renderProgressCard(grid, plugin.label('thisYear'), `已过${yearPct}%，剩${yearRemain}天`, 12, currentMonth);
	}

	private renderProgressCard(parent: HTMLElement, label: string, info: string, segments: number, filledCount: number): void {
		const card = parent.createDiv('aiob-home-progress-card');
		const header = card.createDiv('aiob-home-progress-header');
		header.createSpan({ cls: 'aiob-home-progress-label', text: label });
		header.createSpan({ cls: 'aiob-home-progress-pct', text: info });
		const bar = card.createDiv('aiob-home-progress-segmented');
		for (let i = 0; i < segments; i++) {
			const seg = bar.createDiv('aiob-home-progress-seg');
			if (i < filledCount) seg.addClass('is-filled');
			else if (i === filledCount) seg.addClass('is-current');
		}
	}
}
