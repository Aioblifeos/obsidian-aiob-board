// ============================================================
// Aiob - 版本化数据迁移
// ============================================================
//
// 每个迁移函数将 data 从版本 N 升级到 N+1。
// 加载时按 schemaVersion 依次执行缺失的迁移。
// 新增迁移只需在 MIGRATIONS 数组末尾追加函数。
//
// 注意：迁移函数直接修改 data 对象（in-place mutation）。

import { Notice } from 'obsidian';
import { DEFAULT_CONFIG, DEFAULT_SECTION_VISIBILITY, DEFAULT_SECTION_TITLE_VISIBILITY, DEFAULT_LAYOUT, DEFAULT_AREAS } from '../models/defaults';
import { SEMANTIC_ACTIONABLE_STATUS_OPTIONS, SEMANTIC_AREA_DEFS } from '../models/semantic';
import type { AreaDef } from '../models/types';
import { legacyKey } from '../utils/legacyCompat';
import { debugLog } from '../utils/logger';

const KCIG = legacyKey('cig');
const KCII = legacyKey('cii');
const KTG = legacyKey('tg');
const KTI = legacyKey('ti');
const KRT = legacyKey('rt');
const KRCT = legacyKey('rct');
const KRSTV = legacyKey('rstv');
const KBWTV = legacyKey('bwtv');
const KRWV = legacyKey('rwv');
const KBWV = legacyKey('bwv');
const KRWO = legacyKey('rwo');
const KBWO = legacyKey('bwo');
const KQT = legacyKey('qt');
const KDI = legacyKey('di');
const KDR = legacyKey('dr');
const KHH = legacyKey('hh');
const KAD = legacyKey('ad');
const KFPBD = legacyKey('fpbd');
const KQTSA = legacyKey('qtsa');
const KQTT = legacyKey('qtt');
const KQTTK = legacyKey('qttk');
const KQTTI = legacyKey('qtti');
const KQTTSB = legacyKey('qttsb');

/** 磁盘上的原始数据格式（加载时尚未迁移） */
interface RawSavedData {
	schemaVersion?: number;
	config?: Record<string, unknown>;
	log?: unknown[];
	/** v2 迁移标志：data.json 中残留的 log 需要被导入到分片文件 */
	_pendingLogExport?: boolean;
}

/** 迁移函数内部使用的 config 类型——migration 需要自由读写任意键 */
type MigrationConfig = Record<string, unknown>;

/** 迁移函数签名 */
type MigrationFn = (data: RawSavedData) => void;

// ── 迁移函数列表 ──
// 索引即为 "从该版本升级"：migrations[0] 将 v0 → v1，migrations[1] 将 v1 → v2 ...

const MIGRATIONS: MigrationFn[] = [
	// ── v0 → v1: 合并旧版重命名 + 清理废弃字段 + 基础配置保障 ──
	migrateV0ToV1,
	// ── v1 → v2: 日志分片存储 ──
	// 将 data.log 标记为待迁移（实际写入由 main.ts 处理，因为需要 vault 访问）
	migrateV1ToV2,
	// ── v2 → v3: priority 值统一为 P0/P1/P2/P3 ──
	migrateV2ToV3,
	// ── v3 → v4: Today Focus 标题配置补齐 ──
	migrateV3ToV4,
	// ── v4 → v5: Today Focus 期待值独立存储 ──
	migrateV4ToV5,
	// ── v5 → v6: Today Focus 新增“往年今日”标题配置 ──
	migrateV5ToV6,
	// ── v6 → v7: Record 页面模块标题显隐配置 ──
	migrateV6ToV7,
	// ── v7 → v8: Record / Board 页面模块排序配置 ──
	migrateV7ToV8,
	// ── v8 → v9: Record / Board 页面模块显隐配置 ──
	migrateV8ToV9,
	// ── v9 → v10: Board 页面组件标题显隐配置 ──
	migrateV9ToV10,
	// ── v10 → v11: Today Focus 行显隐配置 ──
	migrateV10ToV11,
	// ── v11 → v12: Board Today 可调高度配置 ──
	migrateV11ToV12,
	// ── v12 → v13: RecordType folder 配置退场，统一根目录 ──
	migrateV12ToV13,
	// ── v13 → v14: 统一 section 配置（合并 record/board widget configs）──
	migrateV13ToV14,
	// ── v14 → v15: Home 只保留仪表盘 section，侧栏专属 section 移出 ──
	migrateV14ToV15,
	// ── v15 → v16: Focus 移到 progress 后面、flow 前面 ──
	migrateV15ToV16,
	// ── v16 → v17: 添加 sectionLanguage 默认值 ──
	migrateV16ToV17,
	// ── v17 → v18: 注入 dayInsight section（visibility + insight 布局）──
	migrateV17ToV18,
	// ── v18 → v19: 配置驱动的 areas（seed + 旧字符串 → uuid 引用迁移）──
	migrateV18ToV19,
	// ── v19 → v20: tracker 引入 goalCount + rollupTo / rollupTags（纯增量字段）──
	migrateV19ToV20,
	// ── v20 → v21: 移除 timeline surface 里残留的空 'timeline' section ──
	migrateV20ToV21,
	// ── v21 → v22: layout 从 4 个 surface 列表扁平化为 flat sections + tabs 成员表 ──
	migrateV21ToV22,
	// ── v22 → v23: 合并 recordSectionTitleVisibility + boardWidgetTitleVisibility → 统一 sectionTitleVisibility ──
	migrateV22ToV23,
	// ── v23 → v24: 删除 channelRecentOpenedIds（随 ChannelGrid board variant 一起退场）──
	migrateV23ToV24,
	// ── v24 → v25: tracker frequencyGoalKind（counter→count，其他→days）──
	migrateV24ToV25,
	// ── v25 → v26: reorder layout — channels before memo ──
	(data: RawSavedData) => {
		const config = data.config! as MigrationConfig;
		const layout = config.layout as Record<string, unknown> | undefined;
		if (!layout?.sections || !Array.isArray(layout.sections)) return;
		const sections = layout.sections as Array<Record<string, unknown>>;
		const chIdx = sections.findIndex((s) => s.id === 'channels');
		const memoIdx = sections.findIndex((s) => s.id === 'memo');
		if (chIdx > memoIdx && memoIdx >= 0) {
			const [ch] = sections.splice(chIdx, 1);
			const newMemoIdx = sections.findIndex((s) => s.id === 'memo');
			sections.splice(newMemoIdx, 0, ch);
		}
	},
];

