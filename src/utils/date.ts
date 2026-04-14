/** Format Date as "YYYY-MM-DD" */
export function formatLocalDate(date = new Date()): string {
	return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

type ChineseLunarInfo = {
	displayLabel: string;
	fullLabel: string;
	monthLabel: string;
	dayLabel: string;
};

const LUNAR_DAY_NUMS = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九', '十'];

let chineseLunarFormatter: Intl.DateTimeFormat | null | undefined;

export function getChineseLunarInfo(date: Date | string): ChineseLunarInfo | null {
	const formatter = getChineseLunarFormatter();
	if (!formatter) return null;

	const target = typeof date === 'string' ? new Date(`${date}T12:00:00`) : date;
	if (Number.isNaN(target.getTime())) return null;

	const parts = formatter.formatToParts(target);
	const monthLabel = parts.find((part) => part.type === 'month')?.value?.trim() || '';
	const dayValue = Number(parts.find((part) => part.type === 'day')?.value || '');
	if (!monthLabel || !Number.isFinite(dayValue) || dayValue < 1 || dayValue > 30) return null;

	const dayLabel = formatChineseLunarDay(dayValue);
	return {
		displayLabel: dayValue === 1 ? monthLabel : dayLabel,
		fullLabel: `${monthLabel}${dayLabel}`,
		monthLabel,
		dayLabel,
	};
}

/** Format Date as "HH:MM" */
export function formatLocalTime(date = new Date()): string {
	return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** Format Date as "YYYY-MM-DDTHH:MM:SS" */
export function formatLocalISO(date = new Date()): string {
	return `${formatLocalDate(date)}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

/** Returns { date: "YYYY-MM-DD", time: "HH:MM" } for a given moment (defaults to now) */
export function dateAndTime(date = new Date()): { date: string; time: string } {
	return { date: formatLocalDate(date), time: formatLocalTime(date) };
}

/** Add days to a "YYYY-MM-DD" string, return "YYYY-MM-DD" */
export function addDaysToDateString(dateStr: string, days: number): string {
	const d = new Date(`${dateStr}T00:00:00`);
	d.setDate(d.getDate() + days);
	return formatLocalDate(d);
}

function getChineseLunarFormatter(): Intl.DateTimeFormat | null {
	if (chineseLunarFormatter !== undefined) return chineseLunarFormatter;
	try {
		chineseLunarFormatter = new Intl.DateTimeFormat('zh-Hans-CN-u-ca-chinese', {
			month: 'short',
			day: 'numeric',
		});
	} catch {
		chineseLunarFormatter = null;
	}
	return chineseLunarFormatter;
}

function formatChineseLunarDay(day: number): string {
	if (day <= 10) return `初${LUNAR_DAY_NUMS[day]}`;
	if (day < 20) return `十${LUNAR_DAY_NUMS[day - 10]}`;
	if (day === 20) return '二十';
	if (day < 30) return `廿${LUNAR_DAY_NUMS[day - 20]}`;
	return '三十';
}

function pad(n: number): string {
	return String(n).padStart(2, '0');
}
