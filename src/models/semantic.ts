import type { AreaDef, SemanticAreaDef, SemanticStatus, Status, TodoLogEntry, TodoStatus } from './types';

const SEMANTIC_STATUS_OPTIONS: SemanticStatus[] = [
	'none',
	'todo',
	'pending',
	'doing',
	'done',
	'deferred',
	'cancelled',
];

export const SEMANTIC_ACTIONABLE_STATUS_OPTIONS: SemanticStatus[] = SEMANTIC_STATUS_OPTIONS.filter((status) => status !== 'none');

export const SEMANTIC_AREA_DEFS: SemanticAreaDef[] = [
	{ id: 'rest', label: '睡觉休息', aliases: ['rest', '休息', '睡觉', '小憩', 'sleep'] },
	{ id: 'build', label: '构建', aliases: ['build', '编程', '开发', 'dev', 'code', 'coding', 'vibe', 'vibe-coding', 'lifeos', 'side-project'] },
	{ id: 'post', label: '社媒运营', aliases: ['post', '写作', '运营', '社媒', '内容', 'writing', 'content'] },
	{ id: 'growth', label: '学习提升', aliases: ['growth', '学习', '提升', '自我提升', 'study', 'learning'] },
	{ id: 'social', label: '娱乐社交', aliases: ['social', '娱乐', '社交', '摸鱼', 'fun', 'chill', 'play', 'enjoy', 'music'] },
	{ id: 'health', label: '运动健康', aliases: ['health', '健康', '运动', 'exercise', 'fitness'] },
	{ id: 'life', label: '生活日常', aliases: ['life', '生活', '日常', 'daily', 'routine', 'family', '家庭'] },
	{ id: 'transit', label: '交通出行', aliases: ['transit', '交通', '出行', '通勤', 'commute'] },
	{ id: 'work', label: '打工换钱', aliases: ['work', '工作', '打工', 'job'] },
	{ id: 'assets', label: '物品资产', aliases: ['assets', '物品', '资产', 'owner', 'subscription', '订阅'] },
];

type SemanticOption = {
	value: string;
	label: string;
};

/** Runtime area registry — set by main.ts after data load. Falls back to hardcoded defs. */
let USER_AREAS: AreaDef[] | null = null;
let USER_AREA_LOOKUP: Map<string, { id: string; label: string }> = new Map();
const FALLBACK_AREA_LOOKUP = new Map<string, { id: string; label: string }>();
for (const area of SEMANTIC_AREA_DEFS) {
	FALLBACK_AREA_LOOKUP.set(toSemanticLookupKey(area.id), { id: area.id, label: area.label });
	FALLBACK_AREA_LOOKUP.set(toSemanticLookupKey(area.label), { id: area.id, label: area.label });
	for (const alias of area.aliases || []) {
		FALLBACK_AREA_LOOKUP.set(toSemanticLookupKey(alias), { id: area.id, label: area.label });
	}
}

/** Push user-configured areas into the resolver (called from main.ts on load + after settings save). */
export function setUserAreas(areas: AreaDef[] | null | undefined): void {
	USER_AREAS = Array.isArray(areas) && areas.length > 0 ? areas.map((a) => ({ ...a, matchValues: [...(a.matchValues || [])] })) : null;
	USER_AREA_LOOKUP = new Map();
	if (!USER_AREAS) return;
	for (const area of USER_AREAS) {
		USER_AREA_LOOKUP.set(toSemanticLookupKey(area.id), { id: area.id, label: area.label });
		// Match by label too, so users writing the label in frontmatter still resolves.
		USER_AREA_LOOKUP.set(toSemanticLookupKey(area.label), { id: area.id, label: area.label });
		for (const v of area.matchValues || []) {
			USER_AREA_LOOKUP.set(toSemanticLookupKey(v), { id: area.id, label: area.label });
		}
	}
}

const STATUS_LOOKUP = new Map<string, SemanticStatus>([
	['', 'none'],
	['none', 'none'],
	['todo', 'todo'],
	['待办', 'todo'],
	['待开始', 'todo'],
	['pending', 'pending'],
	['待定', 'pending'],
	['doing', 'doing'],
	['in-progress', 'doing'],
	['进行中', 'doing'],
	['done', 'done'],
	['complete', 'done'],
	['completed', 'done'],
	['已完成', 'done'],
	['archived', 'done'],
	['deferred', 'deferred'],
	['defer', 'deferred'],
	['postponed', 'deferred'],
	['已推迟', 'deferred'],
	['延期', 'deferred'],
	['cancelled', 'cancelled'],
	['canceled', 'cancelled'],
	['cancel', 'cancelled'],
	['discontinued', 'cancelled'],
	['已取消', 'cancelled'],
]);

export function normalizeSemanticStatus(value: unknown, fallback: SemanticStatus = 'none'): SemanticStatus {
	const raw = Array.isArray(value) ? value[0] : value;
	const key = toSemanticLookupKey(raw);
	return STATUS_LOOKUP.get(key) || fallback;
}

export function normalizeActionableSemanticStatus(value: unknown, fallback: Status = 'todo'): Status {
	const status = normalizeSemanticStatus(value, fallback);
	return status === 'none' ? fallback : status;
}

