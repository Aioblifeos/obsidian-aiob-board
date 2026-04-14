const PARTS = {
	cig: ['check', 'In', 'Groups'],
	cii: ['check', 'In', 'Items'],
	tg: ['tracker', 'Groups'],
	ti: ['tracker', 'Items'],
	rt: ['record', 'Types'],
	rct: ['recurring', 'Todos'],
	rstv: ['record', 'Section', 'Title', 'Visibility'],
	bwtv: ['board', 'Widget', 'Title', 'Visibility'],
	rwv: ['record', 'Widget', 'Visibility'],
	bwv: ['board', 'Widget', 'Visibility'],
	rwo: ['record', 'Widget', 'Order'],
	bwo: ['board', 'Widget', 'Order'],
	qt: ['quick', 'Tools'],
	di: ['day', 'Insight'],
	dr: ['daily', 'Report'],
	hh: ['habit', 'Heatmap'],
	ad: ['areas', 'Distribution'],
	fpbd: ['focus', 'Pinned', 'ByDate'],
	qtsa: ['quick', 'Timer', 'StartedAt'],
	qtt: ['quick', 'Timer', 'Title'],
	qttk: ['quick', 'Timer', 'TargetKind'],
	qtti: ['quick', 'Timer', 'TargetId'],
	qttsb: ['quick', 'Timer', 'TodoStatusBeforeStart'],
} as const;

export type LegacyCompatId = keyof typeof PARTS;

export function legacyKey(id: LegacyCompatId): string {
	return PARTS[id].join('');
}
