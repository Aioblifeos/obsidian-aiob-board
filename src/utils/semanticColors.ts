const SEMANTIC_TOKEN_COLOR_PRESETS = [
	'rgba(220, 50, 50, 0.15)',
	'rgba(255, 110, 80, 0.15)',
	'rgba(255, 150, 50, 0.15)',
	'rgba(255, 190, 20, 0.15)',
	'rgba(230, 210, 20, 0.15)',
	'rgba(200, 165, 30, 0.15)',
	'rgba(110, 210, 60, 0.15)',
	'rgba(40, 180, 90, 0.15)',
	'rgba(20, 160, 110, 0.15)',
	'rgba(20, 175, 155, 0.15)',
	'rgba(0, 200, 235, 0.15)',
	'rgba(40, 165, 235, 0.15)',
	'rgba(40, 110, 255, 0.15)',
	'rgba(60, 80, 225, 0.15)',
	'rgba(90, 50, 210, 0.15)',
	'rgba(140, 50, 225, 0.15)',
	'rgba(215, 50, 175, 0.15)',
	'rgba(245, 90, 155, 0.15)',
	'rgba(245, 110, 125, 0.15)',
	'rgba(165, 95, 45, 0.15)',
	'rgba(195, 155, 95, 0.15)',
	'rgba(215, 190, 135, 0.15)',
	'rgba(125, 165, 115, 0.15)',
	'rgba(175, 155, 225, 0.15)',
	'rgba(195, 195, 195, 0.15)',
	'rgba(145, 145, 145, 0.15)',
	'rgba(105, 125, 145, 0.15)',
	'rgba(75, 75, 75, 0.15)',
	'rgba(55, 55, 65, 0.15)',
];

function semanticTokenHash(value: string, propertyKey: string): number {
	const key = `${propertyKey}:${value.trim()}`;
	let hash = 0;
	for (let i = 0; i < key.length; i++) {
		hash = (hash << 5) - hash + key.charCodeAt(i);
		hash |= 0;
	}
	return Math.abs(hash);
}

export function getSemanticTokenBackgroundColor(
	value: string,
	propertyKey: string,
	cache?: Map<string, string>,
): string {
	const key = `${propertyKey}:${value.trim()}`;
	const cached = cache?.get(key);
	if (cached) return cached;

	const color = SEMANTIC_TOKEN_COLOR_PRESETS[semanticTokenHash(value, propertyKey) % SEMANTIC_TOKEN_COLOR_PRESETS.length];
	cache?.set(key, color);
	return color;
}

/** iOS system color palette (vivid / dark-mode variants — brighter on light backgrounds). */
const IOS_SYSTEM_COLORS = {
	red: '#FF453A',
	orange: '#FF9F0A',
	yellow: '#FFD60A',
	green: '#30D158',
	mint: '#63E6E1',
	teal: '#40C8E0',
	cyan: '#64D2FF',
	blue: '#0A84FF',
	indigo: '#5E5CE6',
	purple: '#BF5AF2',
	pink: '#FF375F',
	brown: '#AC8E68',
	gray: '#8E8E93',
} as const;

/** Pool used for hash-based assignment of unknown areas — only the bright hues. */
const VIVID_COLOR_POOL: string[] = [
	IOS_SYSTEM_COLORS.red,
	IOS_SYSTEM_COLORS.orange,
	IOS_SYSTEM_COLORS.yellow,
	IOS_SYSTEM_COLORS.green,
	IOS_SYSTEM_COLORS.mint,
	IOS_SYSTEM_COLORS.cyan,
	IOS_SYSTEM_COLORS.blue,
	IOS_SYSTEM_COLORS.indigo,
	IOS_SYSTEM_COLORS.purple,
	IOS_SYSTEM_COLORS.pink,
];

const SEMANTIC_SOLID_COLOR_PRESETS: string[] = Object.values(IOS_SYSTEM_COLORS);

