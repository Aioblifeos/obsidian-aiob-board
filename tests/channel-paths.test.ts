import { describe, expect, it, vi } from 'vitest';
import { TFile, TFolder, WorkspaceLeaf } from 'obsidian';
import { getChannelPathSuggestions, openChannelPath } from '../src/utils/channelPaths';

function createBaseFile(path: string, mtime = 1): TFile {
	const file = new TFile();
	const segments = path.split('/');
	const name = segments[segments.length - 1] || path;
	file.path = path;
	file.name = name;
	file.basename = name.replace(/\.base$/i, '');
	file.extension = 'base';
	file.stat = { ctime: 0, mtime, size: 0 };
	return file;
}

describe('channelPaths', () => {
	it('suggests root, base files, and matching base views', async () => {
		const baseFile = createBaseFile('Routine & Tasks.base');
		const app = {
			vault: {
				getFiles: () => [baseFile],
				getAbstractFileByPath: vi.fn().mockReturnValue(null),
				getRoot: () => new TFolder(),
				cachedRead: vi.fn().mockResolvedValue(`views:
  - name: Posts
  - name: Inbox
`),
			},
			metadataCache: {
				getFirstLinkpathDest: vi.fn().mockReturnValue(null),
			},
			workspace: {
				getLeavesOfType: vi.fn().mockReturnValue([]),
				getLeftLeaf: vi.fn().mockReturnValue(null),
				revealLeaf: vi.fn(),
				getLeaf: vi.fn(),
				openLinkText: vi.fn(),
			},
		};

		const rootSuggestions = await getChannelPathSuggestions(app as any, '');
		expect(rootSuggestions[0]?.value).toBe('/');

		const viewSuggestions = await getChannelPathSuggestions(app as any, 'posts');
		expect(viewSuggestions.map((entry) => entry.value)).toContain('Routine & Tasks.base#Posts');
	});

	it('can return all base suggestions when the caller requests a large limit', async () => {
		const baseFiles = Array.from({ length: 12 }, (_, index) => createBaseFile(`Base-${index + 1}.base`, index + 1));
		const app = {
			vault: {
				getFiles: () => baseFiles,
				getAbstractFileByPath: vi.fn().mockReturnValue(null),
				getRoot: () => new TFolder(),
				cachedRead: vi.fn().mockResolvedValue('views: []'),
			},
			metadataCache: {
				getFirstLinkpathDest: vi.fn().mockReturnValue(null),
			},
			workspace: {
				getLeavesOfType: vi.fn().mockReturnValue([]),
				getLeftLeaf: vi.fn().mockReturnValue(null),
				revealLeaf: vi.fn(),
				getLeaf: vi.fn(),
				openLinkText: vi.fn(),
			},
		};

		const suggestions = await getChannelPathSuggestions(app as any, '', 9999);

		expect(suggestions).toHaveLength(13);
		expect(suggestions[0]?.value).toBe('/');
		expect(suggestions.filter((entry) => entry.kind === 'base')).toHaveLength(12);
	});

	it('opens root path in the file explorer', async () => {
		const root = new TFolder();
		root.path = '';
		const leaf = new WorkspaceLeaf();
		const revealInFolder = vi.fn();
		leaf.view = { revealInFolder };
		const revealLeaf = vi.fn();
		const app = {
			vault: {
				getFiles: () => [],
				getAbstractFileByPath: vi.fn().mockReturnValue(null),
				getRoot: () => root,
				cachedRead: vi.fn(),
			},
			metadataCache: {
				getFirstLinkpathDest: vi.fn().mockReturnValue(null),
			},
			workspace: {
				getLeavesOfType: vi.fn().mockReturnValue([leaf]),
				getLeftLeaf: vi.fn().mockReturnValue(null),
				revealLeaf,
				getLeaf: vi.fn(),
				openLinkText: vi.fn(),
			},
		};

		await expect(openChannelPath(app as any, '/')).resolves.toBe(true);
		expect(revealLeaf).toHaveBeenCalledWith(leaf);
		expect(revealInFolder).toHaveBeenCalledWith(root);
	});
});
