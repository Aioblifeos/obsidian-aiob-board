import { describe, it, expect } from 'vitest';
import { runMigrations, CURRENT_SCHEMA_VERSION } from '../src/migrations';
import type { RawSavedData } from '../src/migrations';

describe('runMigrations', () => {
	it('should return schema version equal to CURRENT_SCHEMA_VERSION', () => {
		const result = runMigrations(null);
		expect(result.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
	});

	it('should handle null data gracefully', () => {
		const result = runMigrations(null);
		expect(result.config).toBeDefined();
		expect(result.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
	});

	it('should not re-run migrations on already-migrated data', () => {
		const data: RawSavedData = {
			schemaVersion: CURRENT_SCHEMA_VERSION,
			config: { channels: [] },
			log: [],
		};
		const result = runMigrations(data);
		expect(result.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
	});
});

describe('v0 → v1 migration', () => {
	function migrateFromV0(config: Record<string, any>, log: any[] = []) {
		return runMigrations({ schemaVersion: 0, config, log });
	}

	it('should rename checkInGroups to trackerGroups', () => {
		const result = migrateFromV0({
			checkInGroups: [{ id: 'sleep', name: '作息' }],
			checkInItems: [{ id: 'test', mode: 'boolean' }],
		});
		expect(result.config!.trackerGroups).toBeDefined();
		expect(result.config!.trackerGroups[0].id).toBe('sleep');
		expect(result.config!.checkInGroups).toBeUndefined();
		expect(result.config!.checkInItems).toBeUndefined();
	});

	it('should migrate checkin log entries to tracker type', () => {
		const result = migrateFromV0({}, [
			{ type: 'checkin', ts: '2026-01-01T10:00:00', itemId: 'x', value: true },
			{ type: 'memo', ts: '2026-01-01T11:00:00', content: 'hello' },
		]);
		expect(result.log!.length).toBe(2);
		expect(result.log![0].type).toBe('tracker');
		expect(result.log![1].type).toBe('memo');
	});

	it('should filter out deprecated log types: habit, routine, sleep', () => {
		const result = migrateFromV0({}, [
			{ type: 'habit', ts: '2026-01-01T10:00:00' },
			{ type: 'routine', ts: '2026-01-01T10:00:00' },
			{ type: 'sleep', ts: '2026-01-01T10:00:00' },
			{ type: 'memo', ts: '2026-01-01T11:00:00', content: 'keep' },
		]);
		expect(result.log!.length).toBe(1);
		expect(result.log![0].type).toBe('memo');
	});

	it('should delete deprecated habits and routines from config', () => {
		const result = migrateFromV0({
			habits: [{ id: 'walk' }],
			routines: [{ id: 'morning' }],
		});
		expect(result.config!.habits).toBeUndefined();
		expect(result.config!.routines).toBeUndefined();
	});

	it('should ensure daily-data and ungrouped tracker groups exist', () => {
		const result = migrateFromV0({
			trackerGroups: [{ id: 'sleep', name: '作息' }],
			trackerItems: [{ id: 'test', mode: 'boolean', sourceKind: 'custom' }],
		});
		const groupIds = result.config!.trackerGroups.map((g: any) => g.id);
		expect(groupIds).toContain('daily-data');
		expect(groupIds).toContain('ungrouped');
	});

	it('should normalize tracker item sourceKind to custom', () => {
		const result = migrateFromV0({
			trackerItems: [{ id: 'test', mode: 'boolean', sourceKind: undefined }],
		});
		expect(result.config!.trackerItems[0].sourceKind).toBe('custom');
		expect(result.config!.trackerItems[0].sourceId).toBe('test');
	});

	it('should fix sleep item modes', () => {
		const result = migrateFromV0({
			trackerItems: [
				{ id: 'sleep-wake', mode: 'counter' },
				{ id: 'sleep-nap', mode: 'boolean' },
				{ id: 'sleep-sleep', mode: 'boolean' },
			],
		});
		const items = result.config!.trackerItems;
		expect(items.find((i: any) => i.id === 'sleep-wake').mode).toBe('boolean');
		expect(items.find((i: any) => i.id === 'sleep-nap').mode).toBe('timer');
		expect(items.find((i: any) => i.id === 'sleep-sleep').mode).toBe('timer');
	});

	it('should ensure dailyNote sections is an array after migration', () => {
		const result = migrateFromV0({
			dailyNote: { sections: ['todo'] },
		});
		const sections = result.config!.dailyNote.sections;
		expect(Array.isArray(sections)).toBe(true);
	});

	it('should fix legacy template path', () => {
		const result = migrateFromV0({
			dailyNote: { templatePath: 'Archive/Templates/日记模板1.md' },
		});
		expect(result.config!.dailyNote.templatePath).toBe('Archive/Templates/日记模板.md');
	});

	it('should ensure today overviewOrder contains all defaults', () => {
		const result = migrateFromV0({
			today: { overviewOrder: ['todo'] },
		});
		const order = result.config!.today.overviewOrder;
		expect(order).toContain('todo');
		expect(order).toContain('notes');
	});

	it('should ensure today focus labels include the on-this-day label', () => {
		const result = migrateFromV0({
			today: {
				focusLabels: {
					expectation: '今日期待：',
					primary: '今日重点：',
					journal: '今日日记：',
				},
			},
		});
		expect(result.config!.today.focusLabels.history).toBe('往年今日：');
	});

	it('should ensure today focus row visibility defaults exist', () => {
		const result = migrateFromV0({
			today: {
				focusRowVisibility: {
					expectation: false,
				},
			},
		});
		expect(result.config!.today.focusRowVisibility).toEqual({
			expectation: false,
			primary: true,
			journal: true,
			history: true,
		});
	});

	it('should ensure board today height defaults exist', () => {
		const result = migrateFromV0({
			today: {
				boardTodayHeight: 540,
			},
		});
		expect(result.config!.today.boardTodayHeight).toBe(540);
	});

	it('should remove deprecated record type folders and keep note types at root', () => {
		const result = migrateFromV0({
			recordTypes: [{
				id: 'posts',
				name: 'Posts',
				icon: '📝',
				mode: 'note',
				folder: 'Posts',
				filenameTemplate: '{title}',
				fields: [{ key: 'title', label: '名称', type: 'text', required: true }],
			}],
		});
		expect(result.config!.recordTypes[0].folder).toBeUndefined();
	});

	it('should ensure unified section title visibility is present and legacy fields are dropped', () => {
		const result = migrateFromV0({});
		const stv = result.config!.sectionTitleVisibility;
		expect(stv).toBeDefined();
		// Unified defaults (v14→ seed): four record modules hidden, channels visible.
		expect(stv.focus).toBe(false);
		expect(stv.tracker).toBe(false);
		expect(stv.memo).toBe(false);
		expect(stv.quickTools).toBe(false);
		expect(stv.channels).toBe(true);
		// v23 drops legacy fields entirely.
		expect(result.config!.recordSectionTitleVisibility).toBeUndefined();
		expect(result.config!.boardWidgetTitleVisibility).toBeUndefined();
	});

	it('should flatten legacy widget orders into the unified layout sections list', () => {
		const result = migrateFromV0({
			recordWidgetOrder: ['memo'],
			boardWidgetOrder: ['today'],
		});
		// After v14, the ordered widgets were merged into a single home list
		// (with sidebar-only items — memo — filtered out), then v22 flattened
		// all surfaces into a single `sections` array.
		const ids = result.config!.layout.sections.map((e: { id: string }) => e.id);
		// `today` expanded to todo + notes, followed by progress + channels from defaults.
		expect(ids).toContain('todo');
		expect(ids).toContain('notes');
		expect(ids).toContain('progress');
		// Legacy widget order fields are pruned at v23.
		expect(result.config!.recordWidgetOrder).toBeUndefined();
		expect(result.config!.boardWidgetOrder).toBeUndefined();
	});

	it('should propagate legacy widget / title visibility overrides into the unified maps', () => {
		const result = migrateFromV0({
			recordWidgetVisibility: { memo: false },
			boardWidgetVisibility: { today: false },
			boardWidgetTitleVisibility: { channels: false },
		});
		// memo hidden by the legacy record visibility override.
		expect(result.config!.sectionVisibility.memo).toBe(false);
		// `today` off → v14 rewrites it to todo/notes off.
		expect(result.config!.sectionVisibility.todo).toBe(false);
		expect(result.config!.sectionVisibility.notes).toBe(false);
		// Legacy `boardWidgetTitleVisibility.channels: false` must win over the default.
		expect(result.config!.sectionTitleVisibility.channels).toBe(false);
		// Legacy maps erased after v23.
		expect(result.config!.recordWidgetVisibility).toBeUndefined();
		expect(result.config!.boardWidgetVisibility).toBeUndefined();
		expect(result.config!.boardWidgetTitleVisibility).toBeUndefined();
	});

	it('should ensure channel core IDs reference valid channels', () => {
		const result = migrateFromV0({
			channels: [{ id: 'capture', name: 'Capture', icon: '📌', path: '/' }],
			channelCoreIds: ['capture', 'nonexistent'],
		});
		expect(result.config!.channelCoreIds).toEqual(['capture']);
	});

	it('should remove deprecated field types from record types', () => {
		const result = migrateFromV0({
			recordTypes: [{
				id: 'todo', name: 'Todo', icon: '✅', mode: 'inline',
				fields: [
					{ key: 'content', label: '内容', type: 'text', required: true },
					{ key: 'time', label: 'time', type: 'time-picker', required: false },
					{ key: 'repeat', label: 'repeat', type: 'repeat-rule', required: false },
				],
			}],
		});
		const fields = result.config!.recordTypes[0].fields;
		expect(fields.length).toBe(1);
		expect(fields[0].key).toBe('content');
	});
});

describe('v1 → v2 migration', () => {
	it('should set _pendingLogExport when log has entries', () => {
		const result = runMigrations({
			schemaVersion: 1,
			config: {},
			log: [{ type: 'memo', ts: '2026-03-24T10:00:00', content: 'test', wordCount: 4 }],
		});
		expect(result._pendingLogExport).toBe(true);
		expect(result.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
	});

	it('should not set _pendingLogExport when log is empty', () => {
		const result = runMigrations({
			schemaVersion: 1,
			config: {},
			log: [],
		});
		expect(result._pendingLogExport).toBeUndefined();
	});
});
