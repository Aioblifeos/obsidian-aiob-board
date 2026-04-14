import { Menu, Notice } from 'obsidian';
import type AiobPlugin from '../../main';
import type { ChannelDef } from '../../models/types';
import { getChannelPathSuggestions, openChannelPath } from '../../utils/channelPaths';
import { bindDialogOverlayDismiss, createDialogRow, createDialogShell, createDialogSubmitRow, enhanceDialogTextareas, normalizeDialogWikilinks, showAiobMenu } from '../dialogs';
import { Component } from './Component';

export class ChannelGrid extends Component {
	private draggedChannelId: string | null = null;
	private touchDraggedChannelId: string | null = null;
	private touchDraggedItem: HTMLElement | null = null;
	private touchDropItem: HTMLElement | null = null;
	private touchDropGrid: HTMLElement | null = null;

	constructor(
		plugin: AiobPlugin,
		private onRefresh: () => void,
	) {
		super(plugin);
	}

	render(container: HTMLElement): void {
		this.el = container;
		container.empty();
		const channels = this.plugin.data.config.channels;
		const coreIds = new Set(this.plugin.data.config.channelCoreIds || []);

		const sec = container.createDiv('aiob-record-channels-shell');
		sec.createDiv({ cls: 'aiob-sb-section-title', text: this.plugin.label('channels') });

		const renderGrid = (entries: ChannelDef[], groupKey: 'core' | 'common', includeAdd = false) => {
			if (!entries.length && !includeAdd) return;
			const grid = sec.createDiv(`aiob-channel-grid aiob-channel-grid-${groupKey}`);
			grid.setAttribute('aria-label', `${groupKey} Channels`);
			grid.dataset.channelGroup = groupKey;

			grid.addEventListener('dragover', (e: DragEvent) => {
				if (!this.draggedChannelId) return;
				e.preventDefault();
				grid.addClass('drag-over');
			});
			grid.addEventListener('dragleave', () => grid.removeClass('drag-over'));
			grid.addEventListener('drop', (e: DragEvent) => {
				if (!this.draggedChannelId) return;
				e.preventDefault();
				grid.removeClass('drag-over');
				void this.moveChannelToGroup(this.draggedChannelId, groupKey);
			});

			for (const ch of entries) {
				const i = channels.findIndex((entry) => entry.id === ch.id);
				if (i === -1) continue;

				const item = grid.createDiv('aiob-channel-item');
				item.setAttribute('draggable', 'true');
				item.dataset.idx = String(i);
				item.dataset.channelId = ch.id;
				item.dataset.channelGroup = groupKey;

				const orb = item.createSpan({ cls: 'aiob-channel-orb' });
				orb.createSpan({ text: ch.icon, cls: 'aiob-channel-icon' });
				item.createSpan({ text: ch.name, cls: 'aiob-channel-name' });
				item.setAttribute('aria-label', ch.name);
				item.setAttribute('title', ch.name);

				item.addEventListener('click', () => {
					if (this.consumeLongPress(item)) return;
					void this.openChannel(ch);
				});
				item.addEventListener('contextmenu', (e: MouseEvent) => {
					e.preventDefault();
					this.showChannelMenuAtMouseEvent(e, ch);
				});
				this.bindTouchInteraction(item, ch);
				item.addEventListener('dragstart', (e) => {
					e.dataTransfer!.setData('text/plain', String(i));
					this.draggedChannelId = ch.id;
					item.classList.add('dragging');
				});
				item.addEventListener('dragend', () => {
					this.draggedChannelId = null;
					this.clearChannelDragVisualState();
				});
				item.addEventListener('dragover', (e) => { e.preventDefault(); item.classList.add('drag-over'); });
				item.addEventListener('dragleave', () => item.classList.remove('drag-over'));
				item.addEventListener('drop', (e) => {
					if (!this.draggedChannelId) return;
					e.preventDefault();
					item.classList.remove('drag-over');
					const toIdx = i;
					void this.reorderChannel(this.draggedChannelId, toIdx, groupKey);
				});
			}

			if (includeAdd) {
				const add = grid.createDiv('aiob-channel-item aiob-channel-add');
				const addOrb = add.createSpan({ cls: 'aiob-channel-orb' });
				addOrb.createSpan({ text: '➕', cls: 'aiob-channel-icon' });
				add.setAttribute('aria-label', '添加 Channel');
				add.setAttribute('title', '添加 Channel');
				add.createSpan({ text: '添加', cls: 'aiob-channel-name' });
				add.addEventListener('click', () => {
					const newCh = { id: `ch_${Date.now()}`, name: '', icon: '📂', path: '' };
					this.showChannelDialog(newCh, true);
				});
			}
		};

		renderGrid(channels.filter((ch) => coreIds.has(ch.id)), 'core');
		renderGrid(channels.filter((ch) => !coreIds.has(ch.id)), 'common', true);
	}

