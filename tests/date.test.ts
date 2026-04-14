import { describe, expect, it } from 'vitest';
import { getChineseLunarInfo } from '../src/utils/date';

describe('getChineseLunarInfo', () => {
	it('formats regular lunar days with Chinese day labels', () => {
		expect(getChineseLunarInfo('2026-04-01')).toMatchObject({
			displayLabel: '十四',
			fullLabel: '二月十四',
			monthLabel: '二月',
			dayLabel: '十四',
		});
	});

	it('shows the lunar month label on the first day of a lunar month', () => {
		expect(getChineseLunarInfo('2026-04-17')).toMatchObject({
			displayLabel: '三月',
			fullLabel: '三月初一',
			monthLabel: '三月',
			dayLabel: '初一',
		});
	});
});