/** Clamp a status to an active todo sub-state. Terminal states map to 'todo'. */
export function normalizeTodoStatus(value: unknown, fallback: TodoStatus = 'todo'): TodoStatus {
	const status = normalizeSemanticStatus(value, fallback);
	if (status === 'todo' || status === 'pending' || status === 'doing') return status;
	return fallback;
}

export function getSemanticStatusOptions(includeNone = false): SemanticStatus[] {
	return includeNone ? [...SEMANTIC_STATUS_OPTIONS] : [...SEMANTIC_ACTIONABLE_STATUS_OPTIONS];
}

export function getSemanticStatusLabel(status: SemanticStatus, kind: 'todo' | 'task' | 'generic' = 'generic'): string {
	switch (status) {
		case 'todo':
			return kind === 'task' ? '待开始' : '待办';
		case 'pending':
			return '待定';
		case 'doing':
			return '进行中';
		case 'done':
			return '已完成';
		case 'deferred':
			return '已推迟';
		case 'cancelled':
			return '已取消';
		default:
			return '';
	}
}

export function normalizeSemanticAreas(value: unknown): string[] {
	const rawValues = Array.isArray(value) ? value : value == null ? [] : [value];
	const seen = new Set<string>();
	const next: string[] = [];
	for (const raw of rawValues) {
		const parts = String(raw ?? '')
			.split(/[，,]/)
			.map((entry) => entry.trim())
			.filter(Boolean);
		for (const part of parts) {
			const normalized = normalizeSemanticAreaId(part);
			if (!normalized || seen.has(normalized)) continue;
			seen.add(normalized);
			next.push(normalized);
		}
	}
	return next;
}

export function getSemanticAreaLabel(value: string): string {
	const normalized = normalizeSemanticAreaId(value);
	if (!normalized) return value;
	if (USER_AREAS) {
		const ua = USER_AREAS.find((a) => a.id === normalized);
		if (ua) return ua.label;
	}
	return SEMANTIC_AREA_DEFS.find((entry) => entry.id === normalized)?.label || normalized;
}

export function getSemanticAreaOptions(extraValues: string[] = []): SemanticOption[] {
	const options = new Map<string, SemanticOption>();
	if (USER_AREAS && USER_AREAS.length > 0) {
		for (const area of USER_AREAS) {
			options.set(area.id, { value: area.id, label: area.label });
		}
	} else {
		for (const area of SEMANTIC_AREA_DEFS) {
			options.set(area.id, { value: area.id, label: area.label });
		}
	}
	for (const raw of extraValues) {
		const normalized = normalizeSemanticAreaId(raw);
		if (!normalized || options.has(normalized)) continue;
		options.set(normalized, { value: normalized, label: raw.trim() || normalized });
	}
	return [...options.values()];
}

export function getTodoSemanticStatus(todo: TodoLogEntry): SemanticStatus {
	if (todo.action === 'complete') return 'done';
	if (todo.action === 'cancelled') return 'cancelled';
	if (todo.action === 'deferred') return 'deferred';
	if (todo.action === 'expired') return 'expired';
	return normalizeTodoStatus(todo.status, 'todo');
}

export function getSemanticSourceRef(entry: { type?: string; ts?: string; itemId?: string; noteId?: string; content?: string; subtype?: string }): string {
	switch (entry.type) {
		case 'memo':
			return `memo:${entry.ts}`;
		case 'tracker':
			return `tracker:${entry.itemId}:${entry.ts}`;
		case 'todo':
			return entry.noteId ? `todo-note:${entry.noteId}` : `todo:${entry.ts}:${entry.content}`;
		case 'capture':
			return entry.noteId ? `capture:${entry.noteId}` : `capture:${entry.ts}`;
		case 'record':
			return entry.noteId ? `note:${entry.noteId}` : `record:${entry.subtype || 'record'}:${entry.ts}`;
		case 'review':
			return `review:${(entry.ts ?? '').slice(0, 10)}`;
		case 'recurring-generate':
			return `recurring:${entry.ts}`;
		default:
			return `unknown:${entry.ts}`;
	}
}

export function getFileSourceRef(path: string): string {
	return `note:${path}`;
}

export function getSourceRefOpenPath(sourceRef?: string | null): string | null {
	if (!sourceRef) return null;
	if (sourceRef.startsWith('task:')) return sourceRef.slice(5) || null;
	if (sourceRef.startsWith('note:')) return sourceRef.slice(5) || null;
	if (sourceRef.startsWith('capture:')) return sourceRef.slice(8) || null;
	if (sourceRef.startsWith('todo-note:')) return sourceRef.slice(10) || null;
	return null;
}

export function normalizeSemanticAreaId(value: string): string | null {
	const trimmed = value.trim();
	if (!trimmed) return null;
	const key = toSemanticLookupKey(trimmed);
	// Prefer user-configured areas, then fall back to hardcoded defs.
	const userHit = USER_AREA_LOOKUP.get(key);
	if (userHit) return userHit.id;
	const builtin = FALLBACK_AREA_LOOKUP.get(key);
	if (builtin) return builtin.id;
	return trimmed.toLowerCase().replace(/\s+/g, '-');
}

function toSemanticLookupKey(value: unknown): string {
	const str = typeof value === 'string' ? value : '';
	return str
		.trim()
		.toLowerCase()
		.replace(/[_\s]+/g, '-');
}