	// ── Channel operations ──

	private showChannelMenuAtMouseEvent(event: MouseEvent, channel: ChannelDef): void {
		const menu = new Menu();
		this.buildChannelMenu(menu, channel);
		showAiobMenu(menu, { event });
	}

	private showChannelMenuAt(target: HTMLElement, channel: ChannelDef): void {
		const menu = new Menu();
		this.buildChannelMenu(menu, channel);
		showAiobMenu(menu, { anchorEl: target });
	}

	private buildChannelMenu(menu: Menu, channel: ChannelDef): void {
		menu.addItem((entry) => entry
			.setTitle('编辑')
			.setIcon('pencil')
			.onClick(() => this.showChannelDialog(channel)));
		menu.addItem((entry) => entry
			.setTitle('删除')
			.setIcon('trash')
			.onClick(async () => {
				await this.deleteChannel(channel.id);
			}));
	}

	private async deleteChannel(channelId: string): Promise<void> {
		this.plugin.data.config.channels = this.plugin.data.config.channels.filter((entry) => entry.id !== channelId);
		this.setChannelCoreState(channelId, false);
		await this.plugin.saveData(this.plugin.data);
		this.onRefresh();
	}

	private bindTouchInteraction(target: HTMLElement, channel: ChannelDef): void {
		let timer: number | null = null;
		let startX = 0;
		let startY = 0;
		let longPressed = false;
		let dragging = false;
		const moveThreshold = 10;
		const clear = () => {
			if (timer) {
				window.clearTimeout(timer);
				timer = null;
			}
		};
		target.addEventListener('touchstart', (event: TouchEvent) => {
			const touch = event.touches[0];
			if (!touch) return;
			clear();
			startX = touch.clientX;
			startY = touch.clientY;
			longPressed = false;
			dragging = false;
			timer = window.setTimeout(() => {
				timer = null;
				longPressed = true;
				target.dataset.lifeosLongPress = '1';
				target.dataset.lifeosSuppressContextMenuUntil = String(Date.now() + 900);
			}, 560);
		}, { passive: true });
		target.addEventListener('touchmove', (event: TouchEvent) => {
			const touch = event.touches[0];
			if (!touch) return;
			const deltaX = touch.clientX - startX;
			const deltaY = touch.clientY - startY;
			const distance = Math.hypot(deltaX, deltaY);
			if (!longPressed && distance > moveThreshold) {
				clear();
				return;
			}
			if (!longPressed) return;
			if (distance <= moveThreshold && !dragging) return;
			if (!dragging) {
				dragging = true;
				target.dataset.lifeosLongPress = 'drag';
				this.beginTouchDrag(channel.id, target);
			}
			event.preventDefault();
			this.updateTouchDropState(touch.clientX, touch.clientY);
		}, { passive: false });
		target.addEventListener('touchend', (event: TouchEvent) => {
			const touch = event.changedTouches[0];
			clear();
			if (longPressed && !dragging) {
				target.dataset.lifeosLongPress = '1';
				this.showChannelMenuAt(target, channel);
			} else if (dragging && touch) {
				event.preventDefault();
				void this.finishTouchDrag(touch.clientX, touch.clientY);
			}
			longPressed = false;
			dragging = false;
			window.setTimeout(() => {
				delete target.dataset.lifeosLongPress;
				this.clearTouchDragState();
			}, 0);
		}, { passive: false });
		target.addEventListener('touchcancel', () => {
			clear();
			longPressed = false;
			dragging = false;
			delete target.dataset.lifeosLongPress;
			this.clearTouchDragState();
		}, { passive: true });
		target.addEventListener('contextmenu', (event: MouseEvent) => {
			const suppressUntil = Number(target.dataset.lifeosSuppressContextMenuUntil || '0');
			if (suppressUntil <= Date.now()) return;
			delete target.dataset.lifeosSuppressContextMenuUntil;
			event.preventDefault();
			event.stopPropagation();
			event.stopImmediatePropagation();
		}, { capture: true });
	}

	private consumeLongPress(target: HTMLElement): boolean {
		if (!target.dataset.lifeosLongPress) return false;
		delete target.dataset.lifeosLongPress;
		return true;
	}

