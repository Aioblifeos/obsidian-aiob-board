import { Menu } from 'obsidian';
import { renderIcon } from '../icon';
import { focusAndMaybeSelect } from './shared';

function bindDialogViewportLayout(overlay: HTMLDivElement, card: HTMLDivElement): void {
	const controller = new AbortController();
	const syncLayout = () => {
		const viewport = window.visualViewport;
		const viewportHeight = Math.round(viewport?.height || window.innerHeight || 0);
		const viewportWidth = Math.round(viewport?.width || window.innerWidth || 0);
		const offsetTop = Math.max(0, Math.round(viewport?.offsetTop || 0));
		const offsetLeft = Math.max(0, Math.round(viewport?.offsetLeft || 0));
		const isMobileWidth = viewportWidth <= 768;

		// 移动端把 overlay 钉在 visualViewport 上,键盘弹起时 visualViewport 会收缩并让出键盘占用的区域,
		// 这样 overlay 永远跟随可见区域走,不会被键盘遮挡。桌面端保留默认的 fixed inset: 0。
		if (viewport && isMobileWidth) {
			overlay.style.setProperty('--aiob-overlay-top', `${offsetTop}px`);
			overlay.style.setProperty('--aiob-overlay-left', `${offsetLeft}px`);
			overlay.style.setProperty('--aiob-overlay-width', `${viewportWidth}px`);
			overlay.style.setProperty('--aiob-overlay-height', `${viewportHeight}px`);
			overlay.classList.add('is-mobile-pinned');
		} else {
			overlay.classList.remove('is-mobile-pinned');
			overlay.style.removeProperty('--aiob-overlay-top');
			overlay.style.removeProperty('--aiob-overlay-left');
			overlay.style.removeProperty('--aiob-overlay-width');
			overlay.style.removeProperty('--aiob-overlay-height');
		}

		const sideGap = isMobileWidth ? (viewportWidth <= 480 ? 10 : 12) : 24;
		const topGapMin = isMobileWidth ? 12 : 24;
		const bottomGap = isMobileWidth ? 12 : 24;
		overlay.style.setProperty('--aiob-dialog-side-gap', `${sideGap}px`);
		// 移动端 top gap 要让出 safe-area（状态栏 / 灵动岛），再加 8px 呼吸空间
		overlay.style.setProperty('--aiob-dialog-top-gap',
			isMobileWidth
				? `max(${topGapMin}px, calc(env(safe-area-inset-top, 0px) + 8px))`
				: `${topGapMin}px`);
		overlay.style.setProperty('--aiob-dialog-bottom-gap', `${bottomGap}px`);
		// maxHeight 用保守估值，实际 safe-area 可能更大，card 内容不会溢出
		card.style.setProperty('max-height', `${Math.max(220, viewportHeight - topGapMin - bottomGap)}px`);
	};

	const keepFocusedFieldVisible = () => {
		const active = document.activeElement;
		if (!(active instanceof HTMLElement) || !overlay.contains(active)) return;
		active.scrollIntoView({ block: 'nearest', inline: 'nearest' });
	};

	const syncWithFocus = () => {
		syncLayout();
		window.setTimeout(() => {
			if (overlay.isConnected) keepFocusedFieldVisible();
		}, 80);
		window.setTimeout(() => {
			if (overlay.isConnected) keepFocusedFieldVisible();
		}, 180);
	};

	syncLayout();
	overlay.addEventListener('focusin', syncWithFocus, { signal: controller.signal });
	window.addEventListener('resize', syncLayout, { signal: controller.signal });
	window.visualViewport?.addEventListener('resize', syncWithFocus, { signal: controller.signal });
	window.visualViewport?.addEventListener('scroll', syncWithFocus, { signal: controller.signal });

	const observer = new MutationObserver(() => {
		if (overlay.isConnected) return;
		controller.abort();
		observer.disconnect();
	});
	observer.observe(document.body, { childList: true, subtree: true });
}

export function createDialogShell(title: string, cardClass = 'aiob-dialog-card-form'): {
	overlay: HTMLDivElement;
	card: HTMLDivElement;
} {
	const overlay = document.createElement('div');
	overlay.className = 'aiob-dialog-overlay';
	overlay.setAttribute('role', 'presentation');
	overlay.tabIndex = -1;
	const card = document.createElement('div');
	card.className = ['aiob-dialog-card', cardClass].filter(Boolean).join(' ');
	card.setAttribute('role', 'dialog');
	card.setAttribute('aria-modal', 'true');
	card.setAttribute('aria-label', title);
	const header = card.createDiv({ cls: 'aiob-dialog-header' });
	header.createDiv({ cls: 'aiob-dialog-title', text: title });
	const closeBtn = header.createEl('button', {
		cls: 'aiob-dialog-close',
		attr: { type: 'button', 'aria-label': '关闭' },
	});
	renderIcon(closeBtn, 'x', 'md');
	closeBtn.addEventListener('click', () => overlay.remove());
	return { overlay, card };
}

export function presentDialogShell(
	overlay: HTMLDivElement,
	card: HTMLDivElement,
	initialFocus?: HTMLElement | null,
): void {
	overlay.appendChild(card);
	bindDialogOverlayDismiss(overlay);
	document.body.appendChild(overlay);
	bindDialogViewportLayout(overlay, card);
	if (!initialFocus) return;
	if (initialFocus instanceof HTMLInputElement || initialFocus instanceof HTMLTextAreaElement || initialFocus instanceof HTMLSelectElement) {
		focusAndMaybeSelect(initialFocus);
		return;
	}
	window.setTimeout(() => initialFocus.focus(), 0);
}

export function showAiobMenu(
	menu: Menu,
	options: {
		event?: MouseEvent | null;
		anchorEl?: HTMLElement | null;
		fallbackPosition?: { x: number; y: number };
	},
): void {
	if (options.event) {
		menu.showAtMouseEvent(options.event);
		return;
	}
	if (options.anchorEl) {
		const rect = options.anchorEl.getBoundingClientRect();
		menu.showAtPosition({ x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.bottom + 6) });
		return;
	}
	const fallback = options.fallbackPosition || { x: Math.round(window.innerWidth / 2), y: Math.round(window.innerHeight / 2) };
	menu.showAtPosition(fallback);
}

export function bindDialogOverlayDismiss(overlay: HTMLElement): void {
	overlay.addEventListener('click', (ev) => {
		if (ev.target === overlay) overlay.remove();
	});
	overlay.addEventListener('keydown', (ev) => {
		if (ev.key === 'Escape') overlay.remove();
	});
}

export function createDialogRow(card: HTMLElement, labelText: string): HTMLDivElement {
	const row = card.createDiv({ cls: 'aiob-dialog-row' });
	row.createSpan({ cls: 'aiob-dialog-label', text: labelText });
	return row;
}
