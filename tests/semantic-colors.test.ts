import { describe, expect, it } from 'vitest';
import { getSemanticTokenBackgroundColor } from '../src/utils/semanticColors';

describe('semanticColors', () => {
	it('returns stable colors for the same semantic token', () => {
		const cache = new Map<string, string>();
		const first = getSemanticTokenBackgroundColor('lifeos', 'areas', cache);
		const second = getSemanticTokenBackgroundColor('lifeos', 'areas', cache);

		expect(first).toBe(second);
		expect(cache.size).toBe(1);
	});

	it('separates colors by property key', () => {
		const areaColor = getSemanticTokenBackgroundColor('lifeos', 'areas');
		const statusColor = getSemanticTokenBackgroundColor('lifeos', 'status');

		expect(areaColor).not.toBe(statusColor);
	});
});