	private beginTouchDrag(channelId: string, target: HTMLElement): void {
		this.clearTouchDragState();
		this.touchDraggedChannelId = channelId;
		this.touchDraggedItem = target;
		target.classList.add('dragging');
	}

	private updateTouchDropState(clientX: number, clientY: number): void {
		this.clearChannelDropTargets();
		if (!this.el || !this.touchDraggedItem) return;
		const pointed = document.elementFromPoint(clientX, clientY);
		const pointedItem = pointed instanceof HTMLElement
			? pointed.closest('.aiob-channel-item[data-channel-id]')
			: null;
		if (pointedItem instanceof HTMLElement && pointedItem !== this.touchDraggedItem && this.el.contains(pointedItem)) {
			pointedItem.classList.add('drag-over');
			this.touchDropItem = pointedItem;
			const parentGrid = pointedItem.closest('.aiob-channel-grid');
			if (parentGrid instanceof HTMLElement) {
				parentGrid.classList.add('drag-over');
				this.touchDropGrid = parentGrid;
			}
			return;
		}
		const pointedGrid = pointed instanceof HTMLElement
			? pointed.closest('.aiob-channel-grid')
			: null;
		if (pointedGrid instanceof HTMLElement && this.el.contains(pointedGrid)) {
			pointedGrid.classList.add('drag-over');
			this.touchDropGrid = pointedGrid;
		}
	}

	private clearChannelDropTargets(): void {
		if (this.touchDropItem) {
			this.touchDropItem.classList.remove('drag-over');
			this.touchDropItem = null;
		}
		if (this.touchDropGrid) {
			this.touchDropGrid.classList.remove('drag-over');
			this.touchDropGrid = null;
		}
		if (!this.el) return;
		this.el.querySelectorAll('.aiob-channel-item.drag-over').forEach((el) => el.classList.remove('drag-over'));
		this.el.querySelectorAll('.aiob-channel-grid.drag-over').forEach((el) => el.classList.remove('drag-over'));
	}

	private clearChannelDragVisualState(): void {
		if (this.touchDraggedItem) this.touchDraggedItem.classList.remove('dragging');
		if (this.el) {
			this.el.querySelectorAll('.aiob-channel-item.dragging').forEach((el) => el.classList.remove('dragging'));
		}
		this.clearChannelDropTargets();
	}

	private clearTouchDragState(): void {
		this.clearChannelDragVisualState();
		this.touchDraggedChannelId = null;
		this.touchDraggedItem = null;
	}

	private getChannelGroupKey(target: Element | null): 'core' | 'common' | null {
		if (!(target instanceof HTMLElement)) return null;
		return target.dataset.channelGroup === 'core' || target.dataset.channelGroup === 'common'
			? target.dataset.channelGroup
			: null;
	}

	private async finishTouchDrag(clientX: number, clientY: number): Promise<void> {
		const draggedChannelId = this.touchDraggedChannelId;
		if (!draggedChannelId) {
			this.clearTouchDragState();
			return;
		}
		this.updateTouchDropState(clientX, clientY);
		const dropItem = this.touchDropItem;
		const dropGrid = this.touchDropGrid;
		this.clearTouchDragState();
		if (dropItem instanceof HTMLElement) {
			const toIdx = Number.parseInt(dropItem.dataset.idx || '-1', 10);
			const groupKey = this.getChannelGroupKey(dropItem);
			if (groupKey && Number.isInteger(toIdx) && toIdx >= 0) {
				await this.reorderChannel(draggedChannelId, toIdx, groupKey);
				return;
			}
		}
		const groupKey = this.getChannelGroupKey(dropGrid);
		if (groupKey) {
			await this.moveChannelToGroup(draggedChannelId, groupKey);
		}
	}

	private setChannelCoreState(channelId: string, isCore: boolean): void {
		const current = Array.isArray(this.plugin.data.config.channelCoreIds) ? [...this.plugin.data.config.channelCoreIds] : [];
		const next = current.filter((id) => id !== channelId);
		if (isCore) next.push(channelId);
		this.plugin.data.config.channelCoreIds = next;
	}

	private async reorderChannel(channelId: string, toIdx: number, groupKey: 'core' | 'common'): Promise<void> {
		const channels = this.plugin.data.config.channels;
		const fromIdx = channels.findIndex((entry) => entry.id === channelId);
		if (fromIdx === -1 || fromIdx === toIdx) {
			await this.moveChannelToGroup(channelId, groupKey);
			return;
		}
		const [moved] = channels.splice(fromIdx, 1);
		channels.splice(toIdx, 0, moved);
		this.setChannelCoreState(moved.id, groupKey === 'core');
		await this.plugin.saveData(this.plugin.data);
		this.onRefresh();
	}

