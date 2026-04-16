declare global {
	interface Window {
		__AIOB_DEBUG__?: boolean;
	}
}

export const AIOB_DEBUG_STORAGE_KEY = 'aiob-debug';

export function isAiobDebugEnabled(): boolean {
	if (typeof window === 'undefined') return false;
	if (typeof window.__AIOB_DEBUG__ === 'boolean') return window.__AIOB_DEBUG__;
	try {
		return window.localStorage.getItem(AIOB_DEBUG_STORAGE_KEY) === 'true';
	} catch {
		return false;
	}
}

export function debugLog(message: string, ...args: unknown[]): void {
	if (!isAiobDebugEnabled()) return;
	console.debug(`Aiob: ${message}`, ...args);
}