/** Stable color assignment for known semantic areas. */
const AREA_COLOR_MAP: Record<string, string> = {
	rest: IOS_SYSTEM_COLORS.gray,
	build: IOS_SYSTEM_COLORS.blue,
	post: IOS_SYSTEM_COLORS.purple,
	growth: IOS_SYSTEM_COLORS.indigo,
	social: IOS_SYSTEM_COLORS.pink,
	health: IOS_SYSTEM_COLORS.green,
	life: IOS_SYSTEM_COLORS.orange,
	transit: IOS_SYSTEM_COLORS.cyan,
	work: IOS_SYSTEM_COLORS.red,
	assets: IOS_SYSTEM_COLORS.brown,
};

/** Aliases (Chinese labels, common variants) → canonical area id. */
const AREA_ALIAS_MAP: Record<string, string> = {
	'rest': 'rest', '休息': 'rest', '睡觉': 'rest', '小憩': 'rest', 'sleep': 'rest',
	'build': 'build', '构建': 'build', '编程': 'build', '开发': 'build',
	'dev': 'build', 'code': 'build', 'coding': 'build',
	'vibe': 'build', 'vibe-coding': 'build', 'lifeos': 'build', 'side-project': 'build',
	'post': 'post', '写作': 'post', '运营': 'post', '社媒': 'post', '内容': 'post',
	'writing': 'post', 'content': 'post',
	'growth': 'growth', '学习': 'growth', '提升': 'growth', '自我提升': 'growth',
	'study': 'growth', 'learning': 'growth',
	'social': 'social', '娱乐': 'social', '社交': 'social', '摸鱼': 'social',
	'fun': 'social', 'chill': 'social', 'play': 'social', 'enjoy': 'social', 'music': 'social',
	'health': 'health', '健康': 'health', '运动': 'health',
	'exercise': 'health', 'fitness': 'health',
	'life': 'life', '生活': 'life', '日常': 'life', 'daily': 'life', 'routine': 'life',
	'family': 'life', '家庭': 'life',
	'transit': 'transit', '交通': 'transit', '出行': 'transit', '通勤': 'transit', 'commute': 'transit',
	'work': 'work', '工作': 'work', '打工': 'work', 'job': 'work',
	'assets': 'assets', '物品': 'assets', '资产': 'assets', 'owner': 'assets',
	'subscription': 'assets', '订阅': 'assets',
};

/** Mutable user overrides loaded from plugin config. Keys: canonical id OR raw lowercase area name. */
let USER_AREA_COLORS: Record<string, string> = {};

/** Called by main.ts on plugin load and after settings change. */
export function setUserAreaColors(map: Record<string, string> | undefined): void {
	USER_AREA_COLORS = map ? { ...map } : {};
}

/** Mirror of user-configured areas for color resolution (id → color). Set by main.ts. */
let USER_AREA_COLOR_BY_ID: Record<string, string> = {};
let USER_AREA_COLOR_BY_MATCH: Record<string, string> = {};

/** Push the user-configured area list. Builds id-based and match-value-based color lookups. */
export function setUserAreasColorIndex(areas: { id: string; color: string; label: string; matchValues?: string[] }[] | null | undefined): void {
	USER_AREA_COLOR_BY_ID = {};
	USER_AREA_COLOR_BY_MATCH = {};
	if (!Array.isArray(areas)) return;
	for (const a of areas) {
		if (!a || !a.id || !a.color) continue;
		USER_AREA_COLOR_BY_ID[a.id] = a.color;
		USER_AREA_COLOR_BY_MATCH[a.id.toLowerCase()] = a.color;
		if (a.label) USER_AREA_COLOR_BY_MATCH[a.label.toLowerCase()] = a.color;
		for (const v of a.matchValues || []) {
			if (v) USER_AREA_COLOR_BY_MATCH[String(v).trim().toLowerCase()] = a.color;
		}
	}
}

