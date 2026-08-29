import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from 'react';
import { useTranslation } from 'react-i18next';
import { PanelRight, Network } from 'lucide-react';

import { AppHeader } from './AppHeader';
import { useMediaQuery } from '../hooks/useMediaQuery';
import { subscribeWindowEvent } from '../shared/platform/browser-events';
import { getPanelScrollTarget } from '../utils/panelKeyboardNavigation';

interface LayoutProps {
  readonly bottomPanel?: ReactNode;
  readonly children?: ReactNode;
  readonly containerStyle?: CSSProperties;
  readonly controls?: ReactNode;
  readonly sidebar?: ReactNode;
}

interface PanelState {
  readonly compact: boolean;
  readonly open: boolean;
}

export function Layout({
  children,
  sidebar,
  controls,
  bottomPanel,
  containerStyle = {},
}: LayoutProps) {
  const { t } = useTranslation();
  const isCompact = useMediaQuery('(max-width: 767px)');
  const [panelState, setPanelState] = useState<PanelState>(() => ({
    compact: isCompact,
    open: !isCompact,
  }));
  const [isBottomPanelOpen, setIsBottomPanelOpen] = useState(false);
  const graphContainerRef = useRef<HTMLDivElement>(null);
  const sidebarRef = useRef<HTMLElement>(null);
  const bottomPanelRef = useRef<HTMLDivElement>(null);
  const isPanelOpen = panelState.compact === isCompact
    ? panelState.open
    : !isCompact;

  const handleBottomPanelKeyDown = (
    event: ReactKeyboardEvent<HTMLDivElement>,
  ) => {
    const panel = bottomPanelRef.current;
    if (!panel) return;
    const target = getPanelScrollTarget(
      event.key,
      panel.scrollTop,
      panel.clientHeight,
      panel.scrollHeight,
    );
    if (target === null) return;
    event.preventDefault();
    panel.scrollTo({ top: target, behavior: event.repeat ? 'auto' : 'smooth' });
  };

  useEffect(() => {
    const handleFocusShortcut = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || !event.shiftKey) return;
      if (event.key.toLowerCase() === 'p') {
        event.preventDefault();
        sidebarRef.current?.focus();
      }
      if (event.key.toLowerCase() === 'g') {
        event.preventDefault();
        graphContainerRef.current?.focus();
      }
    };
    return subscribeWindowEvent('keydown', handleFocusShortcut);
  }, []);

  const togglePanel = () => {
    setPanelState({ compact: isCompact, open: !isPanelOpen });
  };

  const closePanel = () => {
    setPanelState({ compact: isCompact, open: false });
  };

  return (
    <div id="app" className={!isPanelOpen ? 'panel-hidden' : ''}>
      <AppHeader icon={Network} title={t('graph.page_title', 'Knowledge graph')}>
          <button
            id="btn-toggle-panel"
            title={t('graph.toggle_panel_tooltip', "Show / hide panel")}
            onClick={togglePanel}
            aria-label={t('graph.toggle_panel_tooltip', "Show / hide panel")}
            aria-expanded={isPanelOpen}
            className="gnosi-icon-button"
          >
            <PanelRight size={20} />
          </button>
      </AppHeader>

      <div id="main-content">
        {isCompact && isPanelOpen && (
          <button
            type="button"
            className="graph-panel-backdrop"
            onClick={closePanel}
            aria-label={t('common.close', 'Close')}
          />
        )}
        <div
          id="sigma-container"
          ref={graphContainerRef}
          tabIndex={-1}
          aria-label={t('graph.keyboard.graph_focus', 'Graph area')}
          style={{ position: 'relative', width: '100%', height: '100%', ...containerStyle }}
        >
          {children}
          {controls}
        </div>

        <aside
          id="side-panel"
          ref={sidebarRef}
          tabIndex={-1}
          aria-label={t('graph.keyboard.sidebar_focus', 'Graph filters')}
          onWheelCapture={(event) => {
            event.stopPropagation();
          }}
        >
          {sidebar}
        </aside>
      </div>

      <div id="bottom-panel-wrapper" style={{
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--bg-side)',
        borderTop: '1px solid var(--color-border)',
        zIndex: 20
      }}>
        <button
          type="button"
          onClick={() => {
            setIsBottomPanelOpen(!isBottomPanelOpen);
          }}
          aria-expanded={isBottomPanelOpen}
          aria-controls="graph-connections-panel"
          style={{
            width: '100%',
            padding: '8px',
            background: 'none',
            border: 'none',
            borderBottom: isBottomPanelOpen ? '1px solid var(--color-border)' : 'none',
            cursor: 'pointer',
            color: 'var(--color-text)',
            fontSize: '0.9rem',
            fontWeight: 500,
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            gap: '8px'
          }}
        >
          {isBottomPanelOpen ? `▼ ${t('graph.hide_connections', "Hide Connections")}` : `▲ ${t('graph.show_connections', "Show Connections")}`}
        </button>
        {isBottomPanelOpen && (
          <div
            id="graph-connections-panel"
            ref={bottomPanelRef}
            tabIndex={0}
            role="region"
            aria-label={t(
              'graph.connections_panel.scroll_label',
              'Visible connections. Use the up and down arrow keys to scroll.',
            )}
            onKeyDown={handleBottomPanelKeyDown}
            style={{ maxHeight: '35vh', overflowY: 'auto', overscrollBehavior: 'contain' }}
          >
            {bottomPanel}
          </div>
        )}
      </div>
    </div>
  );
}
