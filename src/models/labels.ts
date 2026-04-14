// ============================================================
// Aiob - Section Title Labels (i18n: zh / en)
// ============================================================

import type { SectionLanguage } from './types';

export type LabelKey =
	// Progress
	| 'today' | 'thisWeek' | 'thisMonth' | 'thisYear'
	// Sections
	| 'dailyTodo' | 'dailyNotes' | 'channels' | 'memos'
	// Sidebar
	| 'sidebarStats'
	// Stats card labels
	| 'statWords' | 'statTodo' | 'statMemos' | 'statNotes'
	// Focus
	| 'saySomething'
	// UI strings
	| 'addTodo' | 'noTodo' | 'noNotes' | 'done'
	// Todo context menu
	| 'editTodo' | 'deleteTodo' | 'confirmDelete';

const ZH: Record<LabelKey, string> = {
	today: '今日',
	thisWeek: '本周',
	thisMonth: '本月',
	thisYear: '今年',
	dailyTodo: '今日待办',
	dailyNotes: '今日笔记',
	channels: '常用数据库',
	memos: '速记',
	sidebarStats: '数据概览',
	saySomething: '我有话说',
	addTodo: '添加待办...',
	noTodo: '暂无待办',
	noNotes: '暂无笔记',
	done: '已完成',
	statWords: '字数',
	statTodo: '待办',
	statMemos: '闪念',
	statNotes: '文档',
	editTodo: '编辑',
	deleteTodo: '删除',
	confirmDelete: '确认删除此待办？',
};

const EN: Record<LabelKey, string> = {
	today: 'Today',
	thisWeek: 'Week',
	thisMonth: 'Month',
	thisYear: 'Year',
	dailyTodo: 'Daily Todo',
	dailyNotes: 'Daily Notes',
	channels: 'Channels',
	memos: 'Memos',
	sidebarStats: 'Stats',
	saySomething: 'Say something',
	addTodo: 'Add todo...',
	noTodo: 'No todos',
	noNotes: 'No notes',
	done: 'Done',
	statWords: 'Words',
	statTodo: 'Todo',
	statMemos: 'Memos',
	statNotes: 'Notes',
	editTodo: 'Edit',
	deleteTodo: 'Delete',
	confirmDelete: 'Delete this todo?',
};

const TABLES: Record<SectionLanguage, Record<LabelKey, string>> = { zh: ZH, en: EN };

/** Get a section label for the current language setting. */
export function label(lang: SectionLanguage, key: LabelKey): string {
	return TABLES[lang]?.[key] ?? TABLES.en[key] ?? key;
}
