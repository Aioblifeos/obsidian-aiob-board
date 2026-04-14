import { TAbstractFile, TFile, TFolder, WorkspaceLeaf, parseLinktext, parseYaml } from 'obsidian';

type ChannelPathSuggestionKind = 'root' | 'base' | 'view';

interface ChannelPathSuggestion {
	value: string;
	label: string;
	description: string;
	kind: ChannelPathSuggestionKind;
}

type ChannelPathApp = {
	vault: {
		getFiles: () => TFile[];
		getAbstractFileByPath: (path: string) => TAbstractFile | null;
		getRoot: () => TFolder;
		cachedRead: (file: TFile) => Promise<string>;
	};
	metadataCache: {
		getFirstLinkpathDest: (linktext: string, sourcePath: string) => TFile | null;
	};
	workspace: {
		getLeavesOfType: (viewType: string) => WorkspaceLeaf[];
		getLeftLeaf: (split: boolean) => WorkspaceLeaf | null;
		revealLeaf: (leaf: WorkspaceLeaf) => void;
		getLeaf: (newLeaf?: boolean) => WorkspaceLeaf;
		openLinkText: (linktext: string, sourcePath: string, newLeaf?: boolean) => Promise<void>;
	};
};

const ROOT_PATH = '/';
const ROOT_ALIASES = ['/', 'root', 'vault', '根目录', '仓库', '仓库根目录'];
const BASE_VIEW_CACHE = new Map<string, { mtime: number; views: string[] }>();

function normalizeQuery(value: string): string {
	return String(value ?? '').trim().toLowerCase();
}

function normalizeVaultPath(value: string): string {
	const trimmed = String(value ?? '').trim();
	if (!trimmed || trimmed === ROOT_PATH) return trimmed;
	return trimmed.replace(/^\/+/, '');
}