	private async moveChannelToGroup(channelId: string, groupKey: 'core' | 'common'): Promise<void> {
		this.setChannelCoreState(channelId, groupKey === 'core');
		await this.plugin.saveData(this.plugin.data);
		this.onRefresh();
	}

	private async openChannel(channel: ChannelDef): Promise<void> {
		const success = await openChannelPath(this.plugin.app, channel.path);
		if (!success) {
			new Notice(`无法打开: ${channel.path}`);
			return;
		}
	}

	private showChannelDialog(ch: ChannelDef, isNew = false): void {
		const { overlay, card } = createDialogShell(isNew ? '添加 Channel' : '编辑 Channel', 'aiob-dialog-card-form aiob-dialog-card-wide');
		const titleRow = createDialogRow(card, '名称');
		const titleInput = titleRow.createEl('textarea', {
			cls: 'aiob-dialog-input aiob-dialog-textarea aiob-dialog-textarea-compact',
			attr: { placeholder: '例如 📂 Tasks', rows: '1' },
		});
		titleInput.value = [ch.icon, ch.name].filter(Boolean).join(' ').trim();
		const pathRow = createDialogRow(card, '路径');
		pathRow.addClass('is-last');
		const pathField = pathRow.createDiv('aiob-channel-path-field');
		const pathInput = pathField.createEl('textarea', {
			cls: 'aiob-dialog-input aiob-dialog-textarea',
			attr: { placeholder: '如 ♟️Tasks.base#表格 或 /', rows: '1' },
		});
		pathInput.value = ch.path;
		const suggestionWrap = pathField.createDiv('aiob-channel-path-suggestions');
		const suggestionTitle = suggestionWrap.createDiv({ cls: 'aiob-channel-path-suggestions-title', text: '路径建议' });
		const suggestionList = suggestionWrap.createDiv('aiob-channel-path-suggestions-list');
		let pathSuggestRequestId = 0;
			const renderPathSuggestions = async () => {
				const requestId = ++pathSuggestRequestId;
				const currentValue = normalizeDialogWikilinks(pathInput.value).trim();
				const suggestions = await getChannelPathSuggestions(this.plugin.app, currentValue, 9999);
				if (requestId !== pathSuggestRequestId || !overlay.isConnected) return;
				suggestionList.empty();
			suggestionWrap.classList.toggle('is-empty', suggestions.length === 0);
			suggestionTitle.setText(currentValue ? '匹配建议' : '常用建议');
			for (const suggestion of suggestions) {
				const button = suggestionList.createEl('button', {
					cls: 'aiob-channel-path-suggestion',
					attr: { type: 'button' },
				});
				if (suggestion.value === currentValue) button.addClass('is-active');
				button.createDiv({ cls: 'aiob-channel-path-suggestion-value', text: suggestion.label });
				button.addEventListener('click', () => {
					pathInput.value = suggestion.value;
					pathInput.dispatchEvent(new Event('input'));
					pathInput.focus();
				});
			}
		};
		pathInput.addEventListener('focus', () => { void renderPathSuggestions(); });
		pathInput.addEventListener('input', () => { void renderPathSuggestions(); });
		const submit = () => {
			const combined = normalizeDialogWikilinks(titleInput.value).trim();
			const path = normalizeDialogWikilinks(pathInput.value).trim();
			if (!combined) { new Notice('请输入名称'); return; }
			const match = combined.match(/^(\p{Extended_Pictographic}|\p{Emoji_Presentation}|\S+)\s+(.+)$/u);
			if (match) {
				ch.icon = match[1].trim() || '📂';
				ch.name = match[2].trim();
			} else {
				ch.icon = ch.icon || '📂';
				ch.name = combined;
			}
			if (!ch.name) { new Notice('请输入名称'); return; }
			ch.path = path;
			if (isNew) this.plugin.data.config.channels.push(ch);
			void this.plugin.saveData(this.plugin.data);
			overlay.remove();
			this.onRefresh();
		};
		overlay.appendChild(card);
		bindDialogOverlayDismiss(overlay);
		let submitBtn: HTMLButtonElement | null = null;
		enhanceDialogTextareas(overlay, card, () => submitBtn?.click());
		submitBtn = createDialogSubmitRow(card, submit, { onCancel: () => overlay.remove() });
		document.body.appendChild(overlay);
		void renderPathSuggestions();
		titleInput.focus();
		titleInput.select();
	}
}
