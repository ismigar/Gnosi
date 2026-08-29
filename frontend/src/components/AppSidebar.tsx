import {
    lazy,
    Suspense,
    useEffect,
    useMemo,
    useRef,
    useState,
    type ComponentType,
} from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Menu, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { fetchSystemHealth } from '../shared/api/system';
// The Settings modal drags in the BlockEditor (blocknote/tiptap) and other
// heavy views. By lazy-loading it we avoid these libraries
// entering the initial bundle just because the sidebar references the modal.
const GlobalSettingsModal = lazy(() =>
  import('./GlobalSettingsModal').then((m) => ({ default: m.GlobalSettingsModal })),
) as unknown as ComponentType<GlobalSettingsModalProps>;
import { WorkspaceSwitcher } from './Navigation/WorkspaceSwitcher';
import {
    QuickAccessMenu,
    SidebarFooter,
    SidebarRail,
} from './app-sidebar/AppSidebarNavigation';
import {
    APP_SIDEBAR_ITEMS as navItems,
    type SidebarNavItem,
} from './app-sidebar/appSidebarModel';
import { useAuth } from '../context/auth-context';
import { toast } from '../lib/toast';
import { usePlugins } from '../plugins/usePlugins';
import { useMediaQuery } from '../hooks/useMediaQuery';
import { useModalKeyboard } from '../hooks/useModalKeyboard';
import {
    normalizeSidebarPreferences,
    orderSidebarItems,
    type SidebarPreferences,
} from '../lib/appSidebarNavigation';
import { legacyBrowserPathToCanonical } from '../lib/vaultRouting';
import {
    subscribeAppEvent,
    type OpenSettingsEventDetail,
} from '../shared/platform/app-events';
import {
    subscribeDocumentEvent,
    subscribeWindowEvent,
} from '../shared/platform/browser-events';


interface GlobalSettingsModalProps {
    readonly initialPluginId: string | null;
    readonly initialTab: string;
    readonly isOpen: boolean;
    readonly onClose: () => void;
    readonly sidebarNavigation: {
        readonly items: readonly SidebarNavItem[];
        readonly onMovePinned: (route: string, offset: -1 | 1) => void;
        readonly onTogglePinned: (route: string) => void;
        readonly pinnedRoutes: readonly string[];
    };
}

export { ENGINEERING_DOCUMENTATION_URL } from './app-sidebar/appSidebarModel';

const SIDEBAR_SETTINGS_ID = 'app-sidebar';

function getInitialSettingsRequest(): { readonly open: boolean; readonly tab: string } {
    const params = new URLSearchParams(window.location.search);
    return {
        open: params.has('auth'),
        tab: params.get('tab') || 'general',
    };
}

function readSidebarPreferences(value: unknown): SidebarPreferences | null {
    if (typeof value !== 'object' || value === null || !('pinnedRoutes' in value)) return null;
    return Array.isArray(value.pinnedRoutes) ? { pinnedRoutes: value.pinnedRoutes } : null;
}


