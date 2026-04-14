import { TFile } from 'obsidian';

// ── File filtering & metadata ──

const LINKABLE_EXTENSIONS = new Set(['md', 'base']);

function getAiobLinkableFiles(app: { vault: { getFiles: () => TFile[] } }): TFile[] {
	return app.vault.getFiles().filter((file) => LINKABLE_EXTENSIONS.has(file.extension.toLowerCase()));
}

export function getAiobWikilinkTitle(file: TFile): string {
	return file.extension.toLowerCase() === 'md' ? file.basename : file.name;
}

export function getAiobWikilinkPathLabel(file: TFile): string {
	return file.extension.toLowerCase() === 'md'
		? file.path.replace(/\.md$/i, '')
		: file.path;
}

function getAiobWikilinkLinktext(
	app: { metadataCache: { fileToLinktext: (file: TFile, sourcePath: string, omitMdExtension?: boolean) => string } },
	file: TFile,
	sourcePath: string,
): string {
	return app.metadataCache.fileToLinktext(file, sourcePath, file.extension.toLowerCase() === 'md');
}

// ── Scoring ──

function getAiobWikilinkMatchScore(file: TFile, normalizedQuery: string): number {
	if (!normalizedQuery) return 1;
	const basename = file.basename.toLowerCase();
	const filename = file.name.toLowerCase();
	const pathLabel = getAiobWikilinkPathLabel(file).toLowerCase();
	const fullPath = file.path.toLowerCase();
	const exactCandidates = [basename, filename, pathLabel, fullPath];
	if (exactCandidates.some((candidate) => candidate === normalizedQuery)) return 600;
	if (basename.startsWith(normalizedQuery)) return 520 - basename.length;
	if (filename.startsWith(normalizedQuery)) return 500 - filename.length;
	if (basename.includes(normalizedQuery)) return 420 - basename.indexOf(normalizedQuery);
	if (filename.includes(normalizedQuery)) return 380 - filename.indexOf(normalizedQuery);
	if (pathLabel.includes(normalizedQuery)) return 320 - pathLabel.indexOf(normalizedQuery);
	if (fullPath.includes(normalizedQuery)) return 240 - fullPath.indexOf(normalizedQuery);
	return Number.NEGATIVE_INFINITY;
}

// ── Textarea wikilink context ──

export function getAiobWikilinkContext(textarea: HTMLTextAreaElement): { from: number; to: number; query: string } | null {
	const value = textarea.value;
	const cursor = textarea.selectionStart ?? value.length;
	const asciiOpen = value.lastIndexOf('[[', cursor);
	const fullOpen = value.lastIndexOf('【【', cursor);
	const openIndex = Math.max(asciiOpen, fullOpen);
	if (openIndex === -1) return null;
	// Treat a closing pair at the current caret position as still being "inside"
	// the wikilink so suggestions keep working while typing before the auto-inserted ]] .
	const asciiClose = value.lastIndexOf(']]', cursor - 1);
	const fullClose = value.lastIndexOf('】】', cursor - 1);
	const closeIndex = Math.max(asciiClose, fullClose);
	if (closeIndex > openIndex) return null;
	const query = value.slice(openIndex + 2, cursor);
	if (/[\]\】\n]/.test(query)) return null;
	return { from: openIndex, to: cursor, query: query.trim() };
}

// ── Mobile input normalization ──

export function normalizeWikilinkInput(textarea: HTMLTextAreaElement): void {
	const value = textarea.value;
	const cursor = textarea.selectionStart ?? value.length;

	// Only act when the user just typed [[ (cursor is right after [[)
	const lastTwo = value.slice(Math.max(0, cursor - 2), cursor);
	if (lastTwo !== '[[' && lastTwo !== '【【') return;

	// If ]] exists after cursor on the same line, we're inside an existing wikilink — skip.
	// (On mobile, selectionStart may lag behind the actual cursor, so we check broadly.)
	const after = value.slice(cursor);
	if (/^[^\n]*\]\]/.test(after)) return;

	const before = value.slice(0, cursor - 2);

	// Strip any ] or 】 right after cursor (mobile keyboard auto-closed brackets)
	let existingClose = 0;
	while (existingClose < after.length && (after[existingClose] === ']' || after[existingClose] === '】')) existingClose++;
	const afterStripped = after.slice(existingClose);
	textarea.value = `${before}[[]]${afterStripped}`;
	const caret = before.length + 2;
	textarea.setSelectionRange(caret, caret);
}

