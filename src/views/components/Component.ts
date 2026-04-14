import { DEFAULT_SECTION_TITLE_VISIBILITY } from '../../models/defaults';
import type { SectionId } from '../../models/types';
import type AiobPlugin from '../../main';

/**
 * Base class for UI components.
 * Each component manages its own DOM element and state.
 */
export abstract class Component {
	protected el: HTMLElement | null = null;

	constructor(protected plugin: AiobPlugin) {}

	/** Render the component into the given container. */
	abstract render(container: HTMLElement): void;

	/** Re-render preserving the same parent. */
	refresh(): void {
		if (!this.el?.parentElement) return;
		const parent = this.el.parentElement;
		this.el.remove();
		this.render(parent);
	}

	protected isSectionTitleVisible(key: SectionId): boolean {
		const current = this.plugin.data.config.sectionTitleVisibility || {};
		return (current[key] ?? DEFAULT_SECTION_TITLE_VISIBILITY[key]) !== false;
	}

	/** Clean up DOM references and timers. */
	destroy(): void {
		this.el = null;
	}
}
