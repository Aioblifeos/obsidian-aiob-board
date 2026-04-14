import type AiobPlugin from '../main';

// ── 29 preset colors + "none" ──
const PRESET_COLORS = [
	{ name: 'Red',       bg: 'rgba(220,  50,  50, 0.15)', label: '红' },
	{ name: 'Coral',     bg: 'rgba(255, 110,  80, 0.15)', label: '珊瑚' },
	{ name: 'Orange',    bg: 'rgba(255, 150,  50, 0.15)', label: '橙' },
	{ name: 'Amber',     bg: 'rgba(255, 190,  20, 0.15)', label: '琥珀' },
	{ name: 'Yellow',    bg: 'rgba(230, 210,  20, 0.15)', label: '黄' },
	{ name: 'Gold',      bg: 'rgba(200, 165,  30, 0.15)', label: '金' },
	{ name: 'Lime',      bg: 'rgba(110, 210,  60, 0.15)', label: '黄绿' },
	{ name: 'Green',     bg: 'rgba( 40, 180,  90, 0.15)', label: '绿' },
	{ name: 'Emerald',   bg: 'rgba( 20, 160, 110, 0.15)', label: '翠绿' },
	{ name: 'Teal',      bg: 'rgba( 20, 175, 155, 0.15)', label: '青绿' },
	{ name: 'Cyan',      bg: 'rgba(  0, 200, 235, 0.15)', label: '青' },
	{ name: 'Sky',       bg: 'rgba( 40, 165, 235, 0.15)', label: '天蓝' },
	{ name: 'Blue',      bg: 'rgba( 40, 110, 255, 0.15)', label: '蓝' },
	{ name: 'Royal',     bg: 'rgba( 60,  80, 225, 0.15)', label: '宝蓝' },
	{ name: 'Indigo',    bg: 'rgba( 90,  50, 210, 0.15)', label: '靛蓝' },
	{ name: 'Violet',    bg: 'rgba(140,  50, 225, 0.15)', label: '紫' },
	{ name: 'Magenta',   bg: 'rgba(215,  50, 175, 0.15)', label: '品红' },
	{ name: 'Pink',      bg: 'rgba(245,  90, 155, 0.15)', label: '粉' },
	{ name: 'Rose',      bg: 'rgba(245, 110, 125, 0.15)', label: '玫瑰' },
	{ name: 'Brown',     bg: 'rgba(165,  95,  45, 0.15)', label: '棕' },
	{ name: 'Tan',       bg: 'rgba(195, 155,  95, 0.15)', label: '棕黄' },
	{ name: 'Sand',      bg: 'rgba(215, 190, 135, 0.15)', label: '沙' },
	{ name: 'Sage',      bg: 'rgba(125, 165, 115, 0.15)', label: '鼠尾草' },
	{ name: 'Lavender',  bg: 'rgba(175, 155, 225, 0.15)', label: '薰衣草' },
	{ name: 'Silver',    bg: 'rgba(195, 195, 195, 0.15)', label: '银灰' },
	{ name: 'Gray',      bg: 'rgba(145, 145, 145, 0.15)', label: '灰' },
	{ name: 'SlateGray', bg: 'rgba(105, 125, 145, 0.15)', label: '石板灰' },
	{ name: 'DarkGray',  bg: 'rgba( 75,  75,  75, 0.15)', label: '深灰' },
	{ name: 'Charcoal',  bg: 'rgba( 55,  55,  65, 0.15)', label: '炭灰' },
];

export { PRESET_COLORS };

type FrontmatterColorMap = Record<string, Record<string, string | null>>;

export class FrontmatterColorizerService {
	private hashCache = new Map<string, string>();
	private mutationObserver: MutationObserver | null = null;
	private debouncedApply: () => void;
	private styleEl: HTMLStyleElement | null = null;

	constructor(private plugin: AiobPlugin) {
		this.debouncedApply = this.debounce(() => this.applyColors(), 100);
	}

	start(): void {
		this.addDynamicCSS();
		this.setupMutationObserver();
		setTimeout(() => this.applyColors(), 200);

		this.plugin.registerEvent(
			this.plugin.app.workspace.on('layout-change', () => this.debouncedApply()),
		);
		this.plugin.registerEvent(
			this.plugin.app.workspace.on('active-leaf-change', () => this.debouncedApply()),
		);
		this.plugin.registerEvent(
			this.plugin.app.workspace.on('file-open', () => this.debouncedApply()),
		);
	}