export function AppSidebar() {
    const initialSettingsRequest = getInitialSettingsRequest();
    const [mobileOpen, setMobileOpen] = useState(false);
    const [settingsOpen, setSettingsOpen] = useState(initialSettingsRequest.open);
    const [settingsTab, setSettingsTab] = useState(initialSettingsRequest.tab);
    const [settingsPluginId, setSettingsPluginId] = useState<string | null>(null);
    const [gnosiMode, setGnosiMode] = useState('personal');
    const [quickAccessOpen, setQuickAccessOpen] = useState(false);
    const mobileToggleRef = useRef<HTMLButtonElement>(null);
    const navigationRef = useRef<HTMLElement>(null);
    const quickAccessRef = useRef<HTMLElement>(null);
    const quickAccessTriggerRef = useRef<HTMLButtonElement>(null);
    const isCompact = useMediaQuery('(max-width: 767px)');
    const { t } = useTranslation();
    const navigate = useNavigate();
    const location = useLocation();
    const { user, logout } = useAuth();
    const { isEnabled, getPluginSettings, setPluginSettings } = usePlugins();
    const visibleNavItems = useMemo(
        () => navItems.filter((item) => !item.pluginId || isEnabled(item.pluginId)),
        [isEnabled],
    );
    const sidebarPreferences = useMemo(
        () => normalizeSidebarPreferences(
            visibleNavItems,
            readSidebarPreferences(getPluginSettings(SIDEBAR_SETTINGS_ID)),
        ),
        [getPluginSettings, visibleNavItems],
    );
    const pinnedNavItems = useMemo(
        () => orderSidebarItems(visibleNavItems, sidebarPreferences.pinnedRoutes),
        [sidebarPreferences.pinnedRoutes, visibleNavItems],
    );
    const activeNavItem = visibleNavItems.find((item) => {
        const canonical = legacyBrowserPathToCanonical(item.to);
        return location.pathname === canonical || location.pathname.startsWith(`${canonical}/`);
    });
    const railNavItems = activeNavItem && !pinnedNavItems.some((item) => item.to === activeNavItem.to)
        ? [...pinnedNavItems, activeNavItem]
        : pinnedNavItems;
    const railRoutes = new Set(railNavItems.map((item) => item.to));
    const quickAccessItems = visibleNavItems.filter((item) => !railRoutes.has(item.to));

    useModalKeyboard({
        isOpen: isCompact && mobileOpen,
        onClose: () => {
            setMobileOpen(false);
        },
        containerRef: navigationRef,
        trapFocus: true,
    });

    // The command palette (and other places) can request opening settings.
    useEffect(() => {
        return subscribeAppEvent('gnosi:open-settings', () => {
            setSettingsOpen(true);
        });
    }, []);

    useEffect(() => {
        if (!quickAccessOpen) return undefined;
        const closeOnPointerDown = (event: PointerEvent): void => {
            if (!(event.target instanceof Node)) return;
            if (quickAccessRef.current?.contains(event.target)) return;
            if (quickAccessTriggerRef.current?.contains(event.target)) return;
            setQuickAccessOpen(false);
        };
        const closeOnEscape = (event: KeyboardEvent): void => {
            if (event.key === 'Escape') {
                setQuickAccessOpen(false);
                quickAccessTriggerRef.current?.focus();
            }
        };
        const unsubscribePointer = subscribeDocumentEvent('pointerdown', closeOnPointerDown);
        const unsubscribeKeyboard = subscribeWindowEvent('keydown', closeOnEscape);
        return () => {
            unsubscribePointer();
            unsubscribeKeyboard();
        };
    }, [quickAccessOpen]);

    const handleLogout = async (): Promise<void> => {
        await logout();
        toast.success(t('sidebar.logged_out', "Signed out."));
    };

    const savePinnedRoutes = (pinnedRoutes: readonly string[]): void => {
        void setPluginSettings(SIDEBAR_SETTINGS_ID, { pinnedRoutes });
    };

    const togglePinnedRoute = (route: string): void => {
        const pinnedRoutes = sidebarPreferences.pinnedRoutes.includes(route)
            ? sidebarPreferences.pinnedRoutes.filter((candidate) => candidate !== route)
            : [...sidebarPreferences.pinnedRoutes, route];
        savePinnedRoutes(pinnedRoutes);
    };

    const movePinnedRoute = (route: string, offset: -1 | 1): void => {
        const currentIndex = sidebarPreferences.pinnedRoutes.indexOf(route);
        const nextIndex = currentIndex + offset;
        if (currentIndex < 0 || nextIndex < 0 || nextIndex >= sidebarPreferences.pinnedRoutes.length) return;
        const pinnedRoutes = [...sidebarPreferences.pinnedRoutes];
        const currentRoute = pinnedRoutes[currentIndex];
        const nextRoute = pinnedRoutes[nextIndex];
        if (currentRoute === undefined || nextRoute === undefined) return;
        pinnedRoutes[currentIndex] = nextRoute;
        pinnedRoutes[nextIndex] = currentRoute;
        savePinnedRoutes(pinnedRoutes);
    };

    useEffect(() => {
        // Fetch health to get gnosi_mode
        fetchSystemHealth()
            .then((data) => {
                if (data.gnosi_mode) setGnosiMode(data.gnosi_mode);
            })
            .catch(() => undefined);

        // Detect OAuth return params
        const params = new URLSearchParams(window.location.search);
        if (params.get('auth')) {
            // Clean up URL params without refreshing
            const newUrl = window.location.pathname;
            window.history.replaceState({}, '', newUrl);
        }

        const handleOpenSettings = (detail: OpenSettingsEventDetail): void => {
            if (detail) {
                if (typeof detail === 'string') {
                    setSettingsTab(detail);
                    setSettingsPluginId(null);
                } else {
                    setSettingsTab(detail.tab || 'general');
                    setSettingsPluginId(detail.pluginId || null);
                }
            } else {
                setSettingsPluginId(null);
            }
            setSettingsOpen(true);
        };
        return subscribeAppEvent('open-settings', handleOpenSettings);
    }, []);

    useEffect(() => {
        const handler = (event: KeyboardEvent): void => {
            if (!event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;
            const activeElement = document.activeElement;
            const tag = activeElement?.tagName;
            if (
                tag === 'INPUT'
                || tag === 'TEXTAREA'
                || (activeElement instanceof HTMLElement && activeElement.isContentEditable)
            ) return;
            const target = navItems.find((item) => item.shortcut === `Ctrl ${event.key}`);
            if (target && (!target.pluginId || isEnabled(target.pluginId))) {
                event.preventDefault();
                void navigate(legacyBrowserPathToCanonical(target.to));
                setMobileOpen(false);
            } else if (event.key === ',') {
                event.preventDefault();
                setSettingsOpen(true);
            }
        };
        return subscribeWindowEvent('keydown', handler);
    }, [isEnabled, navigate]);

    const closeNavigation = (): void => {
        setMobileOpen(false);
        setQuickAccessOpen(false);
    };
    const openSettings = (): void => {
        setSettingsOpen(true);
    };
    const userLabel = user ? user.name || user.email : null;

    return (
        <>
            {/* Mobile Toggle */}
            <button
                ref={mobileToggleRef}
                className="app-sidebar-mobile-toggle"
                onClick={() => {
                    setMobileOpen(!mobileOpen);
                }}
                aria-expanded={mobileOpen}
                aria-controls="gnosi-global-navigation"
                aria-label={t('sidebar.toggle_navigation', 'Toggle navigation')}
            >
                {mobileOpen ? <X size={20} /> : <Menu size={20} />}
            </button>

            {/* Overlay */}
            {mobileOpen && (
                <div
                    className="app-sidebar-overlay"
                    onClick={() => {
                        setMobileOpen(false);
                    }}
                    aria-hidden="true"
                />
            )}

            {/* Sidebar */}
            <nav
                ref={navigationRef}
                id="gnosi-global-navigation"
                aria-label={t('sidebar.main_navigation', 'Main navigation')}
                aria-hidden={isCompact && !mobileOpen ? 'true' : undefined}
                inert={isCompact && !mobileOpen}
                className={`app-sidebar ${mobileOpen ? 'app-sidebar--open' : ''}`}
            >
                <div className="app-sidebar__header">
                    {/* Logo */}
                    <div className="app-sidebar__logo-wrapper">
                        <Link
                            to="/"
                            className="app-sidebar__logo"
                            title="Gnosi"
                            aria-label={t('command_palette.nav_home', 'Go to Home')}
                            onClick={() => {
                                setMobileOpen(false);
                            }}
                        >
                            G
                        </Link>
                    </div>

                    {gnosiMode !== 'personal' && <WorkspaceSwitcher />}
                </div>

                <SidebarRail
                    items={railNavItems}
                    onSelect={closeNavigation}
                    onToggleQuickAccess={() => {
                        setQuickAccessOpen((open) => !open);
                    }}
                    quickAccessOpen={quickAccessOpen}
                    quickAccessTriggerRef={quickAccessTriggerRef}
                    showQuickAccess={quickAccessItems.length > 0}
                />
                <SidebarFooter
                    isPersonal={gnosiMode === 'personal'}
                    onLogout={handleLogout}
                    onOpenSettings={openSettings}
                    onSelect={closeNavigation}
                    userLabel={userLabel}
                />
            </nav>

            {quickAccessOpen ? <QuickAccessMenu
                items={quickAccessItems}
                navigationRef={quickAccessRef}
                onSelect={closeNavigation}
            /> : null}

            {/* Global Settings Modal */}
            {settingsOpen && (
                <Suspense fallback={null}>
                    <GlobalSettingsModal
                        isOpen={settingsOpen}
                        onClose={() => {
                            setSettingsOpen(false);
                            setSettingsPluginId(null);
                        }}
                        initialTab={settingsTab}
                        initialPluginId={settingsPluginId}
                        sidebarNavigation={{
                            items: visibleNavItems,
                            pinnedRoutes: sidebarPreferences.pinnedRoutes,
                            onTogglePinned: togglePinnedRoute,
                            onMovePinned: movePinnedRoute,
                        }}
                    />
                </Suspense>
            )}
        </>
    );
}
