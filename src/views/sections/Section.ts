import type { SectionId, TabId } from '../../models/types';

export interface SectionRenderContext {
	/** Which tab is currently rendering this section. */
	tab: TabId;
}

export interface Section {
	readonly id: SectionId;
	render(container: HTMLElement, ctx: SectionRenderContext): void;
}
