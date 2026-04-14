import type { Section } from './Section';
import type { SectionDeps } from './SectionDeps';

export class ChannelsSection implements Section {
	readonly id = 'channels' as const;

	constructor(private deps: SectionDeps) {}

	render(container: HTMLElement): void {
		this.deps.channelGrid.render(container);
	}
}