/**
 * 对加载的原始数据执行所有待执行的迁移，返回最终 schemaVersion。
 * 如果 data 为 null/undefined，返回空壳。
 */
export function runMigrations(data: RawSavedData | null): RawSavedData & { schemaVersion: number } {
	if (!data || (data.schemaVersion == null && !data.config)) {
		// Brand new vault — skip all migrations, use current defaults
		return { schemaVersion: MIGRATIONS.length, config: {}, log: [] };
	}
	if (!data.config) data.config = {} as MigrationConfig;
	if (!Array.isArray(data.log)) data.log = [];

	let version = typeof data.schemaVersion === 'number' ? data.schemaVersion : 0;

	while (version < MIGRATIONS.length) {
		debugLog(`Running migration v${version} → v${version + 1}`);
		try {
			MIGRATIONS[version](data);
		} catch (e) {
			console.error(`Aiob: Migration v${version} → v${version + 1} failed`, e);
			new Notice(`Aiob: 数据迁移 v${version}→v${version + 1} 失败，部分功能可能异常`);
			// 迁移失败时仍推进版本号，避免下次启动反复崩溃在同一步。
			// 最坏情况是该步迁移的字段保持旧值 / 缺省值，不影响核心读写。
		}
		version++;
	}

	data.schemaVersion = version;
	return data as RawSavedData & { schemaVersion: number };
}

/** 当前最新 schema 版本号 */
export const CURRENT_SCHEMA_VERSION = MIGRATIONS.length;

// ============================================================
// 迁移实现
// ============================================================

function migrateV0ToV1(data: RawSavedData): void {
	const config = data.config! as MigrationConfig;

	// ── 1. checkIn → tracker 重命名 ──
	if (!config[KTG] && Array.isArray(config[KCIG])) {
		config[KTG] = config[KCIG];
	}
	if (!config[KTI] && Array.isArray(config[KCII])) {
		config[KTI] = config[KCII];
	}
	delete config[KCIG];
	delete config[KCII];

	// ── 2. 日志类型迁移 ──
	if (Array.isArray(data.log)) {
		data.log = data.log
			.map((entry: unknown) => {
				const e = entry as Record<string, unknown>;
				if (e.type === 'checkin') return { ...e, type: 'tracker' };
				return e;
			})
			.filter((entry: unknown) => {
				const e = entry as Record<string, unknown>;
				return !['habit', 'routine', 'sleep'].includes(e.type as string);
			});
	}

	// ── 3. 删除废弃的 habits / routines ──
	delete config.habits;
	delete config.routines;

	// ── 4. 确保 trackerGroups / trackerItems 存在 ──
	if (!Array.isArray(config[KTG]) || (config[KTG] as unknown[]).length === 0) {
		const defaults = (DEFAULT_CONFIG as MigrationConfig)[KTG] as unknown[];
		config[KTG] = defaults.map((g) => ({ ...(g as Record<string, unknown>) }));
	}
	if (!Array.isArray(config[KTI]) || (config[KTI] as unknown[]).length === 0) {
		const defaults = (DEFAULT_CONFIG as MigrationConfig)[KTI] as unknown[];
		config[KTI] = defaults.map((i) => ({ ...(i as Record<string, unknown>) }));
	}
	// 保障必要分组
	const groups = config[KTG] as Array<Record<string, unknown>>;
	if (!groups.some((g) => g.id === 'daily-data')) {
		groups.push({ id: 'daily-data', name: 'Daily Data' });
	}
	if (!groups.some((g) => g.id === 'ungrouped')) {
		groups.push({ id: 'ungrouped', name: '未分组' });
	}
	// trackerItems 字段规范化
	const trackerItems = (Array.isArray(config[KTI]) ? config[KTI] : []) as Array<Record<string, unknown>>;
	for (const item of trackerItems) {
		if (item.sourceKind !== 'daily-data') {
			item.sourceKind = 'custom';
			item.sourceId = item.id;
			item.sourceItem = undefined;
		}
		if (item.id === 'sleep-wake') item.mode = 'boolean';
		if (item.id === 'sleep-nap') item.mode = 'timer';
		if (item.id === 'sleep-sleep') item.mode = 'timer';
		if (item.sourceKind === 'daily-data' && item.sourceId === 'weight') {
			if (item.unit === 'kg' || !item.unit) item.unit = 'g';
			if (item.placeholder === '例如 48.6' || !item.placeholder) item.placeholder = '例如 48600';
		}
	}

	// ── 5. Channel 配置 ──
	ensureChannelConfig(config);

	// ── 6. RecordType 配置 ──
	ensureRecordTypeConfig(config);

	// ── 7. Daily Note 配置 ──
	ensureDailyNoteConfig(config);

	// ── 8. Today 配置 ──
	ensureTodayConfig(config);
}

