import { setIcon } from 'obsidian';

type AiobIconSize = 'lg' | 'md' | 'sm';

/**
 * Unified icon rendering for ALL icon buttons across the plugin.
 *
 * Always wraps the icon in a `<span class="aiob-icon is-{size}">` so that
 * Obsidian's global SVG sizing rules (which lock SVGs that are direct children
 * of `<button>` elements) cannot override our sizes. Every icon button should
 * go through this helper — do not call `setIcon` on a button element directly.
 */
export function renderIcon(host: HTMLElement, iconName: string, size: AiobIconSize = 'lg'): HTMLSpanElement {
	const wrap = host.createSpan({ cls: `aiob-icon is-${size}` });
	setIcon(wrap, iconName);
	return wrap;
}