	destroy(): void {
		this.mutationObserver?.disconnect();
		this.mutationObserver = null;
		this.hashCache.clear();
		this.styleEl?.remove();
		this.styleEl = null;
		this.cleanupDOM();
	}

	// ── Public API ──

	getColorMap(): FrontmatterColorMap {
		return this.plugin.data.config.frontmatterColorMap ?? {};
	}

	private setColorMap(map: FrontmatterColorMap): void {
		this.plugin.data.config.frontmatterColorMap = map;
	}

	refreshColors(): void {
		this.hashCache.clear();
		this.cleanupDOM();
		this.applyColors();
	}

	getPresetColors(): typeof PRESET_COLORS {
		return PRESET_COLORS;
	}

	// ── Color resolution ──

	getColorForValue(value: string, propertyKey: string): string | null {
		const normalized = value.trim();
		const colorMap = this.getColorMap();
		const fieldMap = colorMap[propertyKey];

		if (fieldMap && normalized in fieldMap) {
			const configured = fieldMap[normalized];
			if (configured === 'none') return null;
			if (configured) return configured;
		}

		// Auto-hash
		const cacheKey = `${propertyKey}:${normalized}`;
		if (this.hashCache.has(cacheKey)) return this.hashCache.get(cacheKey)!;

		const colors = PRESET_COLORS.map(c => c.bg);
		let hash = 0;
		for (let i = 0; i < cacheKey.length; i++) {
			hash = (hash << 5) - hash + cacheKey.charCodeAt(i);
			hash = hash & hash;
		}
		const color = colors[Math.abs(hash) % colors.length];
		this.hashCache.set(cacheKey, color);
		return color;
	}

	// ── DOM coloring ──

	private applyColors(): void {
		document.querySelectorAll('.multi-select-pill').forEach(pill => {
			this.applyColorToPill(pill as HTMLElement);
		});
		document.querySelectorAll('.multi-select-input').forEach(input => {
			this.applyColorToInput(input as HTMLInputElement);
		});
		this.applyColorsToSuggestions();
	}

	private applyColorToPill(pill: HTMLElement): void {
		const contentEl = pill.querySelector('.multi-select-pill-content');
		const text = (contentEl ? contentEl.textContent : pill.textContent)?.trim();
		if (!text) return;

		let propertyKey = 'unknown';
		const propEl = pill.closest('.metadata-property');
		if (propEl) propertyKey = propEl.getAttribute('data-property-key') ?? 'unknown';

		if (pill.getAttribute('data-fc-value') === text &&
			pill.getAttribute('data-fc-property') === propertyKey) return;

		pill.setAttribute('data-fc-value', text);
		pill.setAttribute('data-fc-property', propertyKey);

		const color = this.getColorForValue(text, propertyKey);
		if (color) {
			pill.style.backgroundColor = color;
			pill.style.color = '#4A5568';
			pill.style.borderRadius = '12px';
			pill.style.padding = '2px 8px';
			pill.style.margin = '2px';
			pill.style.border = '1px solid rgba(255, 255, 255, 0.2)';
		} else {
			pill.style.backgroundColor = '';
			pill.style.color = '';
			pill.style.border = '';
		}
	}

	private applyColorToInput(input: HTMLInputElement): void {
		const text = input.value?.trim();
		if (!text) return;
		if (input.getAttribute('data-fc-value') === text) return;

		let propertyKey = 'unknown';
		const propEl = input.closest('.metadata-property');
		if (propEl) propertyKey = propEl.getAttribute('data-property-key') ?? 'unknown';

		input.setAttribute('data-fc-value', text);
		const color = this.getColorForValue(text, propertyKey);
		if (color) {
			input.style.backgroundColor = color;
			input.style.color = '#4A5568';
			input.style.borderRadius = '8px';
			input.style.border = '1px solid rgba(255, 255, 255, 0.2)';
		} else {
			input.style.backgroundColor = '';
			input.style.color = '';
			input.style.border = '';
		}
	}

