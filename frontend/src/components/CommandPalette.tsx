import {
    Fragment,
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState,
    type KeyboardEvent as ReactKeyboardEvent,
    type MouseEvent as ReactMouseEvent,
} from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
    BookOpen,
    Calendar,
    Clock,
    Command,
    FileText,
    Hash,
    Image as ImageIcon,
    LayoutPanelLeft,
    Mail,
    MessageSquare,
    Monitor,
    Moon,
    Network,
    Plus,
    Presentation,
    Puzzle,
    Search,
    Settings,
    Share2,
    Sun,
    Upload,
    Users,
    type LucideIcon,
} from 'lucide-react';

import { usePluginHost } from '../plugins/usePluginHost';
import { runCommand, type PluginCommandContribution } from '../plugins/host';
import { usePlugins } from '../plugins/usePlugins';
import { vaultPath } from '../lib/vaultRouting';
import { importVaultMarkdown, type MarkdownImportResult } from '../shared/api/markdown-import';
import { createVaultPage } from '../shared/api/vaults';
import { emitAppEvent } from '../shared/platform/app-events';
import {
    defineStorageKey,
    stringStorageCodec,
    writeStorage,
} from '../shared/platform/browser-storage';
import { subscribeWindowEvent } from '../shared/platform/browser-events';


type ThemePreference = 'dark' | 'light' | 'system';
type DeferredPaletteEvent =
    | 'gnosi:open-search'
    | 'gnosi:open-tags'
    | 'gnosi:open-workspaces';


interface PaletteCommand {
    readonly icon: LucideIcon;
    readonly id: string;
    readonly kw: readonly string[];
    readonly pluginId?: string;
    readonly run: () => Promise<void> | void;
    readonly section: string;
    readonly title: string;
}


const THEME_KEY = defineStorageKey('db-theme', stringStorageCodec);


function setTheme(preference: ThemePreference): void {
    if (writeStorage(THEME_KEY, preference)) emitAppEvent('db-theme-changed');
}


function emitSoon(name: DeferredPaletteEvent): void {
    setTimeout(() => {
        emitAppEvent(name);
    }, 60);
}


function isUsablePluginCommand(
    command: PluginCommandContribution,
): command is PluginCommandContribution & { readonly id: string; readonly title: string } {
    return typeof command.id === 'string' && typeof command.title === 'string';
}