/** Built-in palette presets exposed for the settings UI. */
export const AREA_COLOR_PRESETS = {
	ios: [
		{ name: 'red', hex: IOS_SYSTEM_COLORS.red, label: '红' },
		{ name: 'orange', hex: IOS_SYSTEM_COLORS.orange, label: '橙' },
		{ name: 'yellow', hex: IOS_SYSTEM_COLORS.yellow, label: '黄' },
		{ name: 'green', hex: IOS_SYSTEM_COLORS.green, label: '绿' },
		{ name: 'mint', hex: IOS_SYSTEM_COLORS.mint, label: '薄荷' },
		{ name: 'teal', hex: IOS_SYSTEM_COLORS.teal, label: '青绿' },
		{ name: 'cyan', hex: IOS_SYSTEM_COLORS.cyan, label: '青' },
		{ name: 'blue', hex: IOS_SYSTEM_COLORS.blue, label: '蓝' },
		{ name: 'indigo', hex: IOS_SYSTEM_COLORS.indigo, label: '靛' },
		{ name: 'purple', hex: IOS_SYSTEM_COLORS.purple, label: '紫' },
		{ name: 'pink', hex: IOS_SYSTEM_COLORS.pink, label: '粉' },
		{ name: 'brown', hex: IOS_SYSTEM_COLORS.brown, label: '棕' },
		{ name: 'gray', hex: IOS_SYSTEM_COLORS.gray, label: '灰' },
	],
	warm: [
		{ name: 'coral', hex: '#ff8f7a', label: '珊瑚' },
		{ name: 'amber', hex: '#ffb84d', label: '琥珀' },
		{ name: 'green', hex: '#7bc96f', label: '绿' },
		{ name: 'cyan', hex: '#4fcfff', label: '青' },
		{ name: 'pink', hex: '#ff74c8', label: '粉' },
		{ name: 'teal', hex: '#52d6c3', label: '青绿' },
		{ name: 'violet', hex: '#a67cff', label: '紫' },
		{ name: 'rose', hex: '#ff9eb5', label: '玫瑰' },
		{ name: 'blue', hex: '#6fa8ff', label: '蓝' },
		{ name: 'indigo', hex: '#8a84ff', label: '靛' },
		{ name: 'peach', hex: '#f0a862', label: '桃' },
		{ name: 'mint', hex: '#6dd4a0', label: '薄荷' },
		{ name: 'mauve', hex: '#e88aca', label: '木槿' },
		{ name: 'sky', hex: '#5cc4e0', label: '天蓝' },
		{ name: 'lavender', hex: '#c9a0f0', label: '薰衣草' },
		{ name: 'gold', hex: '#ffcc66', label: '金' },
		{ name: 'aqua', hex: '#7ad0d0', label: '碧' },
		{ name: 'terracotta', hex: '#e0826e', label: '陶土' },
		{ name: 'periwinkle', hex: '#8cb8e8', label: '矢车菊' },
		{ name: 'lime', hex: '#c4dc6a', label: '青柠' },
	],
} as const;

export function getSemanticTokenSolidColor(
	value: string,
	propertyKey: string,
	cache?: Map<string, string>,
): string {
	const trimmed = value.trim();
	const key = `solid:${propertyKey}:${trimmed}`;
	const cached = cache?.get(key);
	if (cached) return cached;

	let color: string;
	if (propertyKey === 'areas') {
		const lower = trimmed.toLowerCase();
		// Priority order:
		// 1. User-configured area (by id, label, or matchValues) — highest
		// 2. Legacy areaColors override map
		// 3. Hardcoded fallback AREA_COLOR_MAP via alias
		// 4. Hash-based vivid pool
		const userById = USER_AREA_COLOR_BY_ID[trimmed] || USER_AREA_COLOR_BY_MATCH[lower];
		const canonical = AREA_ALIAS_MAP[lower];
		const legacyOverride = (canonical && USER_AREA_COLORS[canonical]) || USER_AREA_COLORS[lower];
		if (userById) {
			color = userById;
		} else if (legacyOverride) {
			color = legacyOverride;
		} else if (canonical && AREA_COLOR_MAP[canonical]) {
			color = AREA_COLOR_MAP[canonical];
		} else {
			// Unknown / user-defined area: pick from vivid pool only (skip brown/gray/teal-dim)
			const len = VIVID_COLOR_POOL.length;
			const raw = semanticTokenHash(value, propertyKey) % len;
			const index = (raw * 7) % len;
			color = VIVID_COLOR_POOL[index];
		}
	} else {
		const len = SEMANTIC_SOLID_COLOR_PRESETS.length;
		const raw = semanticTokenHash(value, propertyKey) % len;
		const index = (raw * 7) % len;
		color = SEMANTIC_SOLID_COLOR_PRESETS[index];
	}

	cache?.set(key, color);
	return color;
}
