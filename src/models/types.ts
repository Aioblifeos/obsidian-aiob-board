// ============================================================
// Aiob Board - 数据模型定义
// ============================================================

// ── 通用属性 ──

export type SemanticStatus = 'none' | 'todo' | 'pending' | 'doing' | 'done' | 'deferred' | 'cancelled' | 'expired';
export type Status = Exclude<SemanticStatus, 'none'>;
export type TodoStatus = 'todo' | 'pending' | 'doing';
export type Priority = 'P0' | 'P1' | 'P2' | 'P3' | 'none';
export type ThemeMode = 'system' | 'dark' | 'light';
export type SectionLanguage = 'zh' | 'en';

export interface SemanticAreaDef {
	id: string;
	label: string;
	aliases?: string[];
}

/** User-defined area (config-driven). */
export interface AreaDef {
	id: string;
	label: string;
	color: string;
	emoji?: string;
	matchValues: string[];
}

// ── Channel ──

export interface ChannelDef {
	id: string;
	name: string;
	icon: string;
	path: string;
}

// ── Daily Note Config ──

export interface DailyNoteConfig {
	folder?: string;
	filenameTemplate?: string;
	autoGenerate: boolean;
	sections: string[];
	templatePath?: string;
}

// ── Markdown Storage Config ──

export interface MemoStorageConfig {
	targetFile: string;
	heading: string;
	timestampColor: string;
}

export interface TodoStorageConfig {
	targetFile: string;
	heading: string;
	syncFromVault: boolean;
	syncFolder: string;
}

// ── Log Entry (minimal — used by semantic.ts) ──

export type TodoAction = 'create' | 'complete' | 'cancelled' | 'deferred' | 'expired';

export interface TodoLogEntry {
	ts: string;
	type: 'todo';
	action: TodoAction;
	content: string;
	time: string | null;
	status: TodoStatus;
	priority: Priority;
	created?: string;
	completedAt: string | null;
	date?: string;
	areas?: string | string[];
	noteId?: string;
}

// ── Today Config ──

export type TodayOverviewItemId = 'todo' | 'notes';

export interface TodayConfig {
	showProgressBars: {
		daily: boolean;
		weekly: boolean;
		monthly: boolean;
		yearly: boolean;
	};
	showDataOverview: boolean;
	showDailyStats: boolean;
	boardTodayHeight?: number | null;
	overviewOrder?: TodayOverviewItemId[];
	focusLabels?: Record<string, string>;
	focusRowVisibility?: Record<string, boolean>;
	focusPinnedByDate?: Record<string, string[]>;
	focusExpectationByDate?: Record<string, string>;
	focusItemsByDate?: Record<string, any[]>;
	focusHiddenByDate?: Record<string, string[]>;
	focusQueueByDate?: Record<string, string[]>;
	sectionNotesByDate?: Record<string, Record<string, string>>;
	sectionNotes?: Record<string, string>;
	flowHiddenByDate?: Record<string, string[]>;
	flowOrderByDate?: Record<string, string[]>;
	bodyTouchedNotePathsByDate?: Record<string, string[]>;
	typedWordsByDate?: Record<string, number>;
	wordBaselinesByDate?: Record<string, Record<string, { baseline: number; current: number }>>;
	quickTimerStartedAt?: string | null;
	quickTimerTitle?: string | null;
	quickTimerTargetKind?: string | null;
	quickTimerTargetId?: string | null;
	quickTimerTodoStatusBeforeStart?: TodoStatus | null;
}

// ── Section-based architecture ──

export type SectionId =
	| 'memo' | 'progress' | 'channels' | 'todo'
	| 'sidebarStats';

export type TabId = 'home' | 'sidebar';

export interface LayoutSectionEntry {
	id: SectionId;
	tabs: TabId[];
}

export interface LayoutConfig {
	sections: LayoutSectionEntry[];
}
export type SectionVisibility = Partial<Record<SectionId, boolean>>;
export type SectionTitleVisibility = Partial<Record<SectionId, boolean>>;

// ── Plugin Config (top-level) ──

export interface AiobConfig {
	displayName: string;

	// ── Unified section config ──
	sectionVisibility: SectionVisibility;
	sectionTitleVisibility: SectionTitleVisibility;
	layout: LayoutConfig;

	channelCoreIds: string[];
	channels: ChannelDef[];
	dailyNote: DailyNoteConfig;
	today: TodayConfig;
	memoStorage: MemoStorageConfig;
	todoStorage: TodoStorageConfig;
	appearance: {
		defaultTheme: ThemeMode;
		sectionLanguage: SectionLanguage;
	};
	frontmatterColorMap: Record<string, Record<string, string | null>>;
	enableFrontmatterColorizer: boolean;
	enableNewNoteTemplate: boolean;
	newNoteTemplatePath: string;
	newNoteExcludeFolders: string[];
	areaColors?: Record<string, string>;
	areas?: AreaDef[];
	enableFolderStats: boolean;
	enableFolderColorizer: boolean;
	folderColors: Record<string, { bg?: string; text?: string }>;
}

// ── Plugin Data ──

export interface AiobData {
	schemaVersion: number;
	config: AiobConfig;
}
