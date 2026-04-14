import type AiobPlugin from '../main';
import { showTextInputDialog } from './dialogs';

type SectionHeaderKey = 'todo' | 'notes';

/**
 * Render a unified section header: title (left) + "say something" pill (right).
 * Each section has its own independent note text and accent color.
 */
export function renderSectionHeader(
	parent: HTMLElement,
	plugin: AiobPlugin,
	key: SectionHeaderKey,
	title: string,
	onRefresh: () => void,
	opts?: { countText?: string },
): HTMLElement {
	const header = parent.createDiv('aiob-section-header');
	header.createSpan({ cls: 'aiob-section-header-title', text: title });

	if (opts?.countText) {
		header.createSpan({ cls: 'aiob-section-header-count', text: opts.countText });
	}

	// Per-section "say something" pill. If today has no note, fall back to
	// the most recent prior day's note so yesterday's sentiment carries over
	// until the user explicitly changes it. The inherited text is treated as
	// "real text" visually (not placeholder).
	const note = getSectionNote(plugin, key);
	const pill = header.createSpan({
		cls: `aiob-section-header-pill pill-${key}${note ? '' : ' is-placeholder'}`,
		text: note || plugin.label('saySomething'),
	});
	pill.addEventListener('click', (e) => {
		e.stopPropagation();
		showTextInputDialog(plugin.label('saySomething'), note, async (value) => {
			setSectionNote(plugin, key, value);
			await plugin.saveData(plugin.data);
			onRefresh();
		});
	});

	return header;
}

function getSectionNote(plugin: AiobPlugin, key: string): string {
	// Primary store: date-less `sectionNotes` — persists until the user
	// edits it again. Fallback migration: if nothing there, pick up the
	// most recent entry from the legacy `sectionNotesByDate` store so
	// existing vaults don't lose their last value.
	const flat = plugin.data.config.today.sectionNotes;
	if (flat && typeof flat[key] === 'string' && flat[key]) return flat[key];
	const byDate = plugin.data.config.today.sectionNotesByDate || {};
	const dates = Object.keys(byDate).sort().reverse();
	for (const d of dates) {
		const v = byDate[d]?.[key];
		if (v) return v;
	}
	return '';
}

function setSectionNote(plugin: AiobPlugin, key: string, value: string): void {
	const flat = plugin.data.config.today.sectionNotes || {};
	if (value) {
		flat[key] = value;
	} else {
		delete flat[key];
	}
	plugin.data.config.today.sectionNotes = flat;
}
