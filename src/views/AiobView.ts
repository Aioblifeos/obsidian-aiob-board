import { ItemView, Menu, Notice, Platform, TFile, WorkspaceLeaf } from 'obsidian';
import { renderIcon } from './icon';
import type AiobPlugin from '../main';
import { showAiobMenu, showTextInputDialog } from './dialogs';
import { ChannelGrid } from './components/ChannelGrid';
import { MemoInput } from './components/MemoInput';
import type { SectionId, TabId } from '../models/types';
import { DEFAULT_SECTION_VISIBILITY, DEFAULT_LAYOUT } from '../models/defaults';
import { SectionFactory } from './sections/SectionFactory';
import type { SectionRenderContext } from './sections/Section';
import type { SectionDeps } from './sections/SectionDeps';

/** Obsidian internal APIs not exposed in the public typings. */
interface AppInternals {
	commands: { executeCommandById(id: string): void };
	setting: { open(): void; openTabById(id: string): void };
}

export const VIEW_TYPE_AIOB = 'aiob-board-view';

const WEEKDAYS = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];

export class AiobView extends ItemView {
	private rootEl: HTMLElement | null = null;
	private bodyEl: HTMLElement;
	private memoInput: MemoInput;
	private sidebarChannelGrid: ChannelGrid;
	private lastRenderedRevision = -1;
	private sectionFactory!: SectionFactory;

	constructor(leaf: WorkspaceLeaf, private plugin: AiobPlugin) {
		super(leaf);
		const refresh = () => this.renderBody();
		this.memoInput = new MemoInput(plugin);
		this.sidebarChannelGrid = new ChannelGrid(plugin, refresh);
		this.initSectionFactory();
	}

	private initSectionFactory() {
		const deps: SectionDeps = {
			plugin: this.plugin,
			onRefresh: () => this.renderBody(),
			memoInput: this.memoInput,
			channelGrid: this.sidebarChannelGrid,
		};
		this.sectionFactory = new SectionFactory(deps);
	}

	private isSectionVisible(id: SectionId): boolean {
		const vis = this.plugin.data.config.sectionVisibility || DEFAULT_SECTION_VISIBILITY;
		return vis[id] ?? true;
	}

	private getTabSections(tab: TabId): SectionId[] {
		const layout = this.plugin.data.config.layout || DEFAULT_LAYOUT;
		const entries = Array.isArray(layout.sections) ? layout.sections : DEFAULT_LAYOUT.sections;
		return entries.filter((e) => Array.isArray(e.tabs) && e.tabs.includes(tab)).map((e) => e.id);
	}

	private renderTab(container: HTMLElement, tab: TabId) {
		const sectionIds = this.getTabSections(tab);
		const ctx: SectionRenderContext = {
			tab,
		};
		const mountCls = 'aiob-sb-section';
		for (const id of sectionIds) {
			if (!this.isSectionVisible(id)) continue;
			const section = this.sectionFactory.get(id);
			if (!section) continue;
			try {
				const mount = container.createDiv({ cls: mountCls, attr: { 'data-section': id } });
				section.render(mount, ctx);
			} catch (e) {
				console.error(`Aiob [${tab}/${id}]:`, e);
			}
		}
	}

	getViewType() { return VIEW_TYPE_AIOB; }
	getDisplayText() { return 'Aiob board'; }
	getIcon() { return 'aiob'; }
	navigation = false;

	async onOpen() {
		await super.onOpen();
		const c = this.containerEl.children[1] as HTMLElement;
		c.empty();
		c.addClass('aiob-container');
		this.rootEl = c;
		this.syncViewportHeight();
		if (Platform.isMobile) {
			const onViewportChange = () => this.syncViewportHeight();
			window.addEventListener('resize', onViewportChange);
			this.register(() => window.removeEventListener('resize', onViewportChange));
			if (window.visualViewport) {
				window.visualViewport.addEventListener('resize', onViewportChange);
				window.visualViewport.addEventListener('scroll', onViewportChange);
				this.register(() => window.visualViewport?.removeEventListener('resize', onViewportChange));
				this.register(() => window.visualViewport?.removeEventListener('scroll', onViewportChange));
			}
		}

		const isSidebar = this.getPosition() === 'sidebar';
		if (isSidebar) c.addClass('is-sidebar');
		this.bodyEl = c.createDiv('aiob-scroll-wrap');
		this.renderBody();
	}

	async onClose() {
		await super.onClose();
		this.rootEl?.style.removeProperty('--aiob-vh');
		this.rootEl = null;
	}