// ── 辅助：各子项配置保障 ──

function ensureChannelConfig(config: MigrationConfig): void {
	const channelIds = new Set(
		(Array.isArray(config.channels) ? (config.channels as unknown[]) : [])
			.map((entry: unknown) => String((entry as Record<string, unknown>)?.id ?? '').trim())
			.filter(Boolean),
	);
	config.channelCoreIds = Array.isArray(config.channelCoreIds)
		? [...new Set((config.channelCoreIds as unknown[]).map((id: unknown) => String(id ?? '').trim()).filter((id: string) => !!id && channelIds.has(id)))]
		: DEFAULT_CONFIG.channelCoreIds.filter((id) => channelIds.has(id));
}

function ensureRecordTypeConfig(config: MigrationConfig): void {
	const defaultRTs = (DEFAULT_CONFIG as MigrationConfig)[KRT] as Array<Record<string, unknown>>;
	if (!Array.isArray(config[KRT])) {
		config[KRT] = defaultRTs.map((type) => ({ ...type }));
		return;
	}
	for (const type of config[KRT] as Array<Record<string, unknown>>) {
		const defaultType = defaultRTs.find((entry) => entry.id === type.id);
		if (defaultType) {
			if (defaultType.mode === 'note') {
				if (!type.templatePath) type.templatePath = defaultType.templatePath;
				if (!type.filenameTemplate) type.filenameTemplate = defaultType.filenameTemplate;
				const fields = type.fields as Array<Record<string, unknown>> | undefined;
				const mainField = Array.isArray(fields)
					? fields.find((f) => ['title', 'name'].includes(f.key as string))
						|| fields.find((f) => f.required && (f.type === 'text' || f.type === 'textarea'))
						|| fields.find((f) => f.type === 'text' || f.type === 'textarea')
					: null;
				if (mainField?.key && defaultType.id !== 'capture' && defaultType.id !== 'process') {
					type.filenameTemplate = `{${mainField.key as string}}`;
				}
				if (!Array.isArray(type.fieldMap) || !(type.fieldMap as unknown[]).length) {
					const defaultFieldMap = defaultType.fieldMap as Array<Record<string, unknown>> | undefined;
					type.fieldMap = defaultFieldMap?.map((entry) => ({ ...entry }));
				}
			}
		}
		delete type.folder;
		if (!Array.isArray(type.fields)) continue;
		// 移除废弃字段
		type.fields = (type.fields as Array<Record<string, unknown>>).filter((f) => f.key !== 'time' && f.key !== 'repeat' && f.key !== 'notes' && f.type !== 'repeat-rule' && f.type !== 'time-picker' && f.type !== 'time');
		if (Array.isArray(type.fieldMap)) {
			type.fieldMap = (type.fieldMap as Array<Record<string, unknown>>).filter((entry) => !['time', 'repeat', 'notes'].includes(entry.field as string));
		}
		// 语义字段规范化
		for (const field of type.fields as Array<Record<string, unknown>>) {
			if (field.key === 'status') {
				field.type = 'multi-select';
				field.default = field.default || 'todo';
				field.source = 'vault-with-preset';
				field.presets = [...SEMANTIC_ACTIONABLE_STATUS_OPTIONS];
				delete field.options;
				continue;
			}
			if (field.key === 'areas') {
				field.type = 'multi-select';
				field.source = 'vault-with-preset';
				field.presets = SEMANTIC_AREA_DEFS.map((entry) => entry.id);
				delete field.options;
				continue;
			}
			if (field.key === 'priority') {
				field.type = 'multi-select';
				field.default = type.id === 'todo'
					? (field.default === 'P2' || !field.default ? 'none' : field.default)
					: (field.default === 'P2' || !field.default ? 'P1' : field.default);
				field.source = 'vault-with-preset';
				field.presets = ['P0', 'P1', 'P2', 'P3', 'none'];
				delete field.options;
				continue;
			}
		}
	}
}

function ensureDailyNoteConfig(config: MigrationConfig): void {
	const current = (config.dailyNote && typeof config.dailyNote === 'object' ? config.dailyNote : {}) as Record<string, unknown>;
	const defaultSections = Array.isArray(DEFAULT_CONFIG.dailyNote.sections)
		? [...DEFAULT_CONFIG.dailyNote.sections]
		: ['todo', 'notes', 'timeline', 'review'];
	const savedSections = Array.isArray(current.sections)
		? (current.sections as unknown[]).map((v: unknown) => String(v ?? '').trim()).filter(Boolean)
		: [];
	const sectionSeen = new Set<string>();
	const sections = [...savedSections, ...defaultSections]
		.filter((v) => defaultSections.includes(v) && !sectionSeen.has(v) && sectionSeen.add(v));
	config.dailyNote = {
		...DEFAULT_CONFIG.dailyNote,
		...current,
		sections,
	};
	const dailyNote = config.dailyNote as Record<string, unknown>;
	if (!dailyNote.templatePath || dailyNote.templatePath === 'Archive/Templates/日记模板1.md') {
		dailyNote.templatePath = 'Archive/Templates/日记模板.md';
	}
}

