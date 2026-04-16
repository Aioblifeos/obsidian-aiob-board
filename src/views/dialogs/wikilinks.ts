import { TFile } from 'obsidian';
import { renderIcon } from '../icon';
import {
	type AiobWikilinkSuggestion,
	extractWikilinksFromText,
	getAiobFilePreviewText,
	getAiobWikilinkContext,
	getAiobWikilinkPathLabel,
	getAiobWikilinkSuggestions,
	getAiobWikilinkTitle,
	normalizeFullwidthWikilinks,
} from '../../utils/wikilinks';

export { normalizeFullwidthWikilinks as normalizeDialogWikilinks };

const dialogWikilinkPreviewCache = new Map<string, string>();

type DialogApp = {
	vault: {
		getFiles: () => TFile[];
		getMarkdownFiles: () => TFile[];
		cachedRead: (file: TFile) => Promise<string>;
	};
	metadataCache: {
		fileToLinktext: (file: TFile, sourcePath: string, omitMdExtension?: boolean) => string;
		getFirstLinkpathDest: (linktext: string, sourcePath: string) => TFile | null;
	};
	workspace: {
		getActiveFile: () => TFile | null;
		openLinkText: (linktext: string, sourcePath: string) => Promise<void>;
	};
};

function getDialogApp(): DialogApp | null {
	return ((window as unknown as { app?: unknown }).app as DialogApp) || null;
}

function getDialogSourcePath(): string {
	return getDialogApp()?.workspace.getActiveFile()?.path ?? '';
}

function insertDialogTextareaNewline(textarea: HTMLTextAreaElement): void {
	const start = textarea.selectionStart ?? textarea.value.length;
	const end = textarea.selectionEnd ?? textarea.value.length;
	textarea.setRangeText('\n', start, end, 'end');
	const caret = start + 1;
	textarea.focus();
	textarea.setSelectionRange(caret, caret);
}

async function getDialogWikilinkPreview(file: TFile): Promise<string> {
	const cached = dialogWikilinkPreviewCache.get(file.path);
	if (cached !== undefined) return cached;
	try {
		const raw = (await getDialogApp()?.vault.cachedRead(file)) || '';
		const preview = getAiobFilePreviewText(raw, file.extension);
		dialogWikilinkPreviewCache.set(file.path, preview);
		return preview;
	} catch (error) {
		console.error('Aiob: Failed to load dialog wikilink preview', error);
		dialogWikilinkPreviewCache.set(file.path, '');
		return '';
	}
}

async function getDialogSuggestions(query: string, sourcePath: string): Promise<AiobWikilinkSuggestion[]> {
	const app = getDialogApp();
	if (!app) return [];
	return getAiobWikilinkSuggestions(query, sourcePath, app, getDialogWikilinkPreview);
}

