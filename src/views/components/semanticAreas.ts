import { Menu } from 'obsidian';
import type AiobPlugin from '../../main';
import { getSemanticAreaLabel, normalizeSemanticAreas } from '../../models/semantic';
import { createDialogShell, createDialogSubmitRow, presentDialogShell, showAiobMenu, showTextInputDialog } from '../dialogs';

const VAULT_AREA_SCAN_COOLDOWN_MS = 60_000;
const VAULT_AREA_CACHE = new WeakMap<AiobPlugin, {
	revision: number;
	values: string[];
	scannedAt: number;
}>();

export function getSemanticAreasText(areas: string[]): string {
	return normalizeSemanticAreas(areas)
		.map((area) => getSemanticAreaLabel(area))
		.join(' · ');
}

export function showSemanticAreasMenuAt(
	plugin: AiobPlugin,
	target: HTMLElement,
	currentAreas: string[],
	onChange: (areas: string[]) => void,
): void {
	const normalized = normalizeSemanticAreas(currentAreas);
	const current = new Set(normalized);
	const menu = new Menu();
	for (const area of getVaultAreaOptions(plugin, normalized)) {
		const isActive = current.has(area);
		menu.addItem((item) => item
			.setTitle(getSemanticAreaLabel(area))
			.setIcon(isActive ? 'check' : 'folder')
			.onClick(() => {
				const next = isActive
					? normalized.filter((value) => value !== area)
					: [...normalized, area];
				onChange(normalizeSemanticAreas(next));
			}));
	}
	menu.addSeparator();
	menu.addItem((item) => item.setTitle('自定义...').setIcon('pencil').onClick(() => {
		showTextInputDialog(
			'设置 areas',
			normalized.map((area) => getSemanticAreaLabel(area)).join(', '),
			(value) => onChange(normalizeSemanticAreas(value)),
		);
	}));
	if (normalized.length) {
		menu.addItem((item) => item.setTitle('清除 areas').setIcon('x').onClick(() => onChange([])));
	}
	showAiobMenu(menu, { anchorEl: target });
}

export function showSemanticAreasDialog(
	plugin: AiobPlugin,
	currentAreas: string[],
	onChange: (areas: string[]) => void | Promise<void>,
	options?: { title?: string; helpText?: string },
): void {
	const normalized = normalizeSemanticAreas(currentAreas);
	const areaOptions = getVaultAreaOptions(plugin, normalized);
	const selected = new Set(normalized);
	const { overlay, card } = createDialogShell(options?.title || '设置 areas', 'aiob-dialog-card-form aiob-dialog-card-wide');
	const stack = card.createDiv({ cls: 'aiob-dialog-field-stack' });
	if (options?.helpText) {
		stack.createDiv({ cls: 'aiob-dialog-help', text: options.helpText });
	}
	if (areaOptions.length) {
		const list = stack.createDiv({ cls: 'aiob-dialog-checklist' });
		for (const area of areaOptions) {
			const label = list.createEl('label', { cls: 'aiob-dialog-check-option' });
			const checkbox = label.createEl('input', { attr: { type: 'checkbox' } });
			checkbox.checked = selected.has(area);
			label.createSpan({ text: getSemanticAreaLabel(area) });
			checkbox.addEventListener('change', () => {
				if (checkbox.checked) selected.add(area);
				else selected.delete(area);
			});
		}
	} else {
		stack.createDiv({
			cls: 'aiob-dialog-help',
			text: '当前 vault 里还没有扫描到 areas 属性值，可以直接在下面自定义输入。',
		});
	}
	const customInput = stack.createEl('textarea', {
		cls: 'aiob-dialog-input aiob-dialog-textarea aiob-dialog-textarea-compact',
		attr: {
			rows: '2',
			placeholder: '补充 areas，多个用逗号分隔',
		},
	});
	customInput.value = normalized.join(', ');
	const submit = async () => {
		const base = [...selected];
		const next = normalizeSemanticAreas([...base, customInput.value]);
		await onChange(next);
		overlay.remove();
	};
	createDialogSubmitRow(card, submit, { onCancel: () => overlay.remove() });
	presentDialogShell(overlay, card, customInput);
}

function getVaultAreaOptions(plugin: AiobPlugin, currentAreas: string[]): string[] {
	const revision = plugin.getVaultPropertyRevision();
	const now = Date.now();
	const cached = VAULT_AREA_CACHE.get(plugin);
	if (
		cached
		&& (
			cached.revision === revision
			|| now - cached.scannedAt < VAULT_AREA_SCAN_COOLDOWN_MS
		)
	) {
		return mergeCurrentAreas(cached.values, currentAreas);
	}

	const values = new Set<string>();
	for (const file of plugin.app.vault.getFiles()) {
		if (file.extension !== 'md') continue;
		const frontmatterValue = plugin.app.metadataCache.getFileCache(file)?.frontmatter?.areas;
		if (frontmatterValue == null) continue;
		for (const area of normalizeSemanticAreas(frontmatterValue)) {
			values.add(area);
		}
	}

	const sorted = [...values].sort((a, b) =>
		getSemanticAreaLabel(a).localeCompare(getSemanticAreaLabel(b), 'zh-Hans-CN'),
	);
	VAULT_AREA_CACHE.set(plugin, { revision, values: sorted, scannedAt: now });
	return mergeCurrentAreas(sorted, currentAreas);
}

function mergeCurrentAreas(options: string[], currentAreas: string[]): string[] {
	return [...new Set([...options, ...normalizeSemanticAreas(currentAreas)])];
}