function migrateV1ToV2(data: RawSavedData): void {
	// 日志分片：data.log 中的条目需要被写入月份文件。
	// 由于迁移函数没有 vault 访问权限，这里只标记待导出。
	// main.ts 在初始化 LogStorageService 时会检查此标志并完成文件写入。
	if (Array.isArray(data.log) && data.log.length > 0) {
		data._pendingLogExport = true;
	}
	// 注意：不在这里删除 data.log，因为 main.ts 需要读取它来导入。
	// main.ts 完成导入后会删除 data.log 并清除 _pendingLogExport 标志。
}

const PRIORITY_MIGRATION_MAP: Record<string, string> = {
	P0: 'P0',
	P1: 'P1',
	P2: 'P2',
	P3: 'P3',
};

function migrateV2ToV3(data: RawSavedData): void {
	// 迁移日志条目中的 priority 值
	if (Array.isArray(data.log)) {
		for (const entry of data.log as Array<Record<string, unknown>>) {
			const p = entry.priority as string | undefined;
			if (p && PRIORITY_MIGRATION_MAP[p]) {
				entry.priority = PRIORITY_MIGRATION_MAP[p];
			}
		}
	}

	// 迁移 recordTypes 配置中的 priority default 和 presets
	const config = data.config! as MigrationConfig;
	if (Array.isArray(config[KRT])) {
		for (const type of config[KRT] as Array<Record<string, unknown>>) {
			if (!Array.isArray(type.fields)) continue;
			for (const field of type.fields as Array<Record<string, unknown>>) {
				if (field.key !== 'priority') continue;
				if (field.default && PRIORITY_MIGRATION_MAP[field.default as string]) {
					field.default = PRIORITY_MIGRATION_MAP[field.default as string];
				}
				field.presets = ['P0', 'P1', 'P2', 'P3', 'none'];
			}
		}
	}
}

function migrateV3ToV4(data: RawSavedData): void {
	const config = data.config! as MigrationConfig;
	ensureTodayConfig(config);
}

function migrateV4ToV5(data: RawSavedData): void {
	const config = data.config! as MigrationConfig;
	ensureTodayConfig(config);
}

function migrateV5ToV6(data: RawSavedData): void {
	const config = data.config! as MigrationConfig;
	ensureTodayConfig(config);
}

function migrateV6ToV7(data: RawSavedData): void {
	const config = data.config! as MigrationConfig;
	ensureRecordSectionTitleVisibility(config);
}

function migrateV7ToV8(data: RawSavedData): void {
	const config = data.config! as MigrationConfig;
	ensureWidgetOrders(config);
}

function migrateV8ToV9(data: RawSavedData): void {
	const config = data.config! as MigrationConfig;
	ensureWidgetVisibilities(config);
}

function migrateV9ToV10(data: RawSavedData): void {
	const config = data.config! as MigrationConfig;
	ensureBoardWidgetTitleVisibility(config);
}

function migrateV10ToV11(data: RawSavedData): void {
	const config = data.config! as MigrationConfig;
	ensureTodayConfig(config);
}

function migrateV11ToV12(data: RawSavedData): void {
	const config = data.config! as MigrationConfig;
	ensureTodayConfig(config);
}

function migrateV12ToV13(data: RawSavedData): void {
	const config = data.config! as MigrationConfig;
	ensureRecordTypeConfig(config);
}

function migrateV13ToV14(data: RawSavedData): void {
	const config = data.config! as MigrationConfig;

	// Build sectionVisibility from old record/board widget visibility
	const rv = (config[KRWV] || {}) as Record<string, unknown>;
	const bv = (config[KBWV] || {}) as Record<string, unknown>;
	config.sectionVisibility = {
		...DEFAULT_SECTION_VISIBILITY,
		focus: rv.focus ?? true,
		tracker: rv.tracker ?? true,
		memo: rv.memo ?? true,
		[KQT]: rv[KQT] ?? true,
		progress: bv.progress ?? true,
		channels: bv.channels ?? true,
		todo: bv.today ?? true,
		notes: bv.today ?? true,
	};

	// Build sectionTitleVisibility from old title configs
	const rtv = (config[KRSTV] || {}) as Record<string, unknown>;
	const btv = (config[KBWTV] || {}) as Record<string, unknown>;
	config.sectionTitleVisibility = {
		...DEFAULT_SECTION_TITLE_VISIBILITY,
		focus: rtv.focus ?? false,
		tracker: rtv.tracker ?? false,
		memo: rtv.memo ?? false,
		[KQT]: rtv[KQT] ?? false,
		channels: btv.channels ?? rtv.channels ?? true,
	};

	// Build layout from old widget orders
	const rOrder: string[] = Array.isArray(config[KRWO])
		? config[KRWO] as string[] : ['focus', 'tracker', 'memo', KQT];
	const bOrder: string[] = Array.isArray(config[KBWO])
		? config[KBWO] as string[] : ['progress', 'channels', 'today'];

	// Sidebar-only sections — these don't belong on the home surface
	const sidebarOnly = new Set(['tracker', 'memo', KQT, 'channels', 'sidebarStats']);

	const homeSections: string[] = [];
	for (const id of rOrder) {
		if (!sidebarOnly.has(id)) homeSections.push(id);
	}
	for (const id of bOrder) {
		if (id === 'today') { homeSections.push('todo', 'notes'); }
		else if (!sidebarOnly.has(id)) { homeSections.push(id); }
	}
	// Insert flow after progress
	const progressIdx = homeSections.indexOf('progress');
	if (progressIdx >= 0 && !homeSections.includes('flow')) {
		homeSections.splice(progressIdx + 1, 0, 'flow');
	}

	// Historical v14 shape: 4 surface lists. Later re-flattened by v22.
	config.layout = {
		home: { sections: homeSections },
		timeline: { sections: ['calendar'] },
		insight: { sections: [KDR, KHH, KAD] },
		sidebar: { sections: ['sidebarStats', KQT, 'tracker', 'memo', 'channels'] },
	} as Record<string, unknown>;
}

