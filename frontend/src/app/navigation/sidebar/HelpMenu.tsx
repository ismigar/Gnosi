import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { CircleHelp, ExternalLink } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useLocation } from 'react-router-dom';
import { contextualHelpTopic, helpUrl } from '../../../shared/help/helpLinks';
import { useModalKeyboard } from '../../../shared/hooks/useModalKeyboard';
import { subscribeDocumentEvent } from '../../../shared/platform/browser-events';

export function HelpMenu({ onSelect }: { readonly onSelect: () => void }) {
    const { t, i18n } = useTranslation();
    const { pathname } = useLocation();
    const [open, setOpen] = useState(false);
    const root = useRef<HTMLDivElement>(null);
    const trigger = useRef<HTMLButtonElement>(null);
    const menu = useRef<HTMLDivElement>(null);
    const id = useId();
    const initialFocus = useRef<'first' | 'last'>('first');
    useModalKeyboard({ isOpen: open, onClose: () => {
        setOpen(false);
        trigger.current?.focus();
    } });
    const language = i18n.resolvedLanguage || i18n.language;
    const items = [
        { label: t('help.center', 'Help center'), url: helpUrl(language) },
        { label: t('help.getting_started', 'Getting started'), url: helpUrl(language, 'getting-started') },
        { label: t('help.this_section', 'Help with this section'), url: helpUrl(language, contextualHelpTopic(pathname)) },
        { label: t('help.engineering', 'Engineering documentation'), url: helpUrl(language, '', true) },
    ];

    useEffect(() => {
        if (!open) return;
        const links = menu.current?.querySelectorAll<HTMLAnchorElement>('a');
        links?.[initialFocus.current === 'last' ? links.length - 1 : 0]?.focus();
        return subscribeDocumentEvent('pointerdown', (event: PointerEvent) => {
            if (event.target instanceof Node && !root.current?.contains(event.target)) setOpen(false);
        });
    }, [open]);

    const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
        if (event.key === 'Escape' && open) {
            event.preventDefault();
            event.stopPropagation();
            setOpen(false);
            trigger.current?.focus();
        }
        if (!open && ['ArrowDown', 'ArrowUp'].includes(event.key)) {
            event.preventDefault();
            initialFocus.current = event.key === 'ArrowUp' ? 'last' : 'first';
            setOpen(true);
            return;
        }
        const links = [...(menu.current?.querySelectorAll<HTMLAnchorElement>('a') ?? [])];
        const index = links.findIndex((link) => link === document.activeElement);
        if (event.key === ' ' && index >= 0) {
            event.preventDefault();
            links[index]?.click();
        }
        const direction = event.key === 'ArrowDown' ? 1 : event.key === 'ArrowUp' ? -1 : 0;
        if (open && (direction || event.key === 'Home' || event.key === 'End')) {
            event.preventDefault();
            const next = event.key === 'Home' ? 0 : event.key === 'End' ? links.length - 1
                : (index + direction + links.length) % links.length;
            links[next]?.focus();
        }
    };

    return <div ref={root} className="app-help" onKeyDown={onKeyDown} onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
    }}>
        <button ref={trigger} type="button" className="app-sidebar__item"
            aria-label={t('help.menu', 'Help')} title={t('help.menu', 'Help')}
            aria-haspopup="menu" aria-expanded={open} aria-controls={open ? id : undefined}
            onClick={() => { initialFocus.current = 'first'; setOpen((value) => !value); }}>
            <CircleHelp size={16} strokeWidth={1.5} />
            <span className="app-sidebar__tooltip">{t('help.menu', 'Help')}</span>
        </button>
        {open && <div ref={menu} id={id} role="menu" aria-label={t('help.menu', 'Help')} className="app-help__menu">
            {items.map(({ label, url }) => <a key={label} role="menuitem" href={url}
                target="_blank" rel="noopener noreferrer" aria-label={label}
                onClick={() => { setOpen(false); trigger.current?.focus(); onSelect(); }}>
                <span>{label}</span><ExternalLink size={14} aria-hidden="true" />
            </a>)}
        </div>}
    </div>;
}
