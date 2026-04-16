import { Notice, TFile, parseLinktext, setIcon } from 'obsidian';
import { renderIcon } from '../icon';
import type AiobPlugin from '../../main';
import { getSemanticAreaLabel } from '../../models/semantic';
import {
	getAiobFilePreviewText,
	getAiobWikilinkContext,
	getAiobWikilinkSuggestions,
	getAiobWikilinkTitle,
	normalizeWikilinkInput,
} from '../../utils/wikilinks';
import { createDialogShell, createDialogSubmitRow, enhanceDialogTextareas, normalizeDialogWikilinks, presentDialogShell } from '../dialogs';
import { Component } from './Component';
import { showSemanticAreasDialog, showSemanticAreasMenuAt } from './semanticAreas';

type MemoWikilinkSuggestion = {
	kind: 'file' | 'create';
	file: TFile | null;
	linktext: string;
	pathLabel: string;
	preview: string;
	title: string;
};

type MemoAttachmentInsert = {
	path: string;
	snippet: string;
};

type MemoAttachmentPreviewItem = {
	path: string;
	file: TFile;
	isImage: boolean;
	isManaged: boolean;
	resourcePath: string;
};

export class MemoInput extends Component {
	private wikilinkPreviewCache = new Map<string, string>();
	private memoFeedbackTimers = new WeakMap<HTMLElement, number>();

	constructor(plugin: AiobPlugin) {
		super(plugin);
	}

	/** The main memo box element — kept alive across re-renders while feedback shows. */
	private _box: HTMLElement | null = null;
	private _feedbackActive = false;

