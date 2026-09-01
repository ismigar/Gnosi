import {
    useCallback,
    useEffect,
    useRef,
    useState,
    type MouseEvent,
} from 'react';
import { createPortal } from 'react-dom';
import {
    ChevronDown,
    Copy,
    Edit2,
    LayoutTemplate,
    MoreHorizontal,
    Plus,
    Search,
    Star,
    Trash2,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { useModalKeyboard } from '../../../../shared/hooks/useModalKeyboard';
import {
    browserDocumentBody,
    browserViewportSize,
    eventTargetClosest,
    eventTargetIsWithin,
    subscribeDocumentEvent,
    subscribeWindowEvent,
} from '../../../../shared/platform/browser-events';
import { IconRenderer } from '../../../../shared/ui/previews/IconRenderer';
import { getTemplateMenuIcon } from '../templateMenuUtils';
import { sortedTemplates } from './viewModel';
import type {
    HeaderTemplate,
    TemplateMenuState,
} from './types';

interface NewRecordMenuProps {
    readonly onCreateFromSource?: (() => unknown) | null;
    readonly onCreateRecord?: ((templateId?: string) => unknown) | null;
    readonly onCreateTemplate?: (() => unknown) | null;
    readonly onDeleteTemplate?: ((template: HeaderTemplate) => unknown) | null;
    readonly onDuplicateTemplate?: ((template: HeaderTemplate) => unknown) | null;
    readonly onEditTemplate?: ((template: HeaderTemplate) => unknown) | null;
    readonly onSetDefaultTemplate?: ((template: HeaderTemplate) => unknown) | null;
    readonly referenceTableId?: string | null;
    readonly templates: readonly HeaderTemplate[];
}

export function NewRecordMenu({
    onCreateFromSource,
    onCreateRecord,
    onCreateTemplate,
    onDeleteTemplate,
    onDuplicateTemplate,
    onEditTemplate,
    onSetDefaultTemplate,
    referenceTableId,
    templates,
}: NewRecordMenuProps) {
    const { t } = useTranslation();
    const [showNewMenu, setShowNewMenu] = useState(false);
    const [newMenuMaxHeight, setNewMenuMaxHeight] = useState<number | null>(null);
    const [templateMenuFor, setTemplateMenuFor] = useState<TemplateMenuState | null>(null);
    const newMenuRef = useRef<HTMLDivElement>(null);
    const hasTemplateActions = Boolean(
        onEditTemplate
        || onDuplicateTemplate
        || onSetDefaultTemplate
        || onDeleteTemplate,
    );
    const closeNewMenus = useCallback(() => {
        setTemplateMenuFor(null);
        setShowNewMenu(false);
    }, []);
    const updateNewMenuHeight = useCallback(() => {
        const triggerBounds = newMenuRef.current?.getBoundingClientRect();
        if (!triggerBounds) return;
        const { height } = browserViewportSize();
        setNewMenuMaxHeight(Math.max(0, height - triggerBounds.bottom - 12));
    }, []);

    useEffect(() => {
        if (!showNewMenu) return undefined;
        const unsubscribePointer = subscribeDocumentEvent('mousedown', (event) => {
            const menu = newMenuRef.current;
            if (
                menu
                && !eventTargetIsWithin(menu, event.target)
                && !eventTargetClosest(event.target, '[data-template-submenu]')
            ) {
                closeNewMenus();
            }
        });
        const unsubscribeResize = subscribeWindowEvent('resize', updateNewMenuHeight);
        const unsubscribeScroll = subscribeWindowEvent('scroll', updateNewMenuHeight, true);
        return () => {
            unsubscribePointer();
            unsubscribeResize();
            unsubscribeScroll();
        };
    }, [closeNewMenus, showNewMenu, updateNewMenuHeight]);
    useModalKeyboard({ isOpen: showNewMenu, onClose: closeNewMenus });

    const openTemplateMenu = (
        event: MouseEvent<HTMLButtonElement>,
        template: HeaderTemplate,
    ): void => {
        event.preventDefault();
        event.stopPropagation();
        const rect = event.currentTarget.getBoundingClientRect();
        const { width } = browserViewportSize();
        setTemplateMenuFor((current) => current?.id === template.id
            ? null
            : {
                id: template.id,
                tpl: template,
                top: rect.bottom + 4,
                right: Math.max(8, width - rect.right),
            });
    };

    return (
        <div ref={newMenuRef} className="relative inline-flex shadow-md rounded-xl">
            <button
                onClick={() => {
                    onCreateRecord?.();
                }}
                className="btn-gnosi btn-gnosi-primary !px-3 !py-1.5 !text-xs !gap-1.5 !shadow-none !rounded-r-none active:scale-95"
            >
                <Plus size={14} />
                <span className="hidden sm:inline">{t('views_header.new_action')}</span>
            </button>
            <button
                type="button"
                onClick={() => {
                    if (showNewMenu) {
                        closeNewMenus();
                    } else {
                        updateNewMenuHeight();
                        setShowNewMenu(true);
                    }
                }}
                aria-label={t('views_header.new_options', 'Creation options')}
                aria-haspopup="menu"
                aria-expanded={showNewMenu}
                className="btn-gnosi btn-gnosi-primary !px-2 !py-1.5 !shadow-none !rounded-l-none border-l border-white/20 hover:text-white/80 active:scale-95"
            >
                <ChevronDown size={14} />
            </button>
            {showNewMenu && (
                <div
                    className="vault-new-record-menu absolute top-full right-0 mt-1 w-56 border rounded-lg shadow-xl py-1 !text-xs animate-in fade-in zoom-in-95 duration-100"
                    style={newMenuMaxHeight === null
                        ? undefined
                        : { maxHeight: `${String(newMenuMaxHeight)}px` }}
                >
                    <button
                        onClick={() => {
                            setShowNewMenu(false);
                            onCreateRecord?.();
                        }}
                        className="w-full flex items-center gap-2 px-3 py-2 !text-xs text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)] transition-colors text-left"
                    >
                        <Plus size={14} className="text-[var(--text-tertiary)]" />
                        <span>{t('views_header.new_empty_record')}</span>
                    </button>
                    <button
                        onClick={() => {
                            setShowNewMenu(false);
                            onCreateTemplate?.();
                        }}
                        className="w-full flex items-center gap-2 px-3 py-2 !text-xs text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)] transition-colors text-left"
                    >
                        <LayoutTemplate size={14} className="text-[var(--text-tertiary)]" />
                        <span>{t('views_header.new_template')}</span>
                    </button>
                    {referenceTableId && onCreateFromSource && (
                        <button
                            onClick={() => {
                                setShowNewMenu(false);
                                onCreateFromSource();
                            }}
                            className="w-full flex items-center gap-2 px-3 py-2 !text-xs text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)] transition-colors text-left"
                        >
                            <Search size={14} className="text-[var(--text-tertiary)]" />
                            <span>
                                {t('views_header.new_from_source', {
                                    defaultValue: 'Create from a source…',
                                })}
                            </span>
                        </button>
                    )}
                    {templates.length > 0 && (
                        <>
                            <div className="h-px bg-[var(--border-primary)] my-1 mx-2" />
                            <div className="px-3 py-1 text-[10px] font-bold text-[var(--text-tertiary)] uppercase tracking-tighter">
                                {t('views_header.templates_title')}
                            </div>
                            {sortedTemplates(templates).map((template) => (
                                <div
                                    key={template.id}
                                    className="group/tpl flex items-stretch hover:bg-[var(--bg-tertiary)] transition-colors"
                                >
                                    <button
                                        onClick={() => {
                                            setShowNewMenu(false);
                                            onCreateRecord?.(template.id);
                                        }}
                                        className="flex-1 min-w-0 flex items-center gap-2 px-3 py-2 !text-xs text-[var(--text-primary)] text-left"
                                    >
                                        <IconRenderer
                                            icon={getTemplateMenuIcon(template)}
                                            size={16}
                                            className="shrink-0"
                                        />
                                        <span className="truncate">
                                            {template.title || t('common.untitled')}
                                        </span>
                                        {Boolean(template.metadata?.is_default_template) && (
                                            <span className="ml-auto shrink-0 text-[9px] bg-[var(--status-success)]/20 text-[var(--status-success)] px-1 rounded">
                                                {t('views_header.default_badge')}
                                            </span>
                                        )}
                                    </button>
                                    {hasTemplateActions && (
                                        <button
                                            type="button"
                                            onClick={(event) => {
                                                openTemplateMenu(event, template);
                                            }}
                                            title={t('table.options')}
                                            aria-label={t('table.options')}
                                            aria-haspopup="menu"
                                            className={`shrink-0 px-2 flex items-center hover:bg-[var(--bg-secondary)] transition-all ${templateMenuFor?.id === template.id
                                                ? 'opacity-100 text-[var(--text-primary)]'
                                                : 'opacity-0 group-hover/tpl:opacity-100 focus:opacity-100 text-[var(--text-tertiary)] hover:text-[var(--text-primary)]'}`}
                                        >
                                            <MoreHorizontal size={15} />
                                        </button>
                                    )}
                                </div>
                            ))}
                        </>
                    )}
                    {templateMenuFor && createPortal(
                        <TemplateActionsMenu
                            menuState={templateMenuFor}
                            onClose={closeNewMenus}
                            onDeleteTemplate={onDeleteTemplate}
                            onDuplicateTemplate={onDuplicateTemplate}
                            onEditTemplate={onEditTemplate}
                            onSetDefaultTemplate={onSetDefaultTemplate}
                        />,
                        browserDocumentBody(),
                    )}
                </div>
            )}
        </div>
    );
}

interface TemplateActionsMenuProps {
    readonly menuState: TemplateMenuState;
    readonly onClose: () => void;
    readonly onDeleteTemplate?: ((template: HeaderTemplate) => unknown) | null;
    readonly onDuplicateTemplate?: ((template: HeaderTemplate) => unknown) | null;
    readonly onEditTemplate?: ((template: HeaderTemplate) => unknown) | null;
    readonly onSetDefaultTemplate?: ((template: HeaderTemplate) => unknown) | null;
}

function TemplateActionsMenu({
    menuState,
    onClose,
    onDeleteTemplate,
    onDuplicateTemplate,
    onEditTemplate,
    onSetDefaultTemplate,
}: TemplateActionsMenuProps) {
    const { t } = useTranslation();
    const template = menuState.tpl;
    return (
        <div
            role="menu"
            data-template-submenu
            className="fixed w-48 bg-[var(--bg-primary)] border border-[var(--border-primary)] rounded-lg shadow-xl z-[var(--z-popover)] py-1 animate-in fade-in zoom-in-95 duration-100"
            style={{
                top: `${String(menuState.top)}px`,
                right: `${String(menuState.right)}px`,
            }}
        >
            {onEditTemplate && (
                <button
                    role="menuitem"
                    onClick={() => {
                        onClose();
                        onEditTemplate(template);
                    }}
                    className="w-full flex items-center gap-2 px-3 py-2 text-sm text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)] transition-colors text-left"
                >
                    <Edit2 size={13} className="text-[var(--text-tertiary)]" />
                    <span>{t('table.edit')}</span>
                </button>
            )}
            {onDuplicateTemplate && (
                <button
                    role="menuitem"
                    onClick={() => {
                        onClose();
                        onDuplicateTemplate(template);
                    }}
                    className="w-full flex items-center gap-2 px-3 py-2 text-sm text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)] transition-colors text-left"
                >
                    <Copy size={13} className="text-[var(--text-tertiary)]" />
                    <span>{t('table.duplicate')}</span>
                </button>
            )}
            {onSetDefaultTemplate && !template.metadata?.is_default_template && (
                <button
                    role="menuitem"
                    onClick={() => {
                        onClose();
                        onSetDefaultTemplate(template);
                    }}
                    className="w-full flex items-center gap-2 px-3 py-2 text-sm text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)] transition-colors text-left"
                >
                    <Star size={13} className="text-[var(--text-tertiary)]" />
                    <span>{t('table.set_default')}</span>
                </button>
            )}
            {onDeleteTemplate && (
                <>
                    <div className="h-px bg-[var(--border-primary)] my-1 mx-2" />
                    <button
                        role="menuitem"
                        onClick={() => {
                            onClose();
                            onDeleteTemplate(template);
                        }}
                        className="w-full flex items-center gap-2 px-3 py-2 text-sm text-red-500 hover:bg-red-500/10 transition-colors text-left"
                    >
                        <Trash2 size={13} />
                        <span>{t('table.delete')}</span>
                    </button>
                </>
            )}
        </div>
    );
}
