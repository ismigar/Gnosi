import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import axios from 'axios';
import {
    Command, Search, FileText, Network, Users, Mail, Calendar, BookOpen,
    Share2, Image as ImageIcon, Clock, Plus, Sun, Moon, Monitor, Settings, Hash, Presentation, Upload, MessageSquare, LayoutPanelLeft, Puzzle,
} from 'lucide-react';
import { usePluginHost } from '../plugins/usePluginHost';
import { runCommand } from '../plugins/host';

/**
 * CommandPalette
 * Global command palette, Obsidian/VSCode style (Cmd/Ctrl+Shift+P). Lists
 * searchable actions: navigation between sections, creating a note, switching theme, and
 * opening settings. Navigable with keyboard (↑↓/Enter/Esc) and mouse,
 * sharing a single `highlightedIndex` (see feedback_autocomplete_keyboard_nav).
 */

const setTheme = (pref) => {
    try {
        localStorage.setItem('db-theme', pref);
        window.dispatchEvent(new Event('db-theme-changed'));
    } catch { /* noop */ }
};

export default function CommandPalette() {
    const navigate = useNavigate();
    const { t } = useTranslation();
    const [open, setOpen] = useState(false);
    const [query, setQuery] = useState('');
    const [highlighted, setHighlighted] = useState(0);
    const inputRef = useRef(null);
    const listRef = useRef(null);

    const close = useCallback(() => { setOpen(false); setQuery(''); setHighlighted(0); }, []);

    const importNotes = useCallback(() => {
        const inp = document.createElement('input');
        inp.type = 'file';
        inp.multiple = true;
        inp.accept = '.md,.markdown,.txt';
        inp.onchange = async () => {
            const files = Array.from(inp.files || []);
            if (!files.length) return;
            try {
                const payload = await Promise.all(files.map(async (f) => ({ name: f.name, content: await f.text() })));
                const res = await axios.post('/api/vault/import', { files: payload, folder: 'Importades' });
                window.dispatchEvent(new CustomEvent('gnosi:imported', { detail: res.data }));
            } catch (e) {
                window.dispatchEvent(new CustomEvent('gnosi:imported', { detail: { error: String(e?.message || e) } }));
            }
        };
        inp.click();
    }, []);

    const createNote = useCallback(async () => {
        try {
            const res = await axios.post('/api/vault/pages', { title: 'Sense títol', content: '', metadata: {} });
            const id = res?.data?.id;
            if (id) navigate(`/vault/page/${id}`);
        } catch { /* noop */ }
    }, [navigate]);

    const commands = useMemo(() => [
        { id: 'nav-home', title: t('command_palette.nav_home'), section: t('command_palette.section_nav'), icon: Command, kw: ['inici', 'home', 'casa'], run: () => navigate('/') },
        { id: 'nav-vault', title: t('command_palette.nav_vault'), section: t('command_palette.section_nav'), icon: FileText, kw: ['coneixement', 'vault', 'notes'], run: () => navigate('/vault') },
        { id: 'nav-graph', title: t('command_palette.nav_graph'), section: t('command_palette.section_nav'), icon: Network, kw: ['graf', 'graph'], run: () => navigate('/graph') },
        { id: 'nav-contacts', title: t('command_palette.nav_contacts'), section: t('command_palette.section_nav'), icon: Users, kw: ['contactes', 'contacts', 'persones'], run: () => navigate('/contacts') },
        { id: 'nav-mail', title: t('command_palette.nav_mail'), section: t('command_palette.section_nav'), icon: Mail, kw: ['correu', 'mail', 'email'], run: () => navigate('/mail') },
        { id: 'nav-calendar', title: t('command_palette.nav_calendar'), section: t('command_palette.section_nav'), icon: Calendar, kw: ['calendari', 'calendar', 'cites'], run: () => navigate('/calendar') },
        { id: 'nav-reader', title: t('command_palette.nav_reader'), section: t('command_palette.section_nav'), icon: BookOpen, kw: ['lector', 'reader', 'rss'], run: () => navigate('/reader') },
        { id: 'nav-social', title: t('command_palette.nav_social'), section: t('command_palette.section_nav'), icon: Share2, kw: ['social', 'xarxes'], run: () => navigate('/social-dashboard') },
        { id: 'nav-media', title: t('command_palette.nav_media'), section: t('command_palette.section_nav'), icon: ImageIcon, kw: ['fotos', 'media', 'imatges'], run: () => navigate('/media') },
        { id: 'nav-scheduler', title: t('command_palette.nav_scheduler'), section: t('command_palette.section_nav'), icon: Clock, kw: ['planificador', 'scheduler', 'tasques'], run: () => navigate('/scheduler') },
        { id: 'act-newnote', title: t('command_palette.new_note'), section: t('command_palette.section_actions'), icon: Plus, kw: ['nova', 'nota', 'crear', 'new', 'note'], run: createNote },
        { id: 'act-search', title: t('command_palette.global_search'), section: t('command_palette.section_actions'), icon: Search, kw: ['cerca', 'search', 'buscar'], run: () => { navigate('/vault'); setTimeout(() => window.dispatchEvent(new CustomEvent('gnosi:open-search')), 60); } },
        { id: 'act-tags', title: t('command_palette.tags'), section: t('command_palette.section_actions'), icon: Hash, kw: ['etiquetes', 'tags', 'tag', '#'], run: () => { navigate('/vault'); setTimeout(() => window.dispatchEvent(new CustomEvent('gnosi:open-tags')), 60); } },
        { id: 'act-present', title: t('command_palette.presentation_mode'), section: t('command_palette.section_actions'), icon: Presentation, kw: ['presentació', 'presentation', 'slides', 'diapositives'], run: () => window.dispatchEvent(new CustomEvent('gnosi:present')) },
        { id: 'act-import', title: t('command_palette.import_notes'), section: t('command_palette.section_actions'), icon: Upload, kw: ['importa', 'import', 'markdown', 'obsidian', 'md'], run: importNotes },
        { id: 'act-comments', title: t('command_palette.page_comments'), section: t('command_palette.section_actions'), icon: MessageSquare, kw: ['comentaris', 'comments', 'comentar'], run: () => window.dispatchEvent(new CustomEvent('gnosi:toggle-comments')) },
        { id: 'act-workspaces', title: t('command_palette.workspaces'), section: t('command_palette.section_actions'), icon: LayoutPanelLeft, kw: ['espais', 'workspace', 'layout', 'disposició', 'pestanyes'], run: () => { navigate('/vault'); setTimeout(() => window.dispatchEvent(new CustomEvent('gnosi:open-workspaces')), 60); } },
        { id: 'theme-light', title: t('command_palette.theme_light'), section: t('command_palette.section_appearance'), icon: Sun, kw: ['tema', 'clar', 'light', 'theme'], run: () => setTheme('light') },
        { id: 'theme-dark', title: t('command_palette.theme_dark'), section: t('command_palette.section_appearance'), icon: Moon, kw: ['tema', 'fosc', 'dark', 'theme'], run: () => setTheme('dark') },
        { id: 'theme-system', title: t('command_palette.theme_system'), section: t('command_palette.section_appearance'), icon: Monitor, kw: ['tema', 'sistema', 'system', 'auto'], run: () => setTheme('system') },
        { id: 'act-settings', title: t('command_palette.open_settings'), section: t('command_palette.section_actions'), icon: Settings, kw: ['configuració', 'settings', 'preferències', 'ajustos'], run: () => window.dispatchEvent(new CustomEvent('gnosi:open-settings')) },
    ], [navigate, createNote, importNotes, t]);

    // Commands contributed by third-party plugins (executed in the iframe
    // sandbox via runCommand). They are merged under the "Plugins" section.
    const { commands: pluginCommands } = usePluginHost();
    const allCommands = useMemo(() => {
        const extra = (pluginCommands || []).map((pc) => ({
            id: `plugin:${pc.pluginId}:${pc.id}`,
            title: pc.title,
            section: t('command_palette.section_plugins', 'Plugins'),
            icon: Puzzle,
            kw: [pc.title.toLowerCase(), 'plugin'],
            run: () => runCommand(pc.pluginId, pc.id),
        }));
        return [...commands, ...extra];
    }, [commands, pluginCommands, t]);

    const filtered = useMemo(() => {
        const q = query.trim().toLowerCase();
        if (!q) return allCommands;
        return allCommands.filter(c =>
            c.title.toLowerCase().includes(q) || c.kw.some(k => k.includes(q))
        );
    }, [allCommands, query]);

    // Global open shortcut (Cmd/Ctrl+Shift+P).
    useEffect(() => {
        const onKey = (e) => {
            if ((e.metaKey || e.ctrlKey) && e.shiftKey && (e.key === 'p' || e.key === 'P')) {
                e.preventDefault();
                setOpen((v) => !v);
            }
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, []);

    useEffect(() => { if (open) setTimeout(() => inputRef.current?.focus(), 20); }, [open]);
    useEffect(() => { setHighlighted(0); }, [query]);

    const runAt = useCallback((idx) => {
        const cmd = filtered[idx];
        if (!cmd) return;
        close();
        cmd.run();
    }, [filtered, close]);

    const onInputKey = (e) => {
        if (e.key === 'ArrowDown') { e.preventDefault(); setHighlighted(i => Math.min(i + 1, filtered.length - 1)); }
        else if (e.key === 'ArrowUp') { e.preventDefault(); setHighlighted(i => Math.max(i - 1, 0)); }
        else if (e.key === 'Enter') { e.preventDefault(); runAt(highlighted); }
        else if (e.key === 'Escape') { e.preventDefault(); close(); }
    };

    // Keeps the highlighted element visible.
    useEffect(() => {
        if (!open || !listRef.current) return;
        const el = listRef.current.querySelector(`[data-idx="${highlighted}"]`);
        el?.scrollIntoView({ block: 'nearest' });
    }, [highlighted, open]);

    if (!open) return null;

    let lastSection = null;
    return (
        <div
            className="fixed inset-0 z-[100002] flex items-start justify-center bg-black/30 pt-[12vh]"
            onMouseDown={(e) => { if (e.target === e.currentTarget) close(); }}
        >
            <div className="w-full max-w-lg overflow-hidden rounded-xl border border-[var(--border-primary)] bg-[var(--bg-primary)] shadow-2xl">
                <div className="flex items-center gap-2 border-b border-[var(--border-primary)] px-3 py-2.5">
                    <Command size={16} className="text-[var(--text-tertiary)]" />
                    <input
                        ref={inputRef}
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        onKeyDown={onInputKey}
                        placeholder={t('command_palette.input_placeholder')}
                        className="flex-1 bg-transparent text-sm text-[var(--text-primary)] outline-none placeholder:text-[var(--text-tertiary)]"
                    />
                    <kbd className="rounded border border-[var(--border-primary)] px-1.5 py-0.5 text-[10px] text-[var(--text-tertiary)]">Esc</kbd>
                </div>
                <ul ref={listRef} className="max-h-80 overflow-auto py-1">
                    {filtered.length === 0 && (
                        <li className="px-4 py-6 text-center text-sm text-[var(--text-tertiary)]">{t('command_palette.no_commands')}</li>
                    )}
                    {filtered.map((c, i) => {
                        const Icon = c.icon;
                        const showSection = c.section !== lastSection;
                        lastSection = c.section;
                        return (
                            <React.Fragment key={c.id}>
                                {showSection && (
                                    <li className="px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wider text-[var(--text-tertiary)]">{c.section}</li>
                                )}
                                <li
                                    data-idx={i}
                                    onMouseEnter={() => setHighlighted(i)}
                                    onMouseDown={(e) => { e.preventDefault(); runAt(i); }}
                                    className={`mx-1 flex cursor-pointer items-center gap-2.5 rounded-md px-3 py-2 text-sm ${i === highlighted ? 'bg-[var(--gnosi-primary)]/12 text-[var(--gnosi-primary)]' : 'text-[var(--text-primary)]'}`}
                                >
                                    <Icon size={16} className={i === highlighted ? 'text-[var(--gnosi-primary)]' : 'text-[var(--text-tertiary)]'} />
                                    {c.title}
                                </li>
                            </React.Fragment>
                        );
                    })}
                </ul>
            </div>
        </div>
    );
}