	private getPosition(): 'main' | 'sidebar' {
		return this.leaf.getRoot() === this.app.workspace.rootSplit ? 'main' : 'sidebar';
	}

	private syncViewportHeight() {
		if (!this.rootEl) return;
		const height = Math.round(window.visualViewport?.height || window.innerHeight || 0);
		if (height > 0) {
			this.rootEl.style.setProperty('--aiob-vh', `${height}px`);
		}
	}

	private renderBanner(parent: HTMLElement) {
		const banner = parent.createDiv('aiob-banner');
		const bannerImg = this.plugin.data.config.bannerImage;
		if (bannerImg) {
			const rp = bannerImg.startsWith('app://') || bannerImg.startsWith('http')
				? bannerImg
				: this.app.vault.adapter.getResourcePath(bannerImg);
			this.applyBannerImage(banner, rp);
		} else {
			banner.setAttribute('aria-label', '右键或长按可添加 banner');
		}

		banner.addEventListener('contextmenu', (e: MouseEvent) => { e.preventDefault(); this.showBannerMenu(e, banner); });
		let pt: number | null = null;
		banner.addEventListener('touchstart', () => { pt = window.setTimeout(() => this.showBannerMenu(null, banner), 600); }, { passive: true });
		banner.addEventListener('touchend', () => { if (pt) clearTimeout(pt); });
		banner.addEventListener('touchmove', () => { if (pt) clearTimeout(pt); });
		this.attachBannerDrag(banner);

		const now = new Date();
		const month = now.getMonth() + 1;
		const date = now.getDate();
		const weekday = WEEKDAYS[now.getDay()];

		const row = banner.createDiv('aiob-banner-row');

		const lead = row.createDiv('aiob-banner-lead');
		const vaultName = this.app.vault.getName();
		const dn = this.plugin.data.config.displayName || vaultName;
		const title = lead.createSpan('aiob-banner-title');
		title.textContent = dn;
		const dateEl = lead.createEl('a', {
			cls: 'aiob-banner-date',
			text: `${month}月${date}日 · ${weekday}`,
		});
		dateEl.addEventListener('click', (e) => {
			e.preventDefault();
			void (async () => {
				const file = await this.plugin.dailyNoteService.ensureTodayDailyNoteFile();
				if (file) await this.app.workspace.getLeaf(false).openFile(file);
			})();
		});
		title.addEventListener('click', () => {
			const inp = document.createElement('input');
			inp.type = 'text';
			inp.value = dn;
			inp.className = 'aiob-title-input';
			title.replaceWith(inp);
			inp.focus();
			inp.select();
			const save = () => {
				const n = inp.value.trim() || vaultName;
				this.plugin.data.config.displayName = n;
				void this.plugin.saveData(this.plugin.data);
				inp.replaceWith(title);
				title.textContent = n;
			};
			inp.addEventListener('blur', save);
			inp.addEventListener('keydown', (e: KeyboardEvent) => {
				if (e.key === 'Enter') save();
				if (e.key === 'Escape') inp.replaceWith(title);
			});
		});

		const btns = row.createDiv('aiob-banner-btns');
		// Prevent parent banner tooltip from showing when hovering over buttons area
		btns.setAttribute('aria-label', '');
		const themeTargetLabel = () => document.body.classList.contains('theme-dark') ? '浅色' : '深色';
		const buttons: Array<{ icon: string; label: string | (() => string); color: string; fn: (btn: HTMLElement) => void }> = [
			{ icon: 'power', label: '重启', color: 'aiob-btn-teal', fn: () => (this.app as unknown as AppInternals).commands.executeCommandById('app:reload') },
			{ icon: 'sun-moon', label: themeTargetLabel, color: 'aiob-btn-purple', fn: (btn) => {
				const d = document.body.classList.contains('theme-dark');
				document.body.classList.toggle('theme-dark', !d);
				document.body.classList.toggle('theme-light', d);
				btn.setAttribute('aria-label', themeTargetLabel());
			} },
			{ icon: 'settings', label: '设置', color: 'aiob-btn-coral', fn: () => { (this.app as unknown as AppInternals).setting.open(); (this.app as unknown as AppInternals).setting.openTabById('aiob'); } },
		];
		for (const { icon, label, fn, color } of buttons) {
			const lbl = typeof label === 'function' ? label() : label;
			const b = btns.createEl('button', { cls: `aiob-banner-btn ${color}`, attr: { 'aria-label': lbl } });
			renderIcon(b, icon);
			b.addEventListener('click', () => fn(b));
		}
	}