export default function CommandPalette() {
    const navigate = useNavigate();
    const { t } = useTranslation();
    const [open, setOpen] = useState(false);
    const [query, setQuery] = useState('');
    const [highlighted, setHighlighted] = useState(0);
    const { isEnabled } = usePlugins();
    const inputRef = useRef<HTMLInputElement>(null);
    const listRef = useRef<HTMLUListElement>(null);

    const close = useCallback((): void => {
        setOpen(false);
        setQuery('');
        setHighlighted(0);
    }, []);
    const go = useCallback((path: string): void => {
        void navigate(path);
    }, [navigate]);

    const importSelectedFiles = useCallback(async (files: FileList | null): Promise<void> => {
        const selectedFiles = Array.from(files ?? []);
        if (selectedFiles.length === 0) return;
        try {
            const payload = await Promise.all(selectedFiles.map(async (file) => ({
                content: await file.text(),
                name: file.name,
            })));
            const result: MarkdownImportResult = await importVaultMarkdown({
                files: payload,
                folder: 'Importades',
            });
            emitAppEvent('gnosi:imported', result);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            emitAppEvent('gnosi:imported', { error: message });
        }
    }, []);

    const importNotes = useCallback((): void => {
        const input = document.createElement('input');
        input.type = 'file';
        input.multiple = true;
        input.accept = '.md,.markdown,.txt';
        input.onchange = () => {
            void importSelectedFiles(input.files);
        };
        input.click();
    }, [importSelectedFiles]);

    const createNote = useCallback(async (): Promise<void> => {
        try {
            const page = await createVaultPage({ title: 'Sense títol', content: '', metadata: {} });
            if (page.id) go(vaultPath('knowledge', `page/${page.id}`));
        } catch {
            // The command palette remains usable when note creation is unavailable.
        }
    }, [go]);

    const commands = useMemo<PaletteCommand[]>(() => [
        { id: 'nav-home', title: t('command_palette.nav_home'), section: t('command_palette.section_nav'), icon: Command, kw: ['inici', 'home', 'casa'], run: () => { go('/'); } },
        { id: 'nav-vault', title: t('command_palette.nav_vault'), section: t('command_palette.section_nav'), icon: FileText, kw: ['coneixement', 'vault', 'notes'], run: () => { go(vaultPath('knowledge')); } },
        { id: 'nav-graph', title: t('command_palette.nav_graph'), section: t('command_palette.section_nav'), icon: Network, kw: ['graf', 'graph'], run: () => { go(vaultPath('graph')); } },
        { id: 'nav-contacts', pluginId: 'contacts', title: t('command_palette.nav_contacts'), section: t('command_palette.section_nav'), icon: Users, kw: ['contactes', 'contacts', 'persones'], run: () => { go(vaultPath('contacts')); } },
        { id: 'nav-mail', pluginId: 'mail', title: t('command_palette.nav_mail'), section: t('command_palette.section_nav'), icon: Mail, kw: ['correu', 'mail', 'email'], run: () => { go(vaultPath('mail')); } },
        { id: 'nav-calendar', pluginId: 'calendar', title: t('command_palette.nav_calendar'), section: t('command_palette.section_nav'), icon: Calendar, kw: ['calendari', 'calendar', 'cites'], run: () => { go(vaultPath('calendar')); } },
        { id: 'nav-reader', pluginId: 'feeds-reader', title: t('command_palette.nav_reader'), section: t('command_palette.section_nav'), icon: BookOpen, kw: ['lector', 'reader', 'rss'], run: () => { go(vaultPath('reader')); } },
        { id: 'nav-social', pluginId: 'social-publishing', title: t('command_palette.nav_social'), section: t('command_palette.section_nav'), icon: Share2, kw: ['social', 'xarxes'], run: () => { go(vaultPath('social')); } },
        { id: 'nav-media', pluginId: 'social-publishing', title: t('command_palette.nav_media'), section: t('command_palette.section_nav'), icon: ImageIcon, kw: ['fotos', 'media', 'imatges'], run: () => { go(vaultPath('media')); } },
        { id: 'nav-scheduler', pluginId: 'automations', title: t('command_palette.nav_scheduler'), section: t('command_palette.section_nav'), icon: Clock, kw: ['planificador', 'scheduler', 'tasques'], run: () => { go(vaultPath('automations')); } },
        { id: 'act-newnote', title: t('command_palette.new_note'), section: t('command_palette.section_actions'), icon: Plus, kw: ['nova', 'nota', 'crear', 'new', 'note'], run: createNote },
        { id: 'act-search', title: t('command_palette.global_search'), section: t('command_palette.section_actions'), icon: Search, kw: ['cerca', 'search', 'buscar'], run: () => { go(vaultPath('knowledge')); emitSoon('gnosi:open-search'); } },
        { id: 'act-tags', pluginId: 'tags-page', title: t('command_palette.tags'), section: t('command_palette.section_actions'), icon: Hash, kw: ['etiquetes', 'tags', 'tag', '#'], run: () => { go(vaultPath('knowledge')); emitSoon('gnosi:open-tags'); } },
        { id: 'act-present', title: t('command_palette.presentation_mode'), section: t('command_palette.section_actions'), icon: Presentation, kw: ['presentació', 'presentation', 'slides', 'diapositives'], run: () => { emitAppEvent('gnosi:present'); } },
        { id: 'act-import', title: t('command_palette.import_notes'), section: t('command_palette.section_actions'), icon: Upload, kw: ['importa', 'import', 'markdown', 'obsidian', 'md'], run: importNotes },
        { id: 'act-comments', pluginId: 'page-comments', title: t('command_palette.page_comments'), section: t('command_palette.section_actions'), icon: MessageSquare, kw: ['comentaris', 'comments', 'comentar'], run: () => { emitAppEvent('gnosi:toggle-comments'); } },
        { id: 'act-workspaces', title: t('command_palette.workspaces'), section: t('command_palette.section_actions'), icon: LayoutPanelLeft, kw: ['espais', 'workspace', 'layout', 'disposició', 'pestanyes'], run: () => { go(vaultPath('knowledge')); emitSoon('gnosi:open-workspaces'); } },
        { id: 'theme-light', title: t('command_palette.theme_light'), section: t('command_palette.section_appearance'), icon: Sun, kw: ['tema', 'clar', 'light', 'theme'], run: () => { setTheme('light'); } },
        { id: 'theme-dark', title: t('command_palette.theme_dark'), section: t('command_palette.section_appearance'), icon: Moon, kw: ['tema', 'fosc', 'dark', 'theme'], run: () => { setTheme('dark'); } },
        { id: 'theme-system', title: t('command_palette.theme_system'), section: t('command_palette.section_appearance'), icon: Monitor, kw: ['tema', 'sistema', 'system', 'auto'], run: () => { setTheme('system'); } },
        { id: 'act-settings', title: t('command_palette.open_settings'), section: t('command_palette.section_actions'), icon: Settings, kw: ['configuració', 'settings', 'preferències', 'ajustos'], run: () => { emitAppEvent('gnosi:open-settings'); } },
    ].filter((command) => !command.pluginId || isEnabled(command.pluginId)), [createNote, go, importNotes, isEnabled, t]);

    const { commands: pluginCommands } = usePluginHost();
    const allCommands = useMemo<PaletteCommand[]>(() => {
        const extra = pluginCommands.filter(isUsablePluginCommand).map((command) => ({
            id: `plugin:${command.pluginId}:${command.id}`,
            title: command.title,
            section: t('command_palette.section_plugins', 'Plugins'),
            icon: Puzzle,
            kw: [command.title.toLowerCase(), 'plugin'],
            run: () => {
                runCommand(command.pluginId, command.id);
            },
        }));
        return [...commands, ...extra];
    }, [commands, pluginCommands, t]);

    const filtered = useMemo(() => {
        const normalizedQuery = query.trim().toLowerCase();
        if (!normalizedQuery) return allCommands;
        return allCommands.filter((command) => (
            command.title.toLowerCase().includes(normalizedQuery)
            || command.kw.some((keyword) => keyword.includes(normalizedQuery))
        ));
    }, [allCommands, query]);

    useEffect(() => subscribeWindowEvent('keydown', (event) => {
        if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.key.toLowerCase() === 'p') {
            event.preventDefault();
            setOpen((value) => !value);
        }
    }), []);

    useEffect(() => {
        if (!open) return undefined;
        const timeoutId = setTimeout(() => {
            inputRef.current?.focus();
        }, 20);
        return () => {
            clearTimeout(timeoutId);
        };
    }, [open]);

    const runAt = useCallback((index: number): void => {
        const command = filtered[index];
        if (!command) return;
        close();
        void command.run();
    }, [close, filtered]);

    const onInputKey = (event: ReactKeyboardEvent<HTMLInputElement>): void => {
        if (event.key === 'ArrowDown') {
            event.preventDefault();
            setHighlighted((index) => Math.min(index + 1, filtered.length - 1));
        } else if (event.key === 'ArrowUp') {
            event.preventDefault();
            setHighlighted((index) => Math.max(index - 1, 0));
        } else if (event.key === 'Enter') {
            event.preventDefault();
            runAt(highlighted);
        } else if (event.key === 'Escape') {
            event.preventDefault();
            close();
        }
    };

    useEffect(() => {
        if (!open || !listRef.current) return;
        listRef.current.querySelector<HTMLElement>(`[data-idx="${String(highlighted)}"]`)
            ?.scrollIntoView({ block: 'nearest' });
    }, [highlighted, open]);

    if (!open) return null;

    let lastSection: string | null = null;
    return <div
        className="fixed inset-0 z-[var(--z-command)] flex items-start justify-center bg-black/30 pt-[12vh]"
        onMouseDown={(event: ReactMouseEvent<HTMLDivElement>) => {
            if (event.target === event.currentTarget) close();
        }}
    >
        <div className="w-full max-w-lg overflow-hidden rounded-xl border border-[var(--border-primary)] bg-[var(--bg-primary)] shadow-2xl">
            <div className="flex items-center gap-2 border-b border-[var(--border-primary)] px-3 py-2.5">
                <Command size={16} className="text-[var(--text-tertiary)]" />
                <input
                    ref={inputRef}
                    value={query}
                    onChange={(event) => {
                        setQuery(event.target.value);
                        setHighlighted(0);
                    }}
                    onKeyDown={onInputKey}
                    placeholder={t('command_palette.input_placeholder')}
                    className="flex-1 bg-transparent text-sm text-[var(--text-primary)] outline-none placeholder:text-[var(--text-tertiary)]"
                />
                <kbd className="rounded border border-[var(--border-primary)] px-1.5 py-0.5 text-[10px] text-[var(--text-tertiary)]">Esc</kbd>
            </div>
            <ul ref={listRef} className="max-h-80 overflow-auto py-1">
                {filtered.length === 0 ? <li className="px-4 py-6 text-center text-sm text-[var(--text-tertiary)]">
                    {t('command_palette.no_commands')}
                </li> : null}
                {filtered.map((command, index) => {
                    const Icon = command.icon;
                    const showSection = command.section !== lastSection;
                    lastSection = command.section;
                    return <Fragment key={command.id}>
                        {showSection ? <li className="px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wider text-[var(--text-tertiary)]">
                            {command.section}
                        </li> : null}
                        <li
                            data-idx={index}
                            onMouseEnter={() => {
                                setHighlighted(index);
                            }}
                            onMouseDown={(event) => {
                                event.preventDefault();
                                runAt(index);
                            }}
                            className={`mx-1 flex cursor-pointer items-center gap-2.5 rounded-md px-3 py-2 text-sm ${index === highlighted ? 'bg-[var(--gnosi-primary)]/12 text-[var(--gnosi-primary)]' : 'text-[var(--text-primary)]'}`}
                        >
                            <Icon size={16} className={index === highlighted ? 'text-[var(--gnosi-primary)]' : 'text-[var(--text-tertiary)]'} />
                            {command.title}
                        </li>
                    </Fragment>;
                })}
            </ul>
        </div>
    </div>;
}