function getChannelPathMatchScore(query: string, ...candidates: string[]): number {
	const normalizedQuery = normalizeQuery(query);
	if (!normalizedQuery) return 1;
	let best = Number.NEGATIVE_INFINITY;
	const compactQuery = normalizedQuery.replace(/[\s/_#.-]+/g, '');
	for (const candidate of candidates) {
		const normalizedCandidate = normalizeQuery(candidate);
		if (!normalizedCandidate) continue;
		if (normalizedCandidate === normalizedQuery) {
			best = Math.max(best, 720 - normalizedCandidate.length);
		}
		if (normalizedCandidate.startsWith(normalizedQuery)) {
			best = Math.max(best, 560 - normalizedCandidate.length);
		}
		const index = normalizedCandidate.indexOf(normalizedQuery);
		if (index >= 0) {
			best = Math.max(best, 420 - index);
		}
		if (compactQuery) {
			const compactCandidate = normalizedCandidate.replace(/[\s/_#.-]+/g, '');
			const compactIndex = compactCandidate.indexOf(compactQuery);
			if (compactIndex >= 0) {
				best = Math.max(best, 320 - compactIndex);
			}
		}
	}
	return best;
}

function extractBaseViewNames(raw: string): string[] {
	try {
		const parsed = parseYaml(raw);
		if (!parsed || typeof parsed !== 'object') return [];
		const views = Array.isArray((parsed as Record<string, unknown>).views)
			? (parsed as Record<string, unknown>).views as Array<Record<string, unknown>>
			: [];
		const names = views
			.map((entry) => typeof entry?.name === 'string' ? entry.name.trim() : '')
			.filter(Boolean);
		return [...new Set(names)];
	} catch (error) {
		console.error('Aiob: Failed to parse base view suggestions', error);
		return [];
	}
}

async function getBaseViewNames(app: ChannelPathApp, file: TFile): Promise<string[]> {
	const cached = BASE_VIEW_CACHE.get(file.path);
	if (cached && cached.mtime === file.stat.mtime) return cached.views;
	try {
		const raw = await app.vault.cachedRead(file);
		const views = extractBaseViewNames(raw);
		BASE_VIEW_CACHE.set(file.path, { mtime: file.stat.mtime, views });
		return views;
	} catch (error) {
		console.error('Aiob: Failed to read base view suggestions', error);
		BASE_VIEW_CACHE.set(file.path, { mtime: file.stat.mtime, views: [] });
		return [];
	}
}

function getChannelPathParts(rawPath: string): { path: string; subpath: string } {
	const trimmed = String(rawPath ?? '').trim();
	if (!trimmed || trimmed === ROOT_PATH) return { path: trimmed, subpath: '' };
	const parsed = parseLinktext(trimmed);
	return {
		path: normalizeVaultPath(parsed.path || trimmed.split('#')[0] || ''),
		subpath: parsed.subpath || '',
	};
}

function resolveChannelPathTarget(app: ChannelPathApp, rawPath: string): TAbstractFile | null {
	const { path } = getChannelPathParts(rawPath);
	if (!path) return null;
	if (path === ROOT_PATH) return app.vault.getRoot();
	return app.metadataCache.getFirstLinkpathDest(path, '') ?? app.vault.getAbstractFileByPath(path);
}

async function getOrCreateFileExplorerLeaf(app: ChannelPathApp): Promise<WorkspaceLeaf | null> {
	let leaf: WorkspaceLeaf | null = app.workspace.getLeavesOfType('file-explorer')[0] || null;
	if (leaf) return leaf;
	leaf = app.workspace.getLeftLeaf(true);
	if (!leaf) return null;
	await leaf.setViewState({ type: 'file-explorer', active: true } as any);
	return leaf;
}

async function revealInFileExplorer(app: ChannelPathApp, target: TAbstractFile): Promise<boolean> {
	const leaf = await getOrCreateFileExplorerLeaf(app);
	if (!leaf) return false;
	app.workspace.revealLeaf(leaf);
	const explorerView = (leaf as WorkspaceLeaf & {
		view?: { revealInFolder?: (file: TAbstractFile) => Promise<void> | void };
	}).view;
	if (typeof explorerView?.revealInFolder === 'function') {
		await explorerView.revealInFolder(target);
	}
	return true;
}

export async function openChannelPath(app: ChannelPathApp, rawPath: string): Promise<boolean> {
	const trimmed = String(rawPath ?? '').trim();
	if (!trimmed) return false;
	const target = resolveChannelPathTarget(app, trimmed);
	if (!target) return false;
	if (target instanceof TFolder) {
		return revealInFileExplorer(app, target);
	}
	if (!(target instanceof TFile)) return false;
	const { subpath } = getChannelPathParts(trimmed);
	if (subpath) {
		await app.workspace.openLinkText(`${target.path}${subpath}`, target.path, true);
		return true;
	}
	await app.workspace.getLeaf(true).openFile(target);
	return true;
}

export async function getChannelPathSuggestions(
	app: ChannelPathApp,
	query: string,
	limit = 10,
): Promise<ChannelPathSuggestion[]> {
	const normalizedQuery = normalizeQuery(query);
	const suggestions: Array<ChannelPathSuggestion & { score: number }> = [];

	const rootScore = normalizedQuery
		? getChannelPathMatchScore(normalizedQuery, ROOT_PATH, ...ROOT_ALIASES)
		: 1200;
	if (rootScore > Number.NEGATIVE_INFINITY) {
		suggestions.push({
			value: ROOT_PATH,
			label: ROOT_PATH,
			description: '仓库根目录',
			kind: 'root',
			score: rootScore + 280,
		});
	}

	const baseFiles = app.vault.getFiles()
		.filter((file) => file.extension.toLowerCase() === 'base');

	for (const file of baseFiles) {
		const score = normalizedQuery
			? getChannelPathMatchScore(normalizedQuery, file.path, file.name, file.basename)
			: 200;
		if (score <= Number.NEGATIVE_INFINITY) continue;
		suggestions.push({
			value: file.path,
			label: file.path,
			description: 'Base 数据库',
			kind: 'base',
			score: score + 140,
		});
	}

	if (normalizedQuery) {
		const viewEntries = await Promise.all(baseFiles.map(async (file) => ({
			file,
			views: await getBaseViewNames(app, file),
		})));
		for (const { file, views } of viewEntries) {
			for (const viewName of views) {
				const value = `${file.path}#${viewName}`;
				const score = getChannelPathMatchScore(
					normalizedQuery,
					value,
					viewName,
					`${file.name}#${viewName}`,
					`${file.basename}#${viewName}`,
				);
				if (score <= Number.NEGATIVE_INFINITY) continue;
				suggestions.push({
					value,
					label: value,
					description: `Base 视图 · ${file.name}`,
					kind: 'view',
					score: score + 120,
				});
			}
		}
	}

	const deduped = new Map<string, ChannelPathSuggestion & { score: number }>();
	for (const suggestion of suggestions) {
		const current = deduped.get(suggestion.value);
		if (!current || suggestion.score > current.score) {
			deduped.set(suggestion.value, suggestion);
		}
	}

	return [...deduped.values()]
		.sort((a, b) => b.score - a.score || a.value.localeCompare(b.value, 'zh-Hans-CN'))
		.slice(0, limit)
		.map(({ score, ...rest }) => rest);
}