	private showBannerMenu(e: MouseEvent | null, banner: HTMLElement) {
		const menu = new Menu();

		menu.addItem(i => i.setTitle('从设备选择图片').setIcon('image').onClick(() => {
			const input = document.createElement('input');
			input.type = 'file';
			input.accept = 'image/*';
			input.addEventListener('change', () => {
				void (async () => {
					const file = input.files?.[0];
					if (!file) return;
					try {
						const ab = await file.arrayBuffer();
						const ext = file.name.split('.').pop() || 'png';
						const ts = Date.now();
						const dp = `_lifeos_banner_${ts}.${ext}`;
						for (const f of this.app.vault.getFiles()) {
							if (f.name.startsWith('_lifeos_banner_')) await this.app.fileManager.trashFile(f);
						}
						await this.app.vault.createBinary(dp, ab);
						this.plugin.data.config.bannerImage = dp;
						this.plugin.data.config.bannerPosition = { x: 50, y: 50 };
						await this.plugin.saveData(this.plugin.data);
						this.applyBannerImage(banner, this.app.vault.adapter.getResourcePath(dp));
						new Notice('Banner updated');
					} catch (err) {
						new Notice('Upload failed');
						console.error(err);
					}
				})();
			});
			input.click();
		}));

		menu.addItem(i => i.setTitle('输入 vault 内图片路径').setIcon('link').onClick(() => {
			showTextInputDialog('输入 vault 内图片路径', '', (path) => {
				const file = this.app.vault.getAbstractFileByPath(path);
				if (file instanceof TFile) {
					this.plugin.data.config.bannerImage = path;
					this.plugin.data.config.bannerPosition = { x: 50, y: 50 };
					void this.plugin.saveData(this.plugin.data);
					this.applyBannerImage(banner, this.app.vault.adapter.getResourcePath(path));
					new Notice('Banner updated');
				} else {
					new Notice('File not found');
				}
			});
		}));

		menu.addSeparator();
		menu.addItem(i => i.setTitle('恢复默认背景').setIcon('rotate-ccw').onClick(async () => {
			this.plugin.data.config.bannerImage = '';
			this.plugin.data.config.bannerPosition = { x: 50, y: 50 };
			await this.plugin.saveData(this.plugin.data);
			banner.style.removeProperty('--aiob-banner-bg');
			banner.style.removeProperty('--aiob-banner-pos');
			banner.classList.remove('has-image');
			new Notice('Reset to default');
		}));

		showAiobMenu(menu, {
			event: e,
			fallbackPosition: { x: 100, y: 80 },
		});
	}

	private applyBannerImage(banner: HTMLElement, url: string) {
		const pos = this.plugin.data.config.bannerPosition || { x: 50, y: 50 };
		banner.style.setProperty('--aiob-banner-bg', `linear-gradient(rgba(0,0,0,0.5),rgba(0,0,0,0.4)),url('${url}')`);
		banner.style.setProperty('--aiob-banner-pos', `${pos.x}% ${pos.y}%`);
		banner.classList.add('has-image');
		banner.removeAttribute('aria-label');
	}

	private attachBannerDrag(banner: HTMLElement) {
		let dragging = false;
		let moved = false;
		let startX = 0, startY = 0;
		let startBgX = 50, startBgY = 50;
		let pendingX = 50, pendingY = 50;

		const suppressClick = (ev: Event) => {
			ev.stopPropagation();
			ev.preventDefault();
			banner.removeEventListener('click', suppressClick, true);
		};

		banner.addEventListener('pointerdown', (e: PointerEvent) => {
			if (!banner.classList.contains('has-image')) return;
			if (e.button !== 0 && e.pointerType === 'mouse') return;
			const target = e.target as HTMLElement | null;
			if (target && target.closest('.aiob-banner-title, .aiob-banner-date, .aiob-banner-btn, .aiob-title-input')) return;
			const cfgPos = this.plugin.data.config.bannerPosition || { x: 50, y: 50 };
			startBgX = cfgPos.x;
			startBgY = cfgPos.y;
			pendingX = cfgPos.x;
			pendingY = cfgPos.y;
			startX = e.clientX;
			startY = e.clientY;
			dragging = true;
			moved = false;
			try { banner.setPointerCapture(e.pointerId); } catch { /* no-op */ }
			banner.classList.add('is-dragging');
		});

		banner.addEventListener('pointermove', (e: PointerEvent) => {
			if (!dragging) return;
			const dx = e.clientX - startX;
			const dy = e.clientY - startY;
			if (!moved && (Math.abs(dx) > 3 || Math.abs(dy) > 3)) moved = true;
			if (!moved) return;
			const rect = banner.getBoundingClientRect();
			const nx = Math.max(0, Math.min(100, startBgX - (dx / rect.width) * 100));
			const ny = Math.max(0, Math.min(100, startBgY - (dy / rect.height) * 100));
			pendingX = nx;
			pendingY = ny;
			banner.style.setProperty('--aiob-banner-pos', `${nx}% ${ny}%`);
		});

		const finish = (e: PointerEvent) => {
			if (!dragging) return;
			dragging = false;
			try { banner.releasePointerCapture(e.pointerId); } catch { /* no-op */ }
			banner.classList.remove('is-dragging');
			if (moved) {
				this.plugin.data.config.bannerPosition = { x: pendingX, y: pendingY };
				void this.plugin.saveData(this.plugin.data);
				banner.addEventListener('click', suppressClick, true);
			}
		};
		banner.addEventListener('pointerup', finish);
		banner.addEventListener('pointercancel', finish);
	}