function ensureTodayFocusLabels(raw: unknown): Record<string, string> {
	const current = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
	const defaults = DEFAULT_CONFIG.today.focusLabels as Record<string, string>;
	return {
		expectation: typeof current.expectation === 'string' && current.expectation.trim()
			? current.expectation.trim()
			: defaults.expectation,
		primary: typeof current.primary === 'string' && current.primary.trim()
			? current.primary.trim()
			: defaults.primary,
		journal: typeof current.journal === 'string' && current.journal.trim()
			? current.journal.trim()
			: defaults.journal,
		history: typeof current.history === 'string' && current.history.trim()
			? current.history.trim()
			: defaults.history,
	};
}

function ensureTodayFocusRowVisibility(raw: unknown): Record<string, boolean> {
	const current = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
	const defaults = DEFAULT_CONFIG.today.focusRowVisibility as Record<string, boolean>;
	return {
		expectation: typeof current.expectation === 'boolean' ? current.expectation : defaults.expectation,
		primary: typeof current.primary === 'boolean' ? current.primary : defaults.primary,
		journal: typeof current.journal === 'boolean' ? current.journal : defaults.journal,
		history: typeof current.history === 'boolean' ? current.history : defaults.history,
	};
}

function ensureTodayConfig(config: MigrationConfig): void {
	const current = (config.today && typeof config.today === 'object' ? config.today : {}) as Record<string, unknown>;
	const defaultOverviewOrder = Array.isArray(DEFAULT_CONFIG.today.overviewOrder)
		? [...DEFAULT_CONFIG.today.overviewOrder]
		: ['timeline', 'notes', 'capture', 'todo', 'tracker', 'tasks'];
	const savedOverviewOrder = Array.isArray(current.overviewOrder)
		? (current.overviewOrder as unknown[]).map((v: unknown) => String(v ?? '').trim()).filter(Boolean)
		: [];
	const overviewSeen = new Set<string>();
	const overviewOrder = [...savedOverviewOrder, ...defaultOverviewOrder]
		.filter((v) => defaultOverviewOrder.includes(v) && !overviewSeen.has(v) && overviewSeen.add(v));
	config.today = {
		...DEFAULT_CONFIG.today,
		...current,
		boardTodayHeight: typeof current.boardTodayHeight === 'number' && Number.isFinite(current.boardTodayHeight)
			? current.boardTodayHeight
			: null,
		overviewOrder,
		focusLabels: ensureTodayFocusLabels(current.focusLabels),
		focusRowVisibility: ensureTodayFocusRowVisibility(current.focusRowVisibility),
		focusExpectationByDate: current.focusExpectationByDate && typeof current.focusExpectationByDate === 'object'
			? current.focusExpectationByDate : {},
		[KFPBD]: current[KFPBD] && typeof current[KFPBD] === 'object'
			? current[KFPBD] : {},
		focusHiddenByDate: current.focusHiddenByDate && typeof current.focusHiddenByDate === 'object'
			? current.focusHiddenByDate : {},
		focusQueueByDate: current.focusQueueByDate && typeof current.focusQueueByDate === 'object'
			? current.focusQueueByDate : {},
		bodyTouchedNotePathsByDate: current.bodyTouchedNotePathsByDate && typeof current.bodyTouchedNotePathsByDate === 'object'
			? current.bodyTouchedNotePathsByDate : {},
		[KQTSA]: typeof current[KQTSA] === 'string' && current[KQTSA].trim()
			? current[KQTSA] : null,
		[KQTT]: typeof current[KQTT] === 'string' && current[KQTT].trim()
			? current[KQTT].trim() : null,
		[KQTTK]: ['none', 'todo', 'tracker'].includes(String(current[KQTTK] || ''))
			? current[KQTTK] : null,
		[KQTTI]: typeof current[KQTTI] === 'string' && current[KQTTI].trim()
			? current[KQTTI].trim() : null,
		[KQTTSB]: ['todo', 'pending', 'doing'].includes(String(current[KQTTSB] || ''))
			? current[KQTTSB] : null,
	};
}

