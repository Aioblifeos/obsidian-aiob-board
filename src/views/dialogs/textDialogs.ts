import { Notice } from 'obsidian';
import { createDialogShell, presentDialogShell } from './core';
import { createDialogSubmitRow, createDialogTextarea } from './shared';
import { enhanceDialogTextareas, normalizeDialogWikilinks } from './wikilinks';

export function showTextInputDialog(title: string, defaultValue: string, onSave: (val: string) => void | Promise<void>): void {
	const { overlay, card } = createDialogShell(title);
	const inp = createDialogTextarea(card, defaultValue);
	const submit = async () => {
		const value = normalizeDialogWikilinks(inp.value).trim();
		if (!value) {
			overlay.remove();
			return;
		}
		try {
			await onSave(value);
			overlay.remove();
		} catch (error) {
			console.error('Aiob: Failed to save text input dialog', error);
			new Notice('保存失败');
		}
	};
	let submitBtn: HTMLButtonElement | null = null;
	enhanceDialogTextareas(overlay, card, () => submitBtn?.click());
	submitBtn = createDialogSubmitRow(card, submit, { onCancel: () => overlay.remove() });
	presentDialogShell(overlay, card, inp);
}
