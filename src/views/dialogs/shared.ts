import { renderIcon } from '../icon';

export function bindDialogEnter(
	overlay: HTMLElement,
	onSubmit: () => void,
	shouldIgnore?: (target: EventTarget | null) => boolean,
): void {
	overlay.addEventListener('keydown', (ke) => {
		if (ke.key === 'Escape') {
			overlay.remove();
			return;
		}
		if (ke.key !== 'Enter') return;
		if (shouldIgnore?.(ke.target)) return;
		ke.preventDefault();
		onSubmit();
	});
}

export function focusAndMaybeSelect(el: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | null): void {
	if (!el) return;
	window.setTimeout(() => {
		el.focus();
		if (el instanceof HTMLInputElement && ['text', 'number', 'date', 'time', 'datetime-local'].includes(el.type)) {
			el.select();
		}
		if (el instanceof HTMLTextAreaElement) {
			el.select();
		}
	}, 0);
}

function applyDialogEnterKeyHints(scope: HTMLElement): void {
	scope.querySelectorAll('input, textarea').forEach((field) => {
		if (!(field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement)) return;
		if (field instanceof HTMLInputElement && ['checkbox', 'radio', 'range', 'file'].includes(field.type)) return;
		field.setAttribute('enterkeyhint', 'send');
	});
}

export function createDialogSubmitRow(
	card: HTMLElement,
	onSubmit: () => void | Promise<void>,
	options?: {
		label?: string;
		title?: string;
		onCancel?: () => void;
		cancelLabel?: string;
	},
): HTMLButtonElement {
	applyDialogEnterKeyHints(card);
	const label = options?.label || '发送';
	const row = card.createDiv({ cls: 'aiob-dialog-submit-row' });
	if (options?.onCancel) {
		const cancelBtn = row.createEl('button', {
			cls: 'aiob-dialog-submit-secondary',
			text: options.cancelLabel || '取消',
			attr: {
				type: 'button',
				'aria-label': options.cancelLabel || '取消',
			},
		});
		cancelBtn.addEventListener('click', () => options.onCancel?.());
	}
	const button = row.createEl('button', {
		cls: 'aiob-dialog-submit',
		attr: {
			type: 'button',
			'aria-label': options?.title || label,
		},
	});
	renderIcon(button, 'send', 'md').addClass('aiob-dialog-submit-icon');
	button.createSpan({ cls: 'aiob-dialog-submit-text', text: label });

	let submitting = false;
	button.addEventListener('click', async () => {
		if (submitting) return;
		submitting = true;
		button.disabled = true;
		button.addClass('is-loading');
		try {
			await onSubmit();
		} finally {
			if (button.isConnected) {
				submitting = false;
				button.disabled = false;
				button.removeClass('is-loading');
			}
		}
	});
	return button;
}

/**
 * Compact "pill" field used in create/edit dialogs: label + current value + caret.
 * Click handler receives the button element (anchor for popovers/menus).
 * Returns setValue(text, active) to refresh the pill after the user picks something.
 */
export function createPillButton(
	parent: HTMLElement,
	label: string,
	initialValueText: string,
	onClick: (el: HTMLButtonElement) => void,
): { el: HTMLButtonElement; setValue: (text: string, active: boolean) => void } {
	const el = parent.createEl('button', {
		cls: 'aiob-todo-field-pill',
		attr: { type: 'button' },
	});
	el.createSpan({ cls: 'aiob-todo-field-pill-label', text: label });
	const valueEl = el.createSpan({ cls: 'aiob-todo-field-pill-value', text: initialValueText });
	el.createSpan({ cls: 'aiob-todo-field-pill-caret', text: '▾' });
	el.addEventListener('click', (e) => {
		e.preventDefault();
		onClick(el);
	});
	const setValue = (text: string, active: boolean) => {
		valueEl.textContent = text;
		el.classList.toggle('is-active', active);
	};
	return { el, setValue };
}

export function createDialogTextarea(
	parent: HTMLElement,
	defaultValue: string,
	placeholder = '',
	extraClass = '',
): HTMLTextAreaElement {
	const textarea = parent.createEl('textarea', {
		cls: ['aiob-dialog-input', 'aiob-dialog-textarea', extraClass].filter(Boolean).join(' '),
		attr: { placeholder, rows: '1', enterkeyhint: 'send' },
	});
	textarea.value = defaultValue;
	return textarea;
}
