import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AtSign, Bookmark, Code2, Link2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';

const MENU_WIDTH = 320;
const VIEWPORT_GAP = 12;

export function ContextualLinkPasteMenu({ position, onChoose, onClose }) {
    const { t } = useTranslation();
    const menuRef = useRef(null);
    const itemRefs = useRef([]);
    const [activeIndex, setActiveIndex] = useState(0);

    const items = useMemo(() => [
        {
            key: 'mention',
            icon: AtSign,
            label: t('editor.link_paste_mention', { defaultValue: 'Mention' }),
            description: t('editor.link_paste_mention_help', { defaultValue: 'Compact title with icon' }),
        },
        {
            key: 'embed',
            icon: Code2,
            label: t('editor.link_paste_embed', { defaultValue: 'Embed' }),
            description: t('editor.link_paste_embed_help', { defaultValue: 'Interactive content in the page' }),
        },
        {
            key: 'bookmark',
            icon: Bookmark,
            label: t('editor.link_paste_bookmark', { defaultValue: 'Bookmark' }),
            description: t('editor.link_paste_bookmark_help', { defaultValue: 'Card with title, description, and image' }),
        },
        {
            key: 'url',
            icon: Link2,
            label: t('editor.link_paste_url', { defaultValue: 'URL' }),
            description: t('editor.link_paste_url_help', { defaultValue: 'Conventional text link' }),
        },
    ], [t]);

    useEffect(() => {
        itemRefs.current[0]?.focus();
        const handlePointerDown = (event) => {
            if (!menuRef.current?.contains(event.target)) onClose?.();
        };
        document.addEventListener('pointerdown', handlePointerDown, true);
        return () => document.removeEventListener('pointerdown', handlePointerDown, true);
    }, [onClose]);

    const choose = (key) => onChoose?.(key);
    const handleKeyDown = (event) => {
        if (event.key === 'Escape') {
            event.preventDefault();
            onClose?.();
            return;
        }
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            const direction = event.key === 'ArrowDown' ? 1 : -1;
            const next = (activeIndex + direction + items.length) % items.length;
            setActiveIndex(next);
            itemRefs.current[next]?.focus();
            return;
        }
        if (event.key === 'Home' || event.key === 'End') {
            event.preventDefault();
            const next = event.key === 'Home' ? 0 : items.length - 1;
            setActiveIndex(next);
            itemRefs.current[next]?.focus();
        }
    };

    const left = Math.max(VIEWPORT_GAP, Math.min(position.left, window.innerWidth - MENU_WIDTH - VIEWPORT_GAP));
    const top = Math.max(VIEWPORT_GAP, Math.min(position.top, window.innerHeight - 330));

    return (
        <div
            ref={menuRef}
            role="menu"
            aria-label={t('editor.link_paste_title', { defaultValue: 'Paste as…' })}
            onKeyDown={handleKeyDown}
            className="fixed overflow-hidden rounded-xl border border-[var(--border-primary)] bg-[var(--bg-primary)] shadow-2xl"
            style={{ left, top, width: MENU_WIDTH, zIndex: 'var(--z-popover, 1000)' }}
        >
            <div className="border-b border-[var(--border-primary)] px-3 py-2 text-xs font-semibold text-[var(--text-secondary)]">
                {t('editor.link_paste_title', { defaultValue: 'Paste as…' })}
            </div>
            <div className="p-1.5">
                {items.map(({ key, icon: Icon, label, description }, index) => (
                    <button
                        key={key}
                        ref={(node) => { itemRefs.current[index] = node; }}
                        type="button"
                        role="menuitem"
                        onFocus={() => setActiveIndex(index)}
                        onClick={() => choose(key)}
                        className={`flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left transition-colors ${activeIndex === index ? 'bg-[var(--bg-tertiary)]' : 'hover:bg-[var(--bg-secondary)]'}`}
                    >
                        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-[var(--border-primary)] bg-[var(--bg-secondary)] text-[var(--text-secondary)]">
                            <Icon size={16} />
                        </span>
                        <span className="min-w-0">
                            <span className="block text-sm font-medium text-[var(--text-primary)]">{label}</span>
                            <span className="block truncate text-xs text-[var(--text-tertiary)]">{description}</span>
                        </span>
                    </button>
                ))}
            </div>
        </div>
    );
}

export default ContextualLinkPasteMenu;