	private applyColorsToSuggestions(): void {
		const active = document.activeElement;
		if (!active) return;

		const isFrontmatterInput =
			active.classList.contains('multi-select-input') ||
			active.classList.contains('suggestion-input');
		if (!isFrontmatterInput) return;

		let propertyKey = 'unknown';
		const metaPropEl = active.closest('.metadata-property');
		if (metaPropEl) propertyKey = metaPropEl.getAttribute('data-property-key') ?? 'unknown';

		if (propertyKey === 'unknown') {
			const baseCellEl = active.closest('[data-col-id], [data-field], .bases-td');
			if (baseCellEl) {
				propertyKey =
					(baseCellEl as HTMLElement).getAttribute('data-col-id') ||
					(baseCellEl as HTMLElement).getAttribute('data-field') ||
					'unknown';
			}
		}

		document.querySelectorAll('.suggestion-item, .multi-select-suggestion-item').forEach(item => {
			const el = item as HTMLElement;
			const text = el.textContent?.trim();
			if (!text) return;

			const color = this.getColorForValue(text, propertyKey);
			if (color) {
				el.style.backgroundColor = color;
				el.style.color = '#4A5568';
				el.style.borderRadius = '8px';
				el.style.padding = '6px 12px';
				el.style.margin = '2px 4px';
				el.setAttribute('data-fc-value', text.toLowerCase());
				el.classList.add('fc-suggestion-item');
			} else {
				el.style.backgroundColor = '';
				el.style.color = '';
			}
		});
	}

	// ── Infrastructure ──

	private setupMutationObserver(): void {
		const debouncedApply = this.debounce(() => this.applyColors(), 50);
		this.mutationObserver = new MutationObserver((mutations) => {
			for (const m of mutations) {
				if (m.addedNodes.length > 0 ||
					(m.type === 'attributes' && ['value', 'data-value'].includes(m.attributeName ?? ''))) {
					debouncedApply();
					break;
				}
			}
		});
		this.mutationObserver.observe(document.body, {
			childList: true,
			subtree: true,
			attributes: true,
			attributeFilter: ['value', 'data-value', 'class'],
		});
	}

	private addDynamicCSS(): void {
		this.styleEl?.remove();
		const style = document.createElement('style');
		style.id = 'aiob-board-fc-css';
		style.textContent = `
			.multi-select-pill {
				display: inline-flex !important;
				width: fit-content !important;
				border-radius: 12px !important;
				padding: 2px 8px !important;
				margin: 2px !important;
				font-size: 0.85em !important;
				font-weight: 500 !important;
				border: 1px solid rgba(255,255,255,0.2) !important;
				transition: all 0.15s ease !important;
			}
			.multi-select-pill:hover {
				opacity: 0.85;
				transform: translateY(-1px);
				box-shadow: 0 2px 6px rgba(0,0,0,0.08);
			}
			.fc-suggestion-item {
				border-radius: 8px !important;
				padding: 6px 12px !important;
				margin: 2px 4px !important;
				font-size: 0.9em !important;
				border: 1px solid rgba(255,255,255,0.2) !important;
				transition: transform 0.12s ease, box-shadow 0.12s ease, filter 0.12s ease !important;
			}
			.fc-suggestion-item:hover {
				transform: translateX(3px) !important;
				filter: brightness(0.92) !important;
				box-shadow: 2px 2px 6px rgba(0,0,0,0.08) !important;
			}
			.fc-suggestion-item.is-selected {
				transform: translateX(3px) !important;
				filter: brightness(0.88) !important;
				box-shadow: 2px 2px 8px rgba(0,0,0,0.12) !important;
			}
		`;
		document.head.appendChild(style);
		this.styleEl = style;
	}

	private cleanupDOM(): void {
		document.querySelectorAll('.multi-select-pill[data-fc-value]').forEach(pill => {
			const el = pill as HTMLElement;
			el.removeAttribute('data-fc-value');
			el.removeAttribute('data-fc-property');
			Object.assign(el.style, { backgroundColor: '', color: '', borderRadius: '', padding: '', margin: '', border: '' });
		});
		document.querySelectorAll('.multi-select-input[data-fc-value]').forEach(input => {
			const el = input as HTMLElement;
			el.removeAttribute('data-fc-value');
			Object.assign(el.style, { backgroundColor: '', color: '', borderRadius: '', border: '' });
		});
		document.querySelectorAll('.fc-suggestion-item').forEach(item => {
			const el = item as HTMLElement;
			el.removeAttribute('data-fc-value');
			el.classList.remove('fc-suggestion-item');
			Object.assign(el.style, { backgroundColor: '', color: '', borderRadius: '', padding: '', margin: '' });
		});
	}

	private debounce(func: () => void, wait: number): () => void {
		let timeout: number | undefined;
		return () => {
			clearTimeout(timeout);
			timeout = window.setTimeout(func, wait);
		};
	}
}