function ensureRecordSectionTitleVisibility(config: MigrationConfig): void {
	const current = (config[KRSTV] && typeof config[KRSTV] === 'object'
		? config[KRSTV]
		: {}) as Record<string, unknown>;
	// Historical default (inlined — this legacy field no longer exists in AiobConfig).
	config[KRSTV] = {
		focus: typeof current.focus === 'boolean' ? current.focus : false,
		tracker: typeof current.tracker === 'boolean' ? current.tracker : false,
		memo: typeof current.memo === 'boolean' ? current.memo : false,
		[KQT]: typeof current[KQT] === 'boolean' ? current[KQT] : false,
		channels: typeof current.channels === 'boolean' ? current.channels : false,
	};
}

function ensureOrderedWidgetIds<T extends string>(raw: unknown, defaults: readonly T[]): T[] {
	const saved = Array.isArray(raw)
		? (raw as unknown[]).map((value: unknown) => String(value ?? '').trim()).filter(Boolean)
		: [];
	const seen = new Set<string>();
	return [...saved, ...defaults]
		.filter((value): value is T => {
			if (!defaults.includes(value as T) || seen.has(value)) return false;
			seen.add(value);
			return true;
		});
}

function ensureWidgetOrders(config: MigrationConfig): void {
	config[KRWO] = ensureOrderedWidgetIds(
		config[KRWO],
		['focus', 'tracker', 'memo', KQT] as const,
	);
	config[KBWO] = ensureOrderedWidgetIds(
		config[KBWO],
		['progress', 'channels', 'today'] as const,
	);
}

function ensureRecordWidgetVisibility(config: MigrationConfig): void {
	const current = (config[KRWV] && typeof config[KRWV] === 'object'
		? config[KRWV]
		: {}) as Record<string, unknown>;
	config[KRWV] = {
		focus: typeof current.focus === 'boolean' ? current.focus : true,
		tracker: typeof current.tracker === 'boolean' ? current.tracker : true,
		memo: typeof current.memo === 'boolean' ? current.memo : true,
		[KQT]: typeof current[KQT] === 'boolean' ? current[KQT] : true,
	};
}

function ensureBoardWidgetVisibility(config: MigrationConfig): void {
	const current = (config[KBWV] && typeof config[KBWV] === 'object'
		? config[KBWV]
		: {}) as Record<string, unknown>;
	config[KBWV] = {
		progress: typeof current.progress === 'boolean' ? current.progress : true,
		channels: typeof current.channels === 'boolean' ? current.channels : true,
		today: typeof current.today === 'boolean' ? current.today : true,
	};
}

function ensureWidgetVisibilities(config: MigrationConfig): void {
	ensureRecordWidgetVisibility(config);
	ensureBoardWidgetVisibility(config);
}

// ── v14 → v15 ──────────────────────────────────────────────
function migrateV14ToV15(data: RawSavedData): void {
	const config = data.config! as MigrationConfig;
	const layout = config.layout as Record<string, unknown> | undefined;
	const home = layout?.home as Record<string, unknown> | undefined;
	if (!home?.sections) return;

	// These sections belong in the sidebar only
	const sidebarOnly = new Set(['tracker', 'memo', KQT, 'channels', 'sidebarStats']);
	home.sections = (home.sections as string[]).filter(
		(id: string) => !sidebarOnly.has(id),
	);
}

// ── v15 → v16 ──────────────────────────────────────────────
function migrateV15ToV16(data: RawSavedData): void {
	const config = data.config! as MigrationConfig;
	const layout = config.layout as Record<string, unknown> | undefined;
	const home = layout?.home as Record<string, unknown> | undefined;
	const sections: string[] | undefined = home?.sections as string[] | undefined;
	if (!sections) return;

	const focusIdx = sections.indexOf('focus');
	if (focusIdx < 0) return; // not present, nothing to do

	// Remove focus from current position
	sections.splice(focusIdx, 1);

	// Insert after 'progress', or at index 0 if progress not found
	const progressIdx = sections.indexOf('progress');
	sections.splice(progressIdx < 0 ? 0 : progressIdx + 1, 0, 'focus');
}

// ── v16 → v17 ──────────────────────────────────────────────
function migrateV16ToV17(data: RawSavedData): void {
	const config = data.config! as MigrationConfig;
	if (!config.appearance) config.appearance = {};
	const appearance = config.appearance as Record<string, unknown>;
	if (!appearance.sectionLanguage) {
		appearance.sectionLanguage = 'zh';
	}
}

// ── v17 → v18 ──────────────────────────────────────────────
function migrateV17ToV18(data: RawSavedData): void {
	const config = data.config! as MigrationConfig;

	// 1. sectionVisibility: ensure dayInsight key exists
	if (!config.sectionVisibility || typeof config.sectionVisibility !== 'object') {
		config.sectionVisibility = { ...DEFAULT_SECTION_VISIBILITY };
	}
	const sectionVisibility = config.sectionVisibility as Record<string, unknown>;
	if (typeof sectionVisibility[KDI] !== 'boolean') {
		sectionVisibility[KDI] = true;
	}

	// 2. layout.insight: prepend dayInsight if missing.
	// At v18 time, layout still had the 4-surface shape (pre-v22 flattening).
	const layout = (config.layout || (config.layout = {})) as Record<string, unknown>;
	if (!layout.insight) {
		layout.insight = { sections: [KDR, KHH, KAD] };
	}
	const insight = layout.insight as Record<string, unknown>;
	const insightSections: string[] = Array.isArray(insight.sections)
		? insight.sections as string[]
		: [];
	if (!insightSections.includes(KDI)) {
		insightSections.unshift(KDI);
		insight.sections = insightSections;
	}
}