// ── Fullwidth bracket normalization ──

export function normalizeFullwidthWikilinks(value: string): string {
	return value.replace(/【【([\s\S]*?)】】/g, '[[$1]]');
}

// ── Extract wikilinks from text ──

export function extractWikilinksFromText(value: string): string[] {
	const links = new Set<string>();
	const normalized = normalizeFullwidthWikilinks(value);
	const regex = /\[\[([^\]]+)\]\]/g;
	let match: RegExpExecArray | null;
	while ((match = regex.exec(normalized)) !== null) {
		const link = match[1].trim();
		if (link) links.add(link);
	}
	return [...links];
}

// ── File preview text extraction ──

export function getAiobFilePreviewText(raw: string, extension: string): string {
	let preview: string;
	if (extension.toLowerCase() === 'base') {
		const viewNames: string[] = [];
		for (const match of raw.matchAll(/^\s{2,4}name:\s*(.+)$/gm)) {
			const name = match[1].trim();
			if (name) viewNames.push(name);
		}
		preview = viewNames.length ? viewNames.join(' · ') : '';
	} else {
		const cleaned = raw
			.replace(/^---\n[\s\S]*?\n---\n?/, '')
			.split('\n')
			.map((line) => line.trim())
			.map((line) => line.replace(/^[-#>*\s`]+/, '').trim())
			.find(Boolean) || '';
		preview = cleaned.replace(/\[\[([^\]]+)\]\]/g, '$1').replace(/\s+/g, ' ');
	}
	return preview.slice(0, 72);
}

// ── Wikilink suggestions ──

export type AiobWikilinkSuggestion = {
	file: TFile;
	linktext: string;
	pathLabel: string;
	preview: string;
};

type WikilinkSuggestionApp = {
	vault: { getFiles: () => TFile[] };
	metadataCache: { fileToLinktext: (file: TFile, sourcePath: string, omitMdExtension?: boolean) => string };
};

// ── Lightweight wikilink binding for inline textareas ──

type BindWikilinkApp = {
	vault: {
		getFiles: () => TFile[];
		cachedRead: (file: TFile) => Promise<string>;
	};
	metadataCache: { fileToLinktext: (file: TFile, sourcePath: string, omitMdExtension?: boolean) => string };
	workspace: { getActiveFile: () => TFile | null };
};

const inlinePreviewCache = new Map<string, string>();

async function getInlinePreview(app: BindWikilinkApp, file: TFile): Promise<string> {
	const cached = inlinePreviewCache.get(file.path);
	if (cached !== undefined) return cached;
	try {
		const raw = await app.vault.cachedRead(file);
		const preview = getAiobFilePreviewText(raw, file.extension);
		inlinePreviewCache.set(file.path, preview);
		return preview;
	} catch {
		inlinePreviewCache.set(file.path, '');
		return '';
	}
}

/**
 * Bind wikilink suggest + mobile input normalization to any textarea.
 * Lightweight alternative to `enhanceDialogTextareas` for inline contexts
 * (e.g. feedback note inputs). Returns a cleanup function.
 */
export function bindWikilinkSupport(
	textarea: HTMLTextAreaElement,
	app: BindWikilinkApp,
): () => void {
	const sourcePath = app.workspace.getActiveFile()?.path ?? '';
	const suggest = document.createElement('div');
	suggest.className = 'aiob-memo-link-suggest';
	textarea.parentElement?.insertBefore(suggest, textarea.nextSibling);

	let suggestions: AiobWikilinkSuggestion[] = [];
	let selectedIndex = 0;
	let requestId = 0;

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
		const replaceTo = textarea.value.slice(context.to).startsWith(']]') ? context.to + 2 : context.to;
		textarea.setRangeText(replacement, context.from, replaceTo, 'end');
		const caret = context.from + replacement.length;
		textarea.focus();
		textarea.setSelectionRange(caret, caret);
		closeSuggest();
	};

	const renderSuggest = () => {
		suggest.empty();
		if (!suggestions.length) {
			suggest.removeClass('show');
			return;
		}
		suggest.addClass('show');
		suggestions.forEach((entry, index) => {
			const row = suggest.createDiv(`aiob-memo-link-option ${index === selectedIndex ? 'active' : ''}`);
			const head = row.createDiv('aiob-memo-link-option-head');
			head.createDiv({ cls: 'aiob-memo-link-option-title', text: getAiobWikilinkTitle(entry.file) });
			head.createDiv({ cls: 'aiob-memo-link-option-path', text: entry.pathLabel });
			if (entry.preview) row.createDiv({ cls: 'aiob-memo-link-option-preview', text: entry.preview });
			row.addEventListener('mouseenter', () => { selectedIndex = index; renderSuggest(); });
			row.addEventListener('pointerdown', (ev) => { ev.preventDefault(); chooseSuggestion(entry); });
		});
	};

	const updateSuggest = async () => {
		const context = getAiobWikilinkContext(textarea);
		if (!context) { closeSuggest(); return; }
		const id = ++requestId;
		const next = await getAiobWikilinkSuggestions(context.query, sourcePath, app, (file) => getInlinePreview(app, file));
		if (id !== requestId || !textarea.isConnected) return;
		suggestions = next;
		selectedIndex = 0;
		renderSuggest();
	};

	const onKeydown = (e: KeyboardEvent) => {
		if (suggestions.length) {
			if (e.key === 'ArrowDown') { e.preventDefault(); selectedIndex = (selectedIndex + 1) % suggestions.length; renderSuggest(); return; }
			if (e.key === 'ArrowUp') { e.preventDefault(); selectedIndex = (selectedIndex - 1 + suggestions.length) % suggestions.length; renderSuggest(); return; }
			if ((e.key === 'Enter' && !e.shiftKey) || e.key === 'Tab') { e.preventDefault(); chooseSuggestion(suggestions[selectedIndex] || null); return; }
			if (e.key === 'Escape') { e.preventDefault(); closeSuggest(); return; }
		}
	};

	const onInput = () => {
		normalizeWikilinkInput(textarea);
		void updateSuggest();
	};

	const onClick = () => { void updateSuggest(); };

	const onKeyup = (e: KeyboardEvent) => {
		if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) void updateSuggest();
	};

	const onBlur = () => {
		window.setTimeout(() => { if (document.activeElement !== textarea) closeSuggest(); }, 120);
	};

	textarea.addEventListener('keydown', onKeydown);
	textarea.addEventListener('input', onInput);
	textarea.addEventListener('click', onClick);
	textarea.addEventListener('keyup', onKeyup);
	textarea.addEventListener('blur', onBlur);

	return () => {
		textarea.removeEventListener('keydown', onKeydown);
		textarea.removeEventListener('input', onInput);
		textarea.removeEventListener('click', onClick);
		textarea.removeEventListener('keyup', onKeyup);
		textarea.removeEventListener('blur', onBlur);
		suggest.remove();
	};
}

// ── Wikilink suggestions (shared core) ──

export async function getAiobWikilinkSuggestions(
	query: string,
	sourcePath: string,
	app: WikilinkSuggestionApp,
	getPreview: (file: TFile) => Promise<string>,
): Promise<AiobWikilinkSuggestion[]> {
	const normalizedQuery = query.trim().toLowerCase();
	const ranked = getAiobLinkableFiles(app)
		.map((file) => ({ file, score: getAiobWikilinkMatchScore(file, normalizedQuery) }))
		.filter((entry) => entry.score > Number.NEGATIVE_INFINITY)
		.sort((a, b) => b.score - a.score || b.file.stat.mtime - a.file.stat.mtime || a.file.path.localeCompare(b.file.path, 'zh-Hans-CN'))
		.slice(0, 8);
	return Promise.all(ranked.map(async ({ file }) => ({
		file,
		linktext: getAiobWikilinkLinktext(app, file, sourcePath),
		pathLabel: getAiobWikilinkPathLabel(file),
		preview: await getPreview(file),
	})));
}
