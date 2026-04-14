import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TFile } from 'obsidian';
import { DailyNoteService } from '../src/services/DailyNoteService';

function makeFile(path: string): TFile {
	const file = new TFile();
	file.path = path;
	file.name = path.split('/').pop() || path;
	file.basename = file.name.replace(/\.md$/i, '');
	file.extension = 'md';
	file.stat = {
		ctime: new Date('2026-03-29T08:00:00').getTime(),
		mtime: new Date('2026-03-29T08:00:00').getTime(),
		size: 0,
	};
	return file;
}

describe('DailyNoteService', () => {
	afterEach(() => {
		vi.useRealTimers();
	});

	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2026-03-29T10:00:00'));
	});

	it('returns previous-year daily notes for the same month and day in descending order', () => {
		const files = [
			makeFile('Journals/2026-03-29_星期日.md'),
			makeFile('Journals/2025-03-29_星期六.md'),
			makeFile('Journals/2024-03-29_星期五.md'),
			makeFile('Journals/2024-03-30_星期六.md'),
			makeFile('Journals/2023-03-29.md'),
			makeFile('Archive/2022-03-29.md'),
		];
		const metadataByPath: Record<string, any> = {
			'Journals/2026-03-29_星期日.md': { frontmatter: { date: '2026-03-29' } },
			'Journals/2025-03-29_星期六.md': { frontmatter: { date: '2025-03-29T08:30:00' } },
			'Journals/2024-03-29_星期五.md': { frontmatter: { date: '2024-03-29' } },
			'Journals/2024-03-30_星期六.md': { frontmatter: { date: '2024-03-30' } },
		};
		const plugin = {
			app: {
				vault: {
					getMarkdownFiles: vi.fn(() => files),
					getAbstractFileByPath: vi.fn(() => null),
				},
				metadataCache: {
					getFileCache: vi.fn((file: TFile) => metadataByPath[file.path] || {}),
				},
			},
			data: {
				config: {
					dailyNote: {
						folder: 'Journals',
						filenameTemplate: 'YYYY-MM-DD_星期几',
						autoGenerate: true,
						sections: [],
					},
					today: {
						focusExpectationByDate: {},
					},
					trackerItems: [],
				},
			},
		};

		const service = new DailyNoteService(plugin as any);
		const result = service.getOnThisDayDailyNotes();

		expect(result.map((entry) => entry.file.path)).toEqual([
			'Journals/2025-03-29_星期六.md',
			'Journals/2024-03-29_星期五.md',
			'Journals/2023-03-29.md',
			'Archive/2022-03-29.md',
		]);
	});

});