	render(container: HTMLElement): void {
		this.el = container;
		// If feedback/undo is active, move the existing box to the new container
		// instead of destroying and rebuilding — keeps the feedback visible.
		if (this._feedbackActive && this._box) {
			container.appendChild(this._box);
			return;
		}
		container.empty();
		const box = container.createDiv('aiob-memo-box');
		this._box = box;
		const textarea = box.createEl('textarea', {
			cls: 'aiob-memo-textarea',
			attr: { placeholder: '写点碎碎念、想法、观察...', rows: '2' },
		});
		const autosizeMemo = () => {
			textarea.style.setProperty('height', 'auto');
			textarea.style.setProperty('height', `${Math.min(textarea.scrollHeight, 200)}px`);
		};
		autosizeMemo();
		const attachmentStrip = box.createDiv('aiob-memo-attachment-strip');
		const suggest = box.createDiv('aiob-memo-link-suggest');
		const linkPreview = box.createDiv('aiob-memo-link-preview aiob-dialog-link-preview');
		const meta = box.createDiv('aiob-memo-meta');
		let memoAreas: string[] = [];
		let memoAttachmentPaths: string[] = [];
		let linkSuggestions: MemoWikilinkSuggestion[] = [];
		let linkSelectedIndex = 0;
		let linkSuggestRequestId = 0;
		let draggedAttachmentPath: string | null = null;
		const rememberAttachmentPaths = (paths: string[]) => {
			if (!paths.length) return;
			memoAttachmentPaths = [...new Set([...memoAttachmentPaths, ...paths])];
		};
		const sourcePath = this.getMarkdownSourcePath();
		const openAttachmentPicker = async () => {
			const paths = await this.attachFilesToMemoTextarea(textarea, {
				onInserted: () => {
					autosizeMemo();
					renderAttachmentStrip();
					void updateLinkSuggest();
				},
				onError: (message) => this.showMemoFeedback(feedback, message, 'error', 3200),
			});
			rememberAttachmentPaths(paths);
			renderAttachmentStrip();
		};
		const renderAttachmentStrip = () => {
			const items = this.getAttachmentPreviewItems(textarea.value, sourcePath, memoAttachmentPaths);
			attachmentStrip.empty();
			if (!items.length) {
				attachmentStrip.removeClass('show');
				return;
			}
			attachmentStrip.addClass('show');
			for (const [index, item] of items.entries()) {
				const card = attachmentStrip.createDiv(`aiob-memo-attachment-card ${item.isImage ? 'is-image' : 'is-file'}`);
				card.setAttribute('title', item.file.name);
				card.setAttribute('draggable', items.length > 1 ? 'true' : 'false');
				card.createDiv({ cls: 'aiob-memo-attachment-index', text: String(index + 1) });
				if (item.isImage) {
					card.createEl('img', {
						cls: 'aiob-memo-attachment-image',
						attr: {
							src: item.resourcePath,
							alt: item.file.name,
							loading: 'lazy',
						},
					});
				} else {
					const iconWrap = card.createDiv('aiob-memo-attachment-file-icon');
					setIcon(iconWrap, this.getAttachmentPreviewIcon(item.file));
					card.createDiv({ cls: 'aiob-memo-attachment-file-name', text: item.file.name });
				}
				const removeBtn = card.createDiv({
					cls: 'aiob-memo-attachment-remove',
					attr: { 'aria-label': '移除附件' },
				});
				renderIcon(removeBtn, 'x', 'sm');
				removeBtn.addEventListener('click', (ev) => {
					ev.preventDefault();
					ev.stopPropagation();
					this.removeAttachmentReferenceFromTextarea(textarea, item.path, sourcePath);
					memoAttachmentPaths = memoAttachmentPaths.filter((path) => path !== item.path);
					if (item.isManaged) {
						void this.cleanupDraftMemoAttachments([item.path]);
					}
					autosizeMemo();
					renderAttachmentStrip();
					void updateLinkSuggest();
				});
				card.addEventListener('click', () => {
					void this.plugin.app.workspace.openLinkText(item.path, sourcePath);
				});
				card.addEventListener('dragstart', (ev) => {
					if (items.length < 2) return;
					draggedAttachmentPath = item.path;
					card.addClass('is-dragging');
					if (ev.dataTransfer) {
						ev.dataTransfer.effectAllowed = 'move';
						ev.dataTransfer.setData('text/plain', item.path);
					}
				});
				card.addEventListener('dragend', () => {
					draggedAttachmentPath = null;
					card.removeClass('is-dragging');
					attachmentStrip.querySelectorAll('.is-drop-target').forEach((el) => el.removeClass('is-drop-target'));
				});
				card.addEventListener('dragover', (ev) => {
					if (!draggedAttachmentPath || draggedAttachmentPath === item.path) return;
					ev.preventDefault();
					card.addClass('is-drop-target');
				});
				card.addEventListener('dragleave', () => {
					card.removeClass('is-drop-target');
				});
				card.addEventListener('drop', (ev) => {
					if (!draggedAttachmentPath || draggedAttachmentPath === item.path) return;
					ev.preventDefault();
					card.removeClass('is-drop-target');
					this.reorderAttachmentReferences(textarea, sourcePath, draggedAttachmentPath, item.path);
					autosizeMemo();
					renderAttachmentStrip();
					void updateLinkSuggest();
				});
			}
			const addCard = attachmentStrip.createDiv({
				cls: 'aiob-memo-attachment-card aiob-memo-attachment-add',
				attr: { 'aria-label': '添加附件' },
			});
			renderIcon(addCard, 'plus', 'lg').addClass('aiob-memo-attachment-add-icon');
			addCard.addEventListener('click', () => {
				void openAttachmentPicker();
			});
		};
		const closeLinkSuggest = () => {
			linkSuggestions = [];
			linkSelectedIndex = 0;
			suggest.empty();
			suggest.removeClass('show');
		};
		const closeLinkPreview = () => {
			linkPreview.empty();
			linkPreview.removeClass('show');
		};
		const chooseLinkSuggestion = (suggestion: MemoWikilinkSuggestion | null) => {
			if (!suggestion) return;
			const context = getAiobWikilinkContext(textarea);
			if (!context) return;
			const replacement = `[[${suggestion.linktext}]]`;
			const replaceTo = textarea.value.slice(context.to).startsWith(']]') ? context.to + 2 : context.to;
			textarea.setRangeText(replacement, context.from, replaceTo, 'end');
			const caret = context.from + replacement.length;
			textarea.focus();
			textarea.setSelectionRange(caret, caret);
			closeLinkSuggest();
			closeLinkPreview();
		};
		let areaBtn: HTMLDivElement | null = null;
		const renderMemoAreas = () => {
			meta.empty();
			if (memoAreas.length) {
				meta.addClass('show');
			} else {
				meta.removeClass('show');
			}
			if (areaBtn) {
				if (memoAreas.length) areaBtn.addClass('is-active');
				else areaBtn.removeClass('is-active');
				areaBtn.setAttribute('title', memoAreas.length ? `areas: ${memoAreas.map((area) => getSemanticAreaLabel(area)).join(' · ')}` : 'areas');
			}
			for (const area of memoAreas) {
				const chip = meta.createDiv('aiob-memo-area-chip');
				chip.createSpan({
					cls: 'aiob-memo-area-chip-label',
					text: getSemanticAreaLabel(area),
				});
				const removeBtn = chip.createDiv({
					cls: 'aiob-memo-area-chip-remove',
					attr: { 'aria-label': `移除 ${getSemanticAreaLabel(area)}` },
				});
				renderIcon(removeBtn, 'x', 'sm');
				removeBtn.addEventListener('click', (ev) => {
					ev.preventDefault();
					ev.stopPropagation();
					memoAreas = memoAreas.filter((value) => value !== area);
					renderMemoAreas();
				});
			}
		};
		const renderLinkSuggest = () => {
			suggest.empty();
			if (!linkSuggestions.length) {
				suggest.removeClass('show');
				return;
			}
			suggest.addClass('show');
			linkSuggestions.forEach((entry, index) => {
				const row = suggest.createDiv(`aiob-memo-link-option ${index === linkSelectedIndex ? 'active' : ''}`);
				const head = row.createDiv('aiob-memo-link-option-head');
				head.createDiv({ cls: 'aiob-memo-link-option-title', text: entry.title });
				head.createDiv({ cls: 'aiob-memo-link-option-path', text: entry.pathLabel });
				if (entry.preview) {
					row.createDiv({ cls: 'aiob-memo-link-option-preview', text: entry.preview });
				}
				row.addEventListener('mouseenter', () => {
					linkSelectedIndex = index;
					renderLinkSuggest();
				});
				row.addEventListener('pointerdown', (ev) => {
					ev.preventDefault();
					chooseLinkSuggestion(entry);
				});
			});
		};
		const updateLinkSuggest = async () => {
			const context = getAiobWikilinkContext(textarea);
			if (!context) {
				closeLinkSuggest();
				closeLinkPreview();
				return;
			}
			const requestId = ++linkSuggestRequestId;
			const suggestions = await this.getMemoSuggestions(context.query, sourcePath);
			if (requestId !== linkSuggestRequestId || !textarea.isConnected) return;
			linkSuggestions = suggestions;
			linkSelectedIndex = 0;
			renderLinkSuggest();
			closeLinkPreview();
		};
		const openToolbarLinkSuggest = async () => {
			const requestId = ++linkSuggestRequestId;
			const suggestions = await this.getMemoSuggestions('', sourcePath);
			if (requestId !== linkSuggestRequestId || !textarea.isConnected) return;
			linkSuggestions = suggestions;
			linkSelectedIndex = 0;
			renderLinkSuggest();
			closeLinkPreview();
		};
		const queueLinkSuggest = () => {
			void updateLinkSuggest();
			window.requestAnimationFrame(() => {
				void updateLinkSuggest();
			});
		};
		const bottom = box.createDiv('aiob-memo-bottom');
		const icons = bottom.createDiv('aiob-memo-icons');
		for (const { icon, title, fn } of [
			{ icon: 'square-check-big', title: '待办', fn: () => this.insertTodoSyntax(textarea) },
			{ icon: 'flag', title: 'areas', fn: (target?: HTMLElement) => {
				showSemanticAreasMenuAt(this.plugin, target || areaBtn || textarea, memoAreas, (areas) => {
					memoAreas = areas;
					renderMemoAreas();
				});
			} },
			{ icon: 'link', title: '双链', fn: () => {
				this.insertWikilinkStarter(textarea);
				void openToolbarLinkSuggest();
			} },
			{
				icon: 'paperclip',
				title: '附件',
				fn: async () => {
					await openAttachmentPicker();
				},
			},
		]) {
			const btn = icons.createDiv({ cls: 'aiob-memo-icon-btn', attr: { 'aria-label': title } });
			renderIcon(btn, icon, 'md');
			if (title === 'areas') areaBtn = btn;
			btn.addEventListener('click', () => fn(btn));
		}
		renderMemoAreas();
		const feedback = bottom.createDiv('aiob-memo-feedback');
		const actionBtns = bottom.createDiv('aiob-memo-actions');
		const undoBtn = actionBtns.createDiv({ cls: 'aiob-memo-send-btn aiob-memo-undo-inline is-hidden', attr: { 'aria-label': '撤回上一条 Memo' } });
		renderIcon(undoBtn, 'undo-2', 'md');
		const draftBtn = actionBtns.createDiv({ cls: 'aiob-memo-send-btn aiob-memo-draft-btn is-hidden', attr: { 'aria-label': '保存草稿' } });
		renderIcon(draftBtn, 'file-text', 'md');
		const sendBtn = actionBtns.createDiv({ cls: 'aiob-memo-send-btn', attr: { 'aria-label': '发送' } });
		renderIcon(sendBtn, 'send', 'md');
		let undoTimer: number | null = null;
		const showUndoBriefly = () => {
			if (undoTimer) window.clearTimeout(undoTimer);
			undoBtn.removeClass('is-hidden');
			undoTimer = window.setTimeout(() => {
				undoBtn.addClass('is-hidden');
				undoTimer = null;
			}, 3000);
		};
		const updateActionVisibility = () => {
			const hasText = textarea.value.trim().length > 0;
			draftBtn.toggleClass('is-hidden', !hasText);
		};

		// Restore draft
		const draftKey = 'aiob-memo-draft';
		const savedDraft = this.plugin.app.loadLocalStorage(draftKey);
		if (savedDraft) {
			textarea.value = savedDraft;
			autosizeMemo();
			updateActionVisibility();
		}

		const submit = () => {
			const value = textarea.value.trim();
			if (!value) return;
			this.plugin.app.saveLocalStorage(draftKey, null);
			const managedAttachmentPaths = this.getManagedAttachmentPathsForContent(value, memoAttachmentPaths);
			const removedAttachmentPaths = memoAttachmentPaths.filter((path) => !managedAttachmentPaths.includes(path));
			if (removedAttachmentPaths.length) {
				void this.cleanupDraftMemoAttachments(removedAttachmentPaths);
			}
			const todoContent = this.extractTodoContent(value);
			if (todoContent) {
				void this.plugin.markdownTodoService.createTodo(todoContent);
				textarea.value = '';
				memoAreas = [];
				memoAttachmentPaths = [];
				renderMemoAreas();
				autosizeMemo();
				renderAttachmentStrip();
				closeLinkSuggest();
				closeLinkPreview();
				this.showMemoFeedback(feedback, '✓ 已加入待办', 'success', 1800);
				updateActionVisibility();
				textarea.blur();
				return;
			}
			void this.plugin.markdownMemoService.addMemo(value);
			textarea.value = '';
			memoAreas = [];
			memoAttachmentPaths = [];
			renderMemoAreas();
			autosizeMemo();
			renderAttachmentStrip();
			closeLinkSuggest();
			closeLinkPreview();
			this.showMemoFeedback(feedback, '✓ 已记录', 'success', 3000);
			updateActionVisibility();
			showUndoBriefly();
			textarea.blur();
		};

		draftBtn.addEventListener('click', () => {
			const value = textarea.value.trim();
			if (!value) return;
			this.plugin.app.saveLocalStorage(draftKey, value);
			this.showMemoFeedback(feedback, '✓ 草稿已保存', 'success', 1500);
		});
		sendBtn.addEventListener('click', submit);
		undoBtn.addEventListener('click', async () => {
			const undone = await this.plugin.markdownMemoService.undoLastMemo();
			if (undone) {
				this.showMemoFeedback(feedback, '✓ 已撤回', 'success', 3000);
			} else {
				new Notice('没有可撤回的 memo');
			}
		});
		textarea.addEventListener('keydown', (e: KeyboardEvent) => {
			if (linkSuggestions.length) {
				if (e.key === 'ArrowDown') {
					e.preventDefault();
					linkSelectedIndex = (linkSelectedIndex + 1) % linkSuggestions.length;
					renderLinkSuggest();
					return;
				}
				if (e.key === 'ArrowUp') {
					e.preventDefault();
					linkSelectedIndex = (linkSelectedIndex - 1 + linkSuggestions.length) % linkSuggestions.length;
					renderLinkSuggest();
					return;
				}
				if ((e.key === 'Enter' && !e.shiftKey) || e.key === 'Tab') {
					e.preventDefault();
					chooseLinkSuggestion(linkSuggestions[linkSelectedIndex] || null);
					return;
				}
				if (e.key === 'Escape') {
					e.preventDefault();
					closeLinkSuggest();
					closeLinkPreview();
					return;
				}
			}
			if (e.key === 'Escape') {
				textarea.blur();
				return;
			}
			if (e.key === 'Enter' && !e.shiftKey) {
				e.preventDefault();
				submit();
			}
		});
			textarea.addEventListener('input', () => {
				normalizeWikilinkInput(textarea);
				autosizeMemo();
				renderAttachmentStrip();
				queueLinkSuggest();
				updateActionVisibility();
			});
			textarea.addEventListener('click', () => {
				renderAttachmentStrip();
				queueLinkSuggest();
			});
			textarea.addEventListener('keyup', (e: KeyboardEvent) => {
				if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) {
					queueLinkSuggest();
				}
			});
			textarea.addEventListener('blur', () => {
				window.setTimeout(() => {
					if (document.activeElement !== textarea) {
						closeLinkSuggest();
						closeLinkPreview();
					}
				}, 120);
			});
			renderAttachmentStrip();
			queueLinkSuggest();
		}

	// ── Public API for external callers ──

	openComposerDialog(seed = '', onAfterSubmit?: () => void): void {
		const { overlay, card } = createDialogShell('Memo', 'aiob-dialog-card-form');
		const textarea = card.createEl('textarea', {
			cls: 'aiob-dialog-input aiob-dialog-textarea',
			attr: { placeholder: '写点碎碎念、想法、观察...', rows: '1' },
		});
		textarea.value = seed;
		let memoAreas: string[] = [];
		let memoAttachmentPaths: string[] = [];
		const submit = () => {
			const ok = this.submitMemoValue(
				normalizeDialogWikilinks(textarea.value),
				memoAreas,
				onAfterSubmit,
				memoAttachmentPaths,
			);
			if (ok) overlay.remove();
		};
		let submitBtn: HTMLButtonElement | null = null;
		enhanceDialogTextareas(overlay, card, () => submitBtn?.click(), undefined, {
			extraActions: [
				{ icon: 'square-check-big', title: '待办', onClick: () => this.insertTodoSyntax(textarea) },
				{
					icon: 'map',
					title: 'areas',
					onClick: () => {
						showSemanticAreasDialog(
							this.plugin,
							memoAreas,
							(areas) => { memoAreas = areas; },
							{ title: '设置 areas' },
						);
					},
				},
				{ icon: 'link', title: '双链', onClick: () => this.insertWikilinkStarter(textarea) },
				{
					icon: 'paperclip',
					title: '附件',
					onClick: async () => {
						const paths = await this.attachFilesToMemoTextarea(textarea, {
							onInserted: () => textarea.dispatchEvent(new Event('input')),
							onSuccess: (message) => new Notice(message),
							onError: (message) => new Notice(message),
						});
						if (paths.length) {
							memoAttachmentPaths = [...new Set([...memoAttachmentPaths, ...paths])];
						}
					},
				},
				{ icon: 'tag', title: '标签', onClick: () => this.insertAtCursor(textarea, '#') },
				{ icon: 'list', title: '列表', onClick: () => this.insertAtCursor(textarea, '- ') },
				{
					icon: 'undo-2',
					title: '撤回上一条 Memo',
					onClick: async () => {
						const undone = await this.plugin.markdownMemoService.undoLastMemo();
						if (undone) {
							new Notice('✓ 已撤回', 3000);
							onAfterSubmit?.();
						} else {
							new Notice('没有可撤回的 memo');
						}
					},
					},
				],
		});
		submitBtn = createDialogSubmitRow(card, submit, {
			onCancel: () => {
				void this.cleanupDraftMemoAttachments(memoAttachmentPaths);
				overlay.remove();
			},
		});
		presentDialogShell(overlay, card, textarea);
	}

	bindMarkdownLinks(container: HTMLElement, sourcePath: string): void {
		container.querySelectorAll('a.internal-link').forEach((anchor) => {
			anchor.addEventListener('click', (ev) => {
				ev.preventDefault();
				ev.stopPropagation();
				const href = (anchor as HTMLAnchorElement).dataset.href || (anchor as HTMLAnchorElement).getAttribute('href');
				if (!href) return;
				void this.plugin.app.workspace.openLinkText(href, sourcePath);
			});
		});
	}

	// ── Private helpers ──

	private insertAtCursor(textarea: HTMLTextAreaElement, text: string, cursorOffset = 0) {
		const start = textarea.selectionStart ?? textarea.value.length;
		const end = textarea.selectionEnd ?? textarea.value.length;
		textarea.setRangeText(text, start, end, 'end');
		const pos = textarea.selectionStart + cursorOffset;
		textarea.focus();
		textarea.setSelectionRange(pos, pos);
	}

	private insertWikilinkStarter(textarea: HTMLTextAreaElement) {
		const context = getAiobWikilinkContext(textarea);
		if (context) {
			textarea.focus();
			return;
		}
		this.insertAtCursor(textarea, '[[]]');
		const cursor = textarea.selectionStart ?? textarea.value.length;
		const nextPos = Math.max(0, cursor - 2);
		textarea.setSelectionRange(nextPos, nextPos);
	}

	private insertTodoSyntax(textarea: HTMLTextAreaElement) {
		const value = textarea.value;
		const start = textarea.selectionStart ?? value.length;
		const lineStart = value.lastIndexOf('\n', Math.max(0, start - 1)) + 1;
		const linePrefix = value.slice(lineStart, start);
		if (linePrefix.trim().length === 0) {
			this.insertAtCursor(textarea, '- [ ] ');
			return;
		}
		this.insertAtCursor(textarea, '\n- [ ] ');
	}

	private extractTodoContent(value: string): string | null {
		const match = value.match(/^\s*-\s\[\s\]\s+(.+)$/s);
		if (!match) return null;
		const content = match[1].trim();
		return content || null;
	}

	private submitMemoValue(value: string, areas: string[] = [], onAfterSubmit?: () => void, attachmentPaths: string[] = []): boolean {
		const trimmed = value.trim();
		if (!trimmed) return false;
		const managedAttachmentPaths = this.getManagedAttachmentPathsForContent(trimmed, attachmentPaths);
		const removedAttachmentPaths = attachmentPaths.filter((path) => !managedAttachmentPaths.includes(path));
		if (removedAttachmentPaths.length) {
			void this.cleanupDraftMemoAttachments(removedAttachmentPaths);
		}
		const todoContent = this.extractTodoContent(trimmed);
		if (todoContent) {
			void this.plugin.markdownTodoService.createTodo(todoContent);
			new Notice('✓ 已加入待办', 3000);
			onAfterSubmit?.();
			return true;
		}
		void this.plugin.markdownMemoService.addMemo(trimmed);
		new Notice('✓ 已记录', 3000);
		onAfterSubmit?.();
		return true;
	}

	private async attachFilesToMemoTextarea(
		textarea: HTMLTextAreaElement,
		options?: {
			onInserted?: () => void;
			onSuccess?: (message: string) => void;
			onError?: (message: string) => void;
		},
	): Promise<string[]> {
		const files = await this.promptForAttachmentFiles();
		if (!files.length) return [];
		try {
			const attachments: MemoAttachmentInsert[] = [];
			for (const file of files) {
				attachments.push(await this.storeMemoAttachment(file));
			}
			this.insertAttachmentSnippets(textarea, attachments.map((entry) => entry.snippet));
			options?.onInserted?.();
			const label = files.length === 1 ? '1 个附件' : `${files.length} 个附件`;
			options?.onSuccess?.(`✓ 已添加 ${label}`);
			return attachments.map((entry) => entry.path);
		} catch (error) {
			console.error('Aiob: Failed to attach memo files', error);
			options?.onError?.('附件添加失败');
			return [];
		}
	}

	private promptForAttachmentFiles(): Promise<File[]> {
		return new Promise((resolve) => {
			const input = document.createElement('input');
			input.type = 'file';
			input.multiple = true;
			input.className = 'aiob-hidden-file-input';
			document.body.appendChild(input);
			let settled = false;
			let focusTimer: number | null = null;
			const cleanup = () => {
				if (focusTimer != null) {
					window.clearTimeout(focusTimer);
					focusTimer = null;
				}
				window.removeEventListener('focus', handleWindowFocus, true);
				input.remove();
			};
			const finish = (files: File[]) => {
				if (settled) return;
				settled = true;
				cleanup();
				resolve(files);
			};
			const handleWindowFocus = () => {
				if (focusTimer != null) window.clearTimeout(focusTimer);
				focusTimer = window.setTimeout(() => {
					const files = Array.from(input.files || []);
					finish(files);
				}, 600);
			};
			input.addEventListener('change', () => finish(Array.from(input.files || [])), { once: true });
			input.addEventListener('cancel', () => finish([]), { once: true });
			window.addEventListener('focus', handleWindowFocus, true);
			input.click();
		});
	}

	private async storeMemoAttachment(file: File): Promise<MemoAttachmentInsert> {
		const extension = this.getAttachmentExtension(file);
		const baseName = this.getAttachmentBaseName(file, extension);
		const filename = extension ? `${baseName}.${extension}` : baseName;
		const path = await this.plugin.app.fileManager.getAvailablePathForAttachment(filename, this.getMarkdownSourcePath());
		const data = await file.arrayBuffer();
		await this.plugin.app.vault.createBinary(path, data);
		return {
			path,
			snippet: `${this.shouldEmbedAttachment(file, extension) ? '!' : ''}[[${path}]]`,
		};
	}

	private insertAttachmentSnippets(textarea: HTMLTextAreaElement, snippets: string[]): void {
		const block = snippets.join('\n');
		const start = textarea.selectionStart ?? textarea.value.length;
		const end = textarea.selectionEnd ?? textarea.value.length;
		const before = textarea.value.slice(0, start);
		const after = textarea.value.slice(end);
		let insertion = block;
		if (before && !before.endsWith('\n')) insertion = `\n${insertion}`;
		if (after && !after.startsWith('\n')) insertion = `${insertion}\n`;
		textarea.setRangeText(insertion, start, end, 'end');
		const caret = start + insertion.length;
		textarea.focus();
		textarea.setSelectionRange(caret, caret);
	}

	private getAttachmentBaseName(file: File, extension: string): string {
		const rawName = (file.name || '').trim();
		const lowerExt = extension ? `.${extension}` : '';
		const base = lowerExt && rawName.toLowerCase().endsWith(lowerExt)
			? rawName.slice(0, -lowerExt.length)
			: rawName.replace(/\.[^.]+$/, '');
		return this.sanitizeAttachmentFilename(base) || `附件-${Date.now()}`;
	}

	private getAttachmentExtension(file: File): string {
		const rawName = (file.name || '').trim();
		const ext = rawName.includes('.') ? rawName.split('.').pop() : '';
		if (ext) return ext.toLowerCase();
		switch (file.type) {
			case 'image/jpeg':
				return 'jpg';
			case 'image/png':
				return 'png';
			case 'image/webp':
				return 'webp';
			case 'image/gif':
				return 'gif';
			case 'image/heic':
				return 'heic';
			case 'video/mp4':
				return 'mp4';
			case 'video/quicktime':
				return 'mov';
			case 'audio/mpeg':
				return 'mp3';
			case 'audio/mp4':
				return 'm4a';
			case 'application/pdf':
				return 'pdf';
			default:
				return '';
		}
	}

	private shouldEmbedAttachment(file: File, extension: string): boolean {
		if (file.type.startsWith('image/') || file.type.startsWith('video/') || file.type.startsWith('audio/')) return true;
		return new Set([
			'png',
			'jpg',
			'jpeg',
			'gif',
			'webp',
			'svg',
			'bmp',
			'heic',
			'mp4',
			'mov',
			'webm',
			'm4v',
			'mp3',
			'm4a',
			'wav',
			'ogg',
			'flac',
			'pdf',
		]).has(extension);
	}

	private sanitizeAttachmentFilename(value: string): string {
		return value.replace(/[\\/:*?"<>|]/g, '-').replace(/\s+/g, ' ').trim();
	}

	private getAttachmentPreviewItems(content: string, sourcePath: string, managedPaths: string[]): MemoAttachmentPreviewItem[] {
		const items: MemoAttachmentPreviewItem[] = [];
		const seen = new Set<string>();
		const regex = /!?\[\[([^\]]+)\]\]/g;
		let match: RegExpExecArray | null;
		while ((match = regex.exec(content)) !== null) {
			const file = this.resolveLinkedFile(match[1], sourcePath);
			if (!file || file.extension.toLowerCase() === 'md' || seen.has(file.path)) continue;
			seen.add(file.path);
			items.push({
				path: file.path,
				file,
				isImage: this.isImageAttachmentFile(file),
				isManaged: managedPaths.includes(file.path),
				resourcePath: this.plugin.app.vault.getResourcePath(file),
			});
		}
		return items;
	}

	private getOrderedAttachmentReferences(content: string, sourcePath: string): Array<{ path: string; markup: string }> {
		const references: Array<{ path: string; markup: string }> = [];
		const seen = new Set<string>();
		const regex = /!?\[\[([^\]]+)\]\]/g;
		let match: RegExpExecArray | null;
		while ((match = regex.exec(content)) !== null) {
			const file = this.resolveLinkedFile(match[1], sourcePath);
			if (!file || file.extension.toLowerCase() === 'md' || seen.has(file.path)) continue;
			seen.add(file.path);
			references.push({ path: file.path, markup: match[0] });
		}
		return references;
	}

	private resolveLinkedFile(rawLinktext: string, sourcePath: string): TFile | null {
		const rawTarget = rawLinktext.split('|')[0]?.trim() || '';
		if (!rawTarget) return null;
		const parsed = parseLinktext(rawTarget);
		const lookup = parsed.path || rawTarget;
		const file = this.plugin.app.metadataCache.getFirstLinkpathDest(lookup, sourcePath);
		return file instanceof TFile ? file : null;
	}

	private isImageAttachmentFile(file: TFile): boolean {
		return new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'heic', 'avif']).has(file.extension.toLowerCase());
	}

	private getAttachmentPreviewIcon(file: TFile): string {
		const ext = file.extension.toLowerCase();
		if (this.isImageAttachmentFile(file)) return 'image';
		if (['mp4', 'mov', 'webm', 'm4v'].includes(ext)) return 'video';
		if (['mp3', 'm4a', 'wav', 'ogg', 'flac'].includes(ext)) return 'music4';
		if (ext === 'pdf') return 'file-text';
		return 'file';
	}

	private removeAttachmentReferenceFromTextarea(textarea: HTMLTextAreaElement, path: string, sourcePath: string): void {
		const nextValue = textarea.value
			.replace(/!?\[\[([^\]]+)\]\]/g, (match, rawLinktext: string) => {
				const file = this.resolveLinkedFile(rawLinktext, sourcePath);
				return file?.path === path && file.extension.toLowerCase() !== 'md' ? '' : match;
			})
			.replace(/[ \t]+\n/g, '\n')
			.replace(/\n{3,}/g, '\n\n')
			.trim();
		textarea.value = nextValue;
		const caret = textarea.value.length;
		textarea.focus();
		textarea.setSelectionRange(caret, caret);
	}

	private reorderAttachmentReferences(
		textarea: HTMLTextAreaElement,
		sourcePath: string,
		fromPath: string,
		toPath: string,
	): void {
		const references = this.getOrderedAttachmentReferences(textarea.value, sourcePath);
		const fromIndex = references.findIndex((entry) => entry.path === fromPath);
		const toIndex = references.findIndex((entry) => entry.path === toPath);
		if (fromIndex === -1 || toIndex === -1 || fromIndex === toIndex) return;
		const reordered = [...references];
		const [moved] = reordered.splice(fromIndex, 1);
		reordered.splice(toIndex, 0, moved);
		let cursor = 0;
		textarea.value = textarea.value.replace(/!?\[\[([^\]]+)\]\]/g, (match, rawLinktext: string) => {
			const file = this.resolveLinkedFile(rawLinktext, sourcePath);
			if (!file || file.extension.toLowerCase() === 'md') return match;
			const replacement = reordered[cursor++];
			return replacement?.markup ?? match;
		});
		const caret = textarea.value.length;
		textarea.focus();
		textarea.setSelectionRange(caret, caret);
	}

	private getManagedAttachmentPathsForContent(content: string, paths: string[]): string[] {
		return [...new Set(
			paths
				.map((path) => path.trim())
				.filter((path) => !!path)
				.filter((path) => content.includes(path)),
		)];
	}

	private async cleanupDraftMemoAttachments(paths: string[]): Promise<void> {
		const uniquePaths = [...new Set(
			paths
				.map((path) => path.trim())
				.filter((path) => !!path),
		)];
		for (const path of uniquePaths) {
			const file = this.plugin.app.vault.getAbstractFileByPath(path);
			if (!file) continue;
			try {
				await this.plugin.app.fileManager.trashFile(file);
			} catch (error) {
				console.error('Aiob: Failed to cleanup draft memo attachment', path, error);
			}
		}
	}

	private getMarkdownSourcePath(): string {
		return this.plugin.app.workspace.getActiveFile()?.path ?? '';
	}

	private async getMemoSuggestions(query: string, sourcePath: string): Promise<MemoWikilinkSuggestion[]> {
		const base = await getAiobWikilinkSuggestions(
			query, sourcePath, this.plugin.app,
			(file) => this.getFilePreview(file),
		);
		const suggestions: MemoWikilinkSuggestion[] = base.map((entry) => ({
			...entry,
			kind: 'file' as const,
			title: getAiobWikilinkTitle(entry.file),
		}));
		const normalizedQuery = query.trim().toLowerCase();
		const normalizedLinkQuery = query.trim();
		const hasExactMatch = suggestions.some((entry) =>
			entry.linktext.trim().toLowerCase() === normalizedQuery
			|| entry.title.trim().toLowerCase() === normalizedQuery
			|| entry.pathLabel.trim().toLowerCase() === normalizedQuery,
		);
		if (normalizedLinkQuery && !hasExactMatch) {
			suggestions.unshift({
				kind: 'create',
				file: null,
				title: `新建：${normalizedLinkQuery}`,
				linktext: normalizedLinkQuery,
				pathLabel: `[[${normalizedLinkQuery}]]`,
				preview: '没有匹配文档，将作为新建文档的双向链接保留',
			});
		}
		return suggestions;
	}

	private async getFilePreview(file: TFile): Promise<string> {
		const cached = this.wikilinkPreviewCache.get(file.path);
		if (cached !== undefined) return cached;
		try {
			const raw = await this.plugin.app.vault.cachedRead(file);
			const preview = getAiobFilePreviewText(raw, file.extension);
			this.wikilinkPreviewCache.set(file.path, preview);
			return preview;
		} catch (error) {
			console.error('Aiob: Failed to load wikilink preview', error);
			this.wikilinkPreviewCache.set(file.path, '');
			return '';
		}
	}

	private showMemoFeedback(
		feedback: HTMLElement,
		text: string,
		tone: 'success' | 'muted' | 'error' = 'success',
		duration?: number,
	): void {
		const activeTimer = this.memoFeedbackTimers.get(feedback);
		if (activeTimer) window.clearTimeout(activeTimer);
		this.memoFeedbackTimers.delete(feedback);
		feedback.empty();
		feedback.textContent = text;
		feedback.removeClass('is-error');
		feedback.removeClass('is-muted');
		if (tone === 'error') feedback.addClass('is-error');
		if (tone === 'muted') feedback.addClass('is-muted');
		feedback.addClass('show');
		this._feedbackActive = true;
		if (!duration) return;
		const timer = window.setTimeout(() => {
			feedback.removeClass('show');
			feedback.removeClass('is-error');
			feedback.removeClass('is-muted');
			feedback.empty();
			this.memoFeedbackTimers.delete(feedback);
			this._feedbackActive = false;
		}, duration);
		this.memoFeedbackTimers.set(feedback, timer);
	}
}
