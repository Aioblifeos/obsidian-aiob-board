import { type App, type Component, MarkdownRenderer, TFile, parseLinktext } from 'obsidian';

const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'heic', 'avif']);
const VIDEO_EXTENSIONS = new Set(['mp4', 'mov', 'webm', 'm4v']);
const AUDIO_EXTENSIONS = new Set(['mp3', 'm4a', 'wav', 'ogg', 'flac']);

type RenderMarkdownResult = {
	hasEmbeds: boolean;
};

function escapeHtmlAttribute(value: string): string {
	return value
		.replace(/&/g, '&amp;')
		.replace(/"/g, '&quot;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;');
}

function resolveEmbedFile(app: App, rawLinktext: string, sourcePath: string): TFile | null {
	const rawTarget = rawLinktext.split('|')[0]?.trim() || '';
	if (!rawTarget) return null;
	const parsed = parseLinktext(rawTarget);
	const lookup = parsed.path || rawTarget;
	const file = app.metadataCache.getFirstLinkpathDest(lookup, sourcePath);
	return file instanceof TFile ? file : null;
}

function getEmbedHtml(app: App, file: TFile): string | null {
	const ext = file.extension.toLowerCase();
	const resourcePath = escapeHtmlAttribute(app.vault.getResourcePath(file));
	const alt = escapeHtmlAttribute(file.name);
	if (IMAGE_EXTENSIONS.has(ext)) {
		return `<img class="aiob-rendered-embed aiob-rendered-embed-image" src="${resourcePath}" alt="${alt}">`;
	}
	if (VIDEO_EXTENSIONS.has(ext)) {
		return `<video class="aiob-rendered-embed aiob-rendered-embed-video" controls src="${resourcePath}"></video>`;
	}
	if (AUDIO_EXTENSIONS.has(ext)) {
		return `<audio class="aiob-rendered-embed aiob-rendered-embed-audio" controls src="${resourcePath}"></audio>`;
	}
	return null;
}

function replaceEmbedsForRender(app: App, markdown: string, sourcePath: string): { markdown: string; hasEmbeds: boolean } {
	let hasEmbeds = false;
	const nextMarkdown = markdown.replace(/!\[\[([^\]]+)\]\]/g, (match, rawLinktext: string) => {
		const file = resolveEmbedFile(app, rawLinktext, sourcePath);
		if (!file || file.extension.toLowerCase() === 'md') return match;
		const embedHtml = getEmbedHtml(app, file);
		if (!embedHtml) return match;
		hasEmbeds = true;
		return `\n${embedHtml}\n`;
	});
	return { markdown: nextMarkdown, hasEmbeds };
}

export async function renderAiobMarkdown(
	app: App,
	markdown: string,
	el: HTMLElement,
	sourcePath: string,
	component: Component,
): Promise<RenderMarkdownResult> {
	const prepared = replaceEmbedsForRender(app, markdown, sourcePath);
	el.empty();
	await MarkdownRenderer.render(app, prepared.markdown, el, sourcePath, component);
	el.toggleClass('has-rich-embed', prepared.hasEmbeds);
	return { hasEmbeds: prepared.hasEmbeds };
}