export function enhanceDialogTextareas(
	overlay: HTMLElement,
	scope: HTMLElement,
	onSubmit: () => void,
	sourcePath = getDialogSourcePath(),
	options?: {
		leftText?: string;
		extraActions?: Array<{ icon: string; title: string; onClick: () => void }>;
	},
): void {
	const app = getDialogApp();
	scope.querySelectorAll('textarea.aiob-dialog-textarea').forEach((textarea) => {
		if (!(textarea instanceof HTMLTextAreaElement)) return;
		if (textarea.dataset.lifeosDialogEnhanced === '1') return;
		textarea.dataset.lifeosDialogEnhanced = '1';
		const autosize = () => {
			textarea.setCssProps({ 'height': 'auto' });
			textarea.setCssProps({ 'height': `${textarea.scrollHeight}px` });
		};
		if (textarea.hasClass('aiob-dialog-textarea-compact')) {
			textarea.addEventListener('keydown', (ke) => {
				if (ke.isComposing) return;
				if (ke.key === 'Enter' && ke.shiftKey) {
					ke.preventDefault();
					insertDialogTextareaNewline(textarea);
					autosize();
					return;
				}
				if (ke.key === 'Escape') {
					ke.preventDefault();
					overlay.remove();
					return;
				}
				if (ke.key === 'Enter') {
					ke.preventDefault();
					onSubmit();
				}
			});
			textarea.addEventListener('input', autosize);
			autosize();
			return;
		}
		const parent = textarea.parentElement;
		if (!parent) return;
		const shell = document.createElement('div');
		shell.className = 'aiob-dialog-compose';
		parent.insertBefore(shell, textarea);
		shell.appendChild(textarea);
		textarea.addClass('has-compose-shell');

		const suggest = shell.createDiv({ cls: 'aiob-dialog-link-suggest' });
		const preview = shell.createDiv({ cls: 'aiob-dialog-link-preview' });
		const helperText = options?.leftText?.trim() || '';
		const hasToolRow = !!helperText || !!options?.extraActions?.length;
		if (hasToolRow) {
			const tools = shell.createDiv({ cls: 'aiob-dialog-bottom' });
			const toolMeta = tools.createDiv({ cls: 'aiob-dialog-meta' });
			if (helperText) {
				toolMeta.setText(helperText);
				toolMeta.setAttribute('title', helperText);
			}
			const toolActions = tools.createDiv({ cls: 'aiob-dialog-actions' });
			for (const action of options?.extraActions || []) {
				const extraBtn = toolActions.createDiv({ cls: 'aiob-dialog-icon-btn', attr: { 'aria-label': action.title } });
				renderIcon(extraBtn, action.icon, 'md');
				extraBtn.addEventListener('click', action.onClick);
			}
		}

		let suggestions: AiobWikilinkSuggestion[] = [];
		let selectedIndex = 0;
		let suggestRequestId = 0;
		let previewRequestId = 0;

		const closeSuggest = () => {
			suggestions = [];
			selectedIndex = 0;
			suggest.empty();
			suggest.removeClass('show');
		};

		const chooseSuggestion = (entry: AiobWikilinkSuggestion | null) => {
			if (!entry) return;
			const context = getAiobWikilinkContext(textarea);
			if (!context) return;
			const replacement = `[[${entry.linktext}]]`;
			textarea.setRangeText(replacement, context.from, context.to, 'end');
			textarea.focus();
			const caret = context.from + replacement.length;
			textarea.setSelectionRange(caret, caret);
			closeSuggest();
			void renderPreview();
		};

		const renderSuggest = () => {
			suggest.empty();
			if (!suggestions.length) {
				suggest.removeClass('show');
				return;
			}
			suggest.addClass('show');
			suggestions.forEach((entry, index) => {
				const row = suggest.createDiv(`aiob-dialog-link-option ${index === selectedIndex ? 'active' : ''}`);
				const head = row.createDiv('aiob-dialog-link-option-head');
				head.createDiv({ cls: 'aiob-dialog-link-option-title', text: getAiobWikilinkTitle(entry.file) });
				head.createDiv({ cls: 'aiob-dialog-link-option-path', text: entry.pathLabel });
				if (entry.preview) row.createDiv({ cls: 'aiob-dialog-link-option-preview', text: entry.preview });
				row.addEventListener('mouseenter', () => {
					selectedIndex = index;
					renderSuggest();
				});
				row.addEventListener('mousedown', (ev) => {
					ev.preventDefault();
					chooseSuggestion(entry);
				});
			});
		};

		const updateSuggest = async () => {
			const context = getAiobWikilinkContext(textarea);
			if (!context) {
				closeSuggest();
				return;
			}
			const requestId = ++suggestRequestId;
			const next = await getDialogSuggestions(context.query, sourcePath);
			if (requestId !== suggestRequestId || !textarea.isConnected) return;
			suggestions = next;
			selectedIndex = 0;
			renderSuggest();
		};

		const renderPreview = async () => {
			const requestId = ++previewRequestId;
			const links = extractWikilinksFromText(textarea.value).slice(0, 6);
			if (!links.length || !app) {
				preview.empty();
				preview.removeClass('show');
				return;
			}
			const items = await Promise.all(links.map(async (linktext) => {
				const file = app.metadataCache.getFirstLinkpathDest(linktext, sourcePath);
				return {
					linktext,
					file,
					preview: file ? await getDialogWikilinkPreview(file) : '',
				};
			}));
			if (requestId !== previewRequestId || !textarea.isConnected) return;
			preview.empty();
			preview.addClass('show');
			items.forEach((item) => {
				const chip = preview.createDiv(`aiob-dialog-link-chip ${item.file ? '' : 'is-missing'}`.trim());
				chip.createDiv({ cls: 'aiob-dialog-link-chip-title', text: item.file ? getAiobWikilinkTitle(item.file) : item.linktext });
				if (item.file) {
					chip.createDiv({ cls: 'aiob-dialog-link-chip-path', text: getAiobWikilinkPathLabel(item.file) });
					if (item.preview) chip.createDiv({ cls: 'aiob-dialog-link-chip-preview', text: item.preview });
					chip.addEventListener('click', () => { void app.workspace.openLinkText(item.linktext, sourcePath); });
				} else {
					chip.createDiv({ cls: 'aiob-dialog-link-chip-path', text: '未找到对应笔记' });
				}
			});
		};

		textarea.addEventListener('keydown', (ke) => {
			if (ke.isComposing) return;
			if (suggestions.length) {
				if (ke.key === 'ArrowDown') {
					ke.preventDefault();
					selectedIndex = (selectedIndex + 1) % suggestions.length;
					renderSuggest();
					return;
				}
				if (ke.key === 'ArrowUp') {
					ke.preventDefault();
					selectedIndex = (selectedIndex - 1 + suggestions.length) % suggestions.length;
					renderSuggest();
					return;
				}
				if ((ke.key === 'Enter' && !ke.shiftKey) || ke.key === 'Tab') {
					ke.preventDefault();
					chooseSuggestion(suggestions[selectedIndex] || null);
					return;
				}
			}
			if (ke.key === 'Enter' && ke.shiftKey) {
				ke.preventDefault();
				insertDialogTextareaNewline(textarea);
				autosize();
				void updateSuggest();
				void renderPreview();
				return;
			}
			if (ke.key === 'Escape') {
				ke.preventDefault();
				closeSuggest();
				overlay.remove();
				return;
			}
			if (ke.key === 'Enter') {
				ke.preventDefault();
				onSubmit();
			}
		});

		textarea.addEventListener('input', () => {
			autosize();
			void updateSuggest();
			void renderPreview();
		});
		textarea.addEventListener('click', () => {
			void updateSuggest();
			void renderPreview();
		});
		textarea.addEventListener('keyup', (ke: KeyboardEvent) => {
			if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(ke.key)) {
				void updateSuggest();
				void renderPreview();
			}
		});
		textarea.addEventListener('blur', () => {
			window.setTimeout(() => {
				if (document.activeElement !== textarea) closeSuggest();
			}, 120);
		});

		autosize();
		void renderPreview();
	});
}
