import type AiobPlugin from '../../main';
import type { MemoInput } from '../components/MemoInput';
import type { ChannelGrid } from '../components/ChannelGrid';

/**
 * Long-lived dependencies passed to every section instance at construction
 * time. The view owns these and the sections borrow them.
 */
export interface SectionDeps {
	plugin: AiobPlugin;
	onRefresh: () => void;
	memoInput: MemoInput;
	channelGrid: ChannelGrid;
}
