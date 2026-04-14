import { defineConfig } from 'vitest/config';

export default defineConfig({
	test: {
		include: ['tests/**/*.test.ts'],
	},
	resolve: {
		alias: {
			'@': './src',
			// Mock obsidian module for tests
			'obsidian': './tests/__mocks__/obsidian.ts',
		},
	},
});
