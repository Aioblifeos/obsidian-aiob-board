import { legacyKey } from '../utils/legacyCompat';
import { AiobConfig, SectionVisibility, SectionTitleVisibility, LayoutConfig, AreaDef } from './types';

/** Stable seed UUIDs so the default areas keep the same id across installs/migrations. */
export const DEFAULT_AREAS: AreaDef[] = [
	{
		id: 'a-rest-9c1f4a',
		label: '睡觉休息',
		emoji: '🌘',
		color: '#8E8E93',
		matchValues: ['rest', '休息', '睡觉', '小憩', 'sleep'],
	},
	{
		id: 'a-build-7e3b21',
		label: '构建',
		emoji: '💻',
		color: '#0A84FF',
		matchValues: ['build', '编程', '开发', 'dev', 'code', 'coding', 'vibe', 'vibe-coding', 'lifeos', 'LifeOS', 'Vibe', 'side-project'],
	},
	{
		id: 'a-post-5d8f12',
		label: '社媒运营',
		emoji: '✍️',
		color: '#BF5AF2',
		matchValues: ['post', '写作', '运营', '社媒', '内容', 'writing', 'content'],
	},
	{
		id: 'a-growth-2a6c08',
		label: '学习提升',
		emoji: '👑',
		color: '#5E5CE6',
		matchValues: ['growth', '学习', '提升', '自我提升', 'study', 'learning'],
	},
	{
		id: 'a-social-4f9e33',
		label: '娱乐社交',
		emoji: '📱',
		color: '#FF375F',
		matchValues: ['social', '娱乐', '社交', '摸鱼', 'fun', 'chill', 'play', 'enjoy', 'Enjoy', 'music', 'Music', 'AItalk'],
	},
	{
		id: 'a-health-1b7d55',
		label: '运动健康',
		emoji: '🌿',
		color: '#30D158',
		matchValues: ['health', 'Health', '健康', '运动', 'exercise', 'fitness'],
	},
	{
		id: 'a-life-3c2e77',
		label: '生活日常',
		emoji: '🐳',
		color: '#FF9F0A',
		matchValues: ['life', '生活', '日常', 'daily', 'routine', 'family', 'Family', '家庭'],
	},
	{
		id: 'a-transit-6f8a44',
		label: '交通出行',
		emoji: '🚇',
		color: '#64D2FF',
		matchValues: ['transit', '交通', '出行', '通勤', 'commute'],
	},
	{
		id: 'a-work-8d4b66',
		label: '打工换钱',
		emoji: '💼',
		color: '#FF453A',
		matchValues: ['work', '工作', '打工', 'job', 'Job'],
	},
	{
		id: 'a-assets-0e5c99',
		label: '物品资产',
		emoji: '📦',
		color: '#AC8E68',
		matchValues: ['assets', '物品', '资产', 'owner', 'subscription', '订阅'],
	},
];

export const DEFAULT_SECTION_VISIBILITY: SectionVisibility = {
	progress: true,
	sidebarStats: true,
	todo: true,
	memo: true,
	channels: true,
};

export const DEFAULT_SECTION_TITLE_VISIBILITY: SectionTitleVisibility = {
	memo: false,
	channels: true,
};

export const DEFAULT_LAYOUT: LayoutConfig = {
	sections: [
		{ id: 'progress', tabs: ['home', 'sidebar'] },
		{ id: 'sidebarStats', tabs: ['home', 'sidebar'] },
		{ id: 'channels', tabs: ['home', 'sidebar'] },
		{ id: 'memo', tabs: ['home', 'sidebar'] },
		{ id: 'todo', tabs: ['home', 'sidebar'] },
	],
};

/**
 * Legacy config values kept for migration compatibility.
 * These fields no longer exist in AiobConfig but are accessed via
 * `(DEFAULT_CONFIG as any).xxx` in migration code.
 */
const LEGACY_DEFAULTS: Record<string, any> = {
	recordFooterQuote: '先完成，再完美。',
	[legacyKey('tg')]: [
		{ id: 'routine', name: 'Routine' },
		{ id: 'health', name: '健康' },
		{ id: 'habit', name: '习惯' },
		{ id: 'daily-data', name: '数据' },
	],
	[legacyKey('ti')]: [] as any[],
	[legacyKey('rt')]: [] as any[],
	[legacyKey('rct')]: [] as any[],
	trackerVerticalTabs: false,
	ai: { endpoint: '', model: '', apiKey: '', reviewStyle: '' },
	review: { reminderTime: '22:00', autoSyncUnfinished: true, timeCategories: [], timelineSortOrder: 'asc' },
	capture: { defaultFolder: '', categories: [], lastCategory: '', downloadMedia: false, enableOCR: false, ocrApiUrl: '', ocrApiKey: '', ocrModelName: '', ocrPrompt: '' },
};

export const DEFAULT_CONFIG: AiobConfig & Record<string, any> = {
	...LEGACY_DEFAULTS,

	// ── Display Name ──
	displayName: 'Aiob LifeOS',

	// ── Unified section config ──
	sectionVisibility: { ...DEFAULT_SECTION_VISIBILITY },
	sectionTitleVisibility: { ...DEFAULT_SECTION_TITLE_VISIBILITY },
	layout: { ...DEFAULT_LAYOUT },

	channelCoreIds: ['inbox', 'tasks', 'notes', 'reading'],

	// ── Channels ──
	channels: [
		{ id: 'database', name: '数据库', icon: '🗂️', path: '/' },
	],

	// ── Daily Note ──
	dailyNote: {
		folder: '',
		filenameTemplate: '',
		autoGenerate: false,
		sections: [],
		templatePath: '',
	},

	// ── Markdown Storage ──
	memoStorage: {
		targetFile: 'daily-note',
		heading: '## Memos',
		timestampColor: '#808080',
	},
	todoStorage: {
		targetFile: 'daily-note',
		heading: '## Todo',
		syncFromVault: true,
		syncFolder: '',
	},

	// ── Today ──
	today: {
		showProgressBars: { daily: true, weekly: true, monthly: true, yearly: true },
		showDataOverview: true,
		showDailyStats: true,
		boardTodayHeight: null,
		overviewOrder: ['todo', 'notes'],
		focusLabels: {
			expectation: '今日期待：',
			primary: '今日重点：',
			journal: '今日日记：',
			history: '往年今日：',
		},
		focusRowVisibility: {
			expectation: true,
			primary: true,
			journal: true,
			history: true,
		},
		bodyTouchedNotePathsByDate: {},
	},

	// ── Appearance ──
	appearance: {
		defaultTheme: 'system',
		sectionLanguage: 'zh',
	},

	// ── Frontmatter Colorizer ──
	frontmatterColorMap: {},
	enableFrontmatterColorizer: true,
	enableNewNoteTemplate: false,
	newNoteTemplatePath: '',
	newNoteExcludeFolders: [],

	// ── Folder Stats ──
	enableFolderStats: true,

	// ── Folder Colorizer ──
	enableFolderColorizer: true,
	folderColors: {},

	// ── Area Colors (user overrides) ──
	areaColors: {},

	// ── Areas (config-driven, user-editable) ──
	areas: DEFAULT_AREAS.map((a) => ({ ...a, matchValues: [...a.matchValues] })),
};