// ── v18 → v19 ──────────────────────────────────────────────
function migrateV18ToV19(data: RawSavedData): void {
	const config = data.config! as MigrationConfig;

	// 1. Seed config.areas if missing.
	if (!Array.isArray(config.areas) || config.areas.length === 0) {
		config.areas = DEFAULT_AREAS.map((a) => ({ ...a, matchValues: [...a.matchValues] }));
	}

	const areas = config.areas as AreaDef[];

	// 2. Build a lookup: any old string label/alias → area uuid
	const labelToId = new Map<string, string>();
	for (const area of areas) {
		labelToId.set(area.id.toLowerCase(), area.id);
		labelToId.set(area.label.toLowerCase(), area.id);
		for (const v of area.matchValues || []) {
			labelToId.set(String(v).trim().toLowerCase(), area.id);
		}
	}

	// 3. Rewrite area string references in tracker items / recurring todos.
	const remap = (val: unknown): string[] => {
		if (val == null) return [];
		const arr = Array.isArray(val) ? val : [val];
		const out: string[] = [];
		for (const raw of arr) {
			const key = String(raw ?? '').trim().toLowerCase();
			if (!key) continue;
			const id = labelToId.get(key);
			if (id) {
				if (!out.includes(id)) out.push(id);
			} else {
				// Unknown label — keep as-is so user can manually fix later.
				const original = String(raw).trim();
				if (original && !out.includes(original)) out.push(original);
			}
		}
		return out;
	};

	if (Array.isArray(config[KTI])) {
		for (const item of config[KTI]) {
			if (item && item.areas != null) {
				item.areas = remap(item.areas);
			}
		}
	}
	if (Array.isArray(config[KRCT])) {
		for (const rt of config[KRCT]) {
			if (rt && rt.areas != null) {
				rt.areas = remap(rt.areas);
			}
		}
	}
}

// ── v19 → v20 ──────────────────────────────────────────────
function migrateV19ToV20(data: RawSavedData): void {
	const config = data.config! as MigrationConfig;
	// Schema-only bump: goalCount / rollupTo / rollupTags are all optional additive fields.
	// Sanity-clean any pre-existing rollupTo arrays so they're either string[] or undefined.
	if (Array.isArray(config[KTI])) {
		for (const item of config[KTI] as Array<Record<string, unknown>>) {
			if (item && item.rollupTo != null) {
				if (!Array.isArray(item.rollupTo)) {
					item.rollupTo = undefined;
				} else {
					const cleaned = (item.rollupTo as unknown[])
						.map((v: unknown) => String(v ?? '').trim())
						.filter(Boolean);
					item.rollupTo = cleaned.length ? Array.from(new Set(cleaned)) : undefined;
				}
			}
			if (item && item.goalCount != null && (typeof item.goalCount !== 'number' || (item.goalCount as number) <= 0)) {
				item.goalCount = undefined;
			}
		}
	}
}

// ── v20 → v21 ──────────────────────────────────────────────
// The 'timeline' section id used to be mounted alongside 'calendar' on the
// timeline surface, but its render delegate has been a no-op for a while
// (see AiobView's deps.renderTimeline). That left an empty card at the
// bottom of the timeline tab. Strip it from any persisted layout.
function migrateV20ToV21(data: RawSavedData): void {
	const config = data.config as MigrationConfig | undefined;
	const layout = config?.layout as Record<string, unknown> | undefined;
	const timeline = layout?.timeline as Record<string, unknown> | undefined;
	const sections = timeline?.sections as string[] | undefined;
	if (!Array.isArray(sections)) return;
	const filtered = sections.filter((id) => id !== 'timeline');
	if (filtered.length !== sections.length) {
		timeline!.sections = filtered;
	}
}

// ── v21 → v22 ──────────────────────────────────────────────
// Collapse layout.home / layout.timeline / layout.insight / layout.sidebar
// (4 independent SectionId[] lists) into a single flat LayoutSectionEntry[]
// where each entry declares which tabs it appears on. This removes the
// LayoutSurface type and lets users freely assign sections to any mix of
// tabs, including sidebar.
function migrateV21ToV22(data: RawSavedData): void {
	const config = data.config! as MigrationConfig;
	const TABS: Array<'home' | 'timeline' | 'insight' | 'sidebar'> = ['home', 'timeline', 'insight', 'sidebar'];
	const oldLayout = (config.layout && typeof config.layout === 'object'
		? config.layout
		: {}) as Record<string, unknown>;

	// Walk tabs in canonical order; first occurrence of each section wins
	// its position in the new flat list. If a section was on multiple
	// surfaces (rare but legal), we merge the tab memberships.
	const flat: Array<{ id: string; tabs: string[] }> = [];
	const seen = new Map<string, { id: string; tabs: string[] }>();

	for (const tab of TABS) {
		const surface = oldLayout[tab] as Record<string, unknown> | undefined;
		const ids: unknown = surface?.sections;
		if (!Array.isArray(ids)) continue;
		for (const raw of ids) {
			const id = String(raw ?? '').trim();
			if (!id) continue;
			const existing = seen.get(id);
			if (existing) {
				if (!existing.tabs.includes(tab)) existing.tabs.push(tab);
				continue;
			}
			const entry = { id, tabs: [tab] };
			seen.set(id, entry);
			flat.push(entry);
		}
	}

	// Any section ids in DEFAULT_LAYOUT that weren't in the saved layout —
	// append with their default tab membership so upgrading users don't
	// lose brand-new sections introduced alongside this migration.
	for (const def of DEFAULT_LAYOUT.sections) {
		if (seen.has(def.id)) continue;
		const entry = { id: def.id, tabs: [...def.tabs] };
		seen.set(def.id, entry);
		flat.push(entry);
	}

	config.layout = { sections: flat };
}

