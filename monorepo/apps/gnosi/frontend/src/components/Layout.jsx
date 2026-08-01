import React from 'react';
import { useTranslation } from 'react-i18next';
import { PanelRight, Network } from 'lucide-react';
import { AppHeader } from './AppHeader';
import { useMediaQuery } from '../hooks/useMediaQuery';

export function Layout({ children, sidebar, controls, bottomPanel, containerStyle = {} }) {
  const { t } = useTranslation();
  const isCompact = useMediaQuery('(max-width: 767px)');
  const [isPanelOpen, setIsPanelOpen] = React.useState(
    () => typeof window === 'undefined' || !window.matchMedia('(max-width: 767px)').matches
  );
  const [isBottomPanelOpen, setIsBottomPanelOpen] = React.useState(false);
  const graphContainerRef = React.useRef(null);
  const sidebarRef = React.useRef(null);

  React.useEffect(() => {
    setIsPanelOpen(!isCompact);
  }, [isCompact]);

  React.useEffect(() => {
    const handleFocusShortcut = (event) => {
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
    window.addEventListener('keydown', handleFocusShortcut);
    return () => window.removeEventListener('keydown', handleFocusShortcut);
  }, []);

  return (
    <div id="app" className={!isPanelOpen ? 'panel-hidden' : ''}>
      <AppHeader icon={Network} title={t('graph.page_title', 'Knowledge graph')}>
          <button
            id="btn-toggle-panel"
            title={t('graph.toggle_panel_tooltip', "Show / hide panel")}
            onClick={() => setIsPanelOpen(!isPanelOpen)}
            aria-label={t('graph.toggle_panel_tooltip', "Show / hide panel")}
            aria-expanded={isPanelOpen}
            className="gnosi-icon-button"
          >
            <PanelRight size={20} />
          </button>
      </AppHeader>

      <main id="main-content">
        {isCompact && isPanelOpen && (
          <button
            type="button"
            className="graph-panel-backdrop"
            onClick={() => setIsPanelOpen(false)}
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
          onWheelCapture={(event) => event.stopPropagation()}
        >
          {sidebar}
        </aside>
      </main>

      <div id="bottom-panel-wrapper" style={{
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--bg-side)',
        borderTop: '1px solid var(--color-border)',
        zIndex: 20
      }}>
        <button
          onClick={() => setIsBottomPanelOpen(!isBottomPanelOpen)}
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
          <div style={{ maxHeight: '35vh', overflowY: 'auto' }}>
            {bottomPanel}
          </div>
        )}
      </div>
    </div>
  );
}
