import type { SectionId } from '../../models/types';
import type { Section } from './Section';
import type { SectionDeps } from './SectionDeps';

import { MemoSection } from './MemoSection';
import { ChannelsSection } from './ChannelsSection';
import { ProgressSection } from './ProgressSection';
import { SidebarStatsSection } from './SidebarStatsSection';
import { TodoNotesSection } from './TodoNotesSection';

/**
 * Instance-based section factory: constructs every section once at view init
 * with the long-lived `SectionDeps`. Each section instance owns its own state
 * (selected ranges, expanded items, undo history, ...), so re-renders preserve
 * UI state without per-render reconstruction.
 */
export class SectionFactory {
	private instances: Partial<Record<SectionId, Section>> = {};

	constructor(deps: SectionDeps) {
		this.instances.memo = new MemoSection(deps);
		this.instances.channels = new ChannelsSection(deps);
		this.instances.progress = new ProgressSection(deps);
		this.instances.sidebarStats = new SidebarStatsSection(deps);
		this.instances.todo = new TodoNotesSection(deps);
	}

	get(id: SectionId): Section | undefined {
		return this.instances[id];
	}

	supports(id: SectionId): boolean {
		return id in this.instances;
	}

	all(): Section[] {
		return Object.values(this.instances) as Section[];
	}
}