function ensureBoardWidgetTitleVisibility(config: MigrationConfig): void {
	const current = (config[KBWTV] && typeof config[KBWTV] === 'object'
		? config[KBWTV]
		: {}) as Record<string, unknown>;
	// Historical default (inlined — this legacy field no longer exists in AiobConfig).
	config[KBWTV] = {
		channels: typeof current.channels === 'boolean' ? current.channels : true,
	};
}

/**
 * v22 → v23: 合并遗留的 title visibility 字段进统一的 sectionTitleVisibility。
 *
 * 历史背景：
 * - v6→v7 引入 recordSectionTitleVisibility（focus/tracker/memo/quickTools/channels）
 * - v9→v10 引入 boardWidgetTitleVisibility（channels）
 * - v13→v14 做过一次 "种子合并"，把当时的 legacy 值写进新的 sectionTitleVisibility，
 *   但 UI 渲染层只搬了 Config 里的壳，QuickTools.ts 和 ChannelGrid.ts 仍在读 legacy 字段，
 *   所以 v14 之后用户的实际改动只写到 legacy 里，sectionTitleVisibility 是空转的。
 *
 * v23 把这次迁移彻底做完：
 * - legacy 字段 > unified 字段（legacy 是唯一真实信号源，覆盖 unified 里的默认值）
 * - 然后删除两个 legacy 字段
 */
function migrateV22ToV23(data: RawSavedData): void {
	const config = data.config! as MigrationConfig;
	const unified: Record<string, boolean> = {
		...DEFAULT_SECTION_TITLE_VISIBILITY,
		...(config.sectionTitleVisibility && typeof config.sectionTitleVisibility === 'object'
			? config.sectionTitleVisibility as Record<string, boolean>
			: {}),
	};

	const rtv = config[KRSTV] as Record<string, unknown> | undefined;
	if (rtv && typeof rtv === 'object') {
		for (const key of ['focus', 'tracker', 'memo', KQT, 'channels'] as const) {
			if (typeof rtv[key] === 'boolean') unified[key] = rtv[key] as boolean;
		}
	}

	const btv = config[KBWTV] as Record<string, unknown> | undefined;
	if (btv && typeof btv === 'object' && typeof btv.channels === 'boolean') {
		// Board 视图的 channels 标题显隐优先级高于 record 视图（v14 时也是这么合并的）。
		unified.channels = btv.channels as boolean;
	}

	config.sectionTitleVisibility = unified;
	// Drop all legacy widget/title fields — they were consumed by v14 and are no
	// longer part of AiobConfig. Intermediate migrations (v6→v7, v7→v8, v8→v9,
	// v9→v10) still write them; v23 is the point where we finally prune them.
	delete config[KRSTV];
	delete config[KBWTV];
	delete config[KRWV];
	delete config[KBWV];
	delete config[KRWO];
	delete config[KBWO];
}

/**
 * v23 → v24: 删除 channelRecentOpenedIds。
 *
 * 该字段原本记录最近打开的 channel id（最多 3 个），仅在 ChannelGrid 的 board
 * variant 里被写入和渲染（小圆点指示器）。board variant 整体退场后该字段零读零写，
 * v24 直接从用户数据里删掉。
 */
function migrateV23ToV24(data: RawSavedData): void {
	const config = data.config! as MigrationConfig;
	delete config.channelRecentOpenedIds;
}

/**
 * v24 → v25: 为 tracker item 引入 frequencyGoalKind。
 *
 * 之前 frequencyGoal 的语义单一——"周期内完成 N 天"——counter 模式没有
 * 每日目标就永远无法"达标"，周聚合显示不出来。v25 让 frequencyGoal 的
 * 单位由 frequencyGoalKind 决定：
 *   - 'days'    : 周期内满足每日 goal 的天数（兼容旧语义）
 *   - 'count'   : 周期内累计次数（counter 值 / timer sessions 总和）
 *   - 'minutes' : 周期内累计分钟（timer 专用）
 *
 * 迁移默认值（仅当已有 frequencyGoal 且无 frequencyGoalKind 时补齐）：
 *   - counter → 'count'（洗衣服这种最自然）
 *   - timer   → 'days' （保留旧语义，用户可在 dialog 切到 count / minutes）
 *   - boolean → 'days'
 */
function migrateV24ToV25(data: RawSavedData): void {
	const config = data.config! as MigrationConfig;
	const items = Array.isArray(config[KTI]) ? config[KTI] as Array<Record<string, unknown>> : [];
	for (const item of items) {
		if (!item || typeof item !== 'object') continue;
		if (item.frequency === 'daily' || !item.frequency) continue;
		if (typeof item.frequencyGoal !== 'number' || (item.frequencyGoal as number) <= 0) continue;
		if (item.frequencyGoalKind) continue;
		if (item.mode === 'counter') item.frequencyGoalKind = 'count';
		else item.frequencyGoalKind = 'days';
	}
}