	private renderSidebarHeader(sec: HTMLElement) {
		const row1 = sec.createDiv('aiob-sb-row1');
		const title = row1.createSpan({ cls: 'aiob-sb-title' });
		const vaultName = this.app.vault.getName();
		const dn = this.plugin.data.config.displayName || vaultName;
		title.textContent = dn;
		title.addEventListener('click', () => {
			const inp = document.createElement('input');
			inp.type = 'text';
			inp.value = this.plugin.data.config.displayName || vaultName;
			inp.className = 'aiob-title-input aiob-sb-title-input';
			title.replaceWith(inp);
			inp.focus();
			inp.select();
			const save = () => {
				const n = inp.value.trim() || vaultName;
				this.plugin.data.config.displayName = n;
				void this.plugin.saveData(this.plugin.data);
				inp.replaceWith(title);
				title.textContent = n;
			};
			inp.addEventListener('blur', save);
			inp.addEventListener('keydown', (e: KeyboardEvent) => {
				if (e.key === 'Enter') save();
				if (e.key === 'Escape') inp.replaceWith(title);
			});
		});
		const btns = row1.createDiv('aiob-sb-actions');
		for (const { icon, label, fn, color } of [
			{ icon: 'power', label: '重启', color: 'aiob-btn-teal', fn: () => (this.app as unknown as AppInternals).commands.executeCommandById('app:reload') },
			{ icon: 'sun-moon', label: '主题', color: 'aiob-btn-purple', fn: () => { const d = document.body.classList.contains('theme-dark'); document.body.classList.toggle('theme-dark', !d); document.body.classList.toggle('theme-light', d); } },
			{ icon: 'settings', label: '设置', color: 'aiob-btn-coral', fn: () => { (this.app as unknown as AppInternals).setting.open(); (this.app as unknown as AppInternals).setting.openTabById('aiob'); } },
		]) {
			const b = btns.createEl('button', { cls: `aiob-banner-btn aiob-sb-btn ${color}`, attr: { 'aria-label': label } });
			renderIcon(b, icon);
			b.addEventListener('click', fn);
		}
	}

	private renderBody() {
		this.bodyEl.empty();

		if (this.getPosition() === 'sidebar') {
			try {
				this.renderSidebarHeader(this.bodyEl.createDiv('aiob-sb-section'));
			} catch (e) {
				console.error('Aiob Sidebar [header]:', e);
			}
			this.renderTab(this.bodyEl, 'sidebar');
		} else {
			const bannerSec = this.bodyEl.createDiv('aiob-sb-section aiob-banner-section');
			this.renderBanner(bannerSec);
			this.renderTab(this.bodyEl, 'home');
		}
		this.renderBodyFooterDate();
	}

	private renderBodyFooterDate() {
		const now = new Date();
		const month = now.getMonth() + 1;
		const date = now.getDate();
		const weekday = WEEKDAYS[now.getDay()];
		const footer = this.bodyEl.createDiv('aiob-body-footer-date');
		footer.setText(`${now.getFullYear()}年${month}月${date}日 · ${weekday}`);
	}

	refresh() {
		const rev = this.plugin.getDataRevision() + this.plugin.getVaultPropertyRevision();
		if (rev === this.lastRenderedRevision) return;
		this.lastRenderedRevision = rev;
		this.renderBody();
	}
}
