import React, { useEffect, Suspense, lazy } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { AppSidebar } from './components/AppSidebar';
import HomePage from './pages/HomePage';

// ── Rutes carregades mandrosament (code-splitting) ──────────────────────────
// Cada pàgina pesada arrossega llibreries grans (BlockEditor→blocknote/tiptap,
// GraphPage→sigma/graphology, MailPage→react-pdf, CalendarPage→fullcalendar,
// MediaCenter→framer-motion). Importar-les amb React.lazy les treu del bundle
// inicial: el navegador només baixa el chunk de la ruta quan s'hi navega.
// HomePage queda EAGER perquè és l'arrencada més habitual (sense flaix de
// Suspense a l'inici).
const GraphPage = lazy(() => import('./pages/GraphPage'));
const Dashboard = lazy(() => import('./pages/Dashboard'));
const SocialDashboard = lazy(() => import('./pages/SocialDashboard'));
const CalendarPage = lazy(() => import('./pages/CalendarPage'));
const VaultDashboard = lazy(() => import('./pages/VaultDashboard'));
const ZoteroReaderPage = lazy(() =>
  import('./components/Vault/ZoteroReaderTab').then((m) => ({ default: m.ZoteroReaderPage })),
);
const ReaderDashboard = lazy(() => import('./pages/ReaderDashboard'));
const MailPage = lazy(() => import('./pages/MailPage'));
const MediaCenter = lazy(() => import('./pages/MediaCenter'));
const ContactsPage = lazy(() => import('./pages/ContactsPage'));
const SchedulerPage = lazy(() => import('./pages/SchedulerPage'));
const ComposerPage = lazy(() => import('./pages/ComposerPage'));
const SharedPage = lazy(() => import('./pages/SharedPage'));
import { Toaster } from './lib/toast';

import AgentChat from './components/AgentChat';
import MeetingReminderWatcher from './components/MeetingReminderWatcher';
import MeetingRecorder from './components/MeetingRecorder';
import PageOutline from './components/PageOutline';
import CommandPalette from './components/CommandPalette';
import { useTheme } from './hooks/useTheme';
import { useFileLinkInterceptor } from './hooks/useFileLinkInterceptor';
import { useAuth } from './context/AuthContext';
import { LoginPage } from './components/Auth/LoginPage';

// Fallback mentre es baixa el chunk d'una ruta mandrosa. Discret i centrat,
// reutilitzant l'estil del bootstrap d'auth perquè no hi hagi salt visual.
function RouteFallback() {
  return (
    <div className="flex h-full items-center justify-center bg-[var(--bg-secondary)] text-[var(--text-secondary)]">
      <div className="animate-pulse text-sm">Carregant…</div>
    </div>
  );
}

function App() {
  const { effectiveTheme } = useTheme();
  const { user, gnosiMode, loading } = useAuth();
  // Captura clicks a file:// arreu i els redirigeix al shell del sistema
  // via el backend, en lloc de deixar que Chrome obri pestanyes en blanc.
  useFileLinkInterceptor();

  useEffect(() => {
    const root = window.document.documentElement;
    if (effectiveTheme === 'dark') {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
  }, [effectiveTheme]);

  // Bootstrap: esperem a saber el mode i si hi ha sessió abans de decidir.
  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-[var(--bg-secondary)] text-[var(--text-secondary)]">
        <div className="animate-pulse text-sm">Carregant…</div>
      </div>
    );
  }

  // Pàgines compartides públicament (`/s/:token`): es renderitzen FORA del
  // gate d'auth i del shell de l'app — qualsevol amb l'enllaç hi accedeix.
  if (window.location.pathname.startsWith('/s/')) {
    return (
      <>
        <Suspense fallback={<RouteFallback />}>
          <Routes>
            <Route path="/s/:token" element={<SharedPage />} />
          </Routes>
        </Suspense>
        <Toaster position="bottom-right" containerStyle={{ zIndex: 100001 }} />
      </>
    );
  }

  // Gate només en mode org: en personal l'usuari únic entra directe (el
  // backend ja resol l'usuari legacy sense token).
  if (gnosiMode === 'org' && !user) {
    return <LoginPage />;
  }

  return (
    <div className="flex h-screen overflow-hidden bg-[var(--bg-primary)] text-[var(--text-primary)] transition-colors duration-300">
      {/* Barra lateral global sempre present */}
      <AppSidebar />

      {/* Contingut principal */}
      <div id="page-content-scroll" className="flex-1 overflow-y-auto overflow-x-hidden bg-[var(--bg-secondary)] transition-colors duration-300">
        <Suspense fallback={<RouteFallback />}>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/graph" element={<GraphPage />} />
          <Route path="/vault/pdf" element={<ZoteroReaderPage />} />
          <Route path="/vault/*" element={<VaultDashboard />} />
          <Route path="/calendar" element={<CalendarPage />} />
          <Route path="/reader" element={<ReaderDashboard />} />
          <Route path="/mail" element={<MailPage />} />
          <Route path="/scheduler" element={<SchedulerPage />} />
          <Route path="/composer" element={<ComposerPage />} />
          <Route path="/social-dashboard" element={<SocialDashboard />} />
          <Route path="/media" element={<MediaCenter />} />
          <Route path="/contacts" element={<ContactsPage />} />
          {/* Catch-all: una URL no existent (typo, enllaç ranci, ruta mal
              escrita per codi) renderitzava NOMÉS el layout amb el cos en blanc.
              Redirigim a l'inici (replace per no deixar la URL dolenta a
              l'historial). */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
        </Suspense>
      </div>
      {/* z-index per sobre de tots els overlays modals (GlobalSettingsModal:10000,
          ZoteroMappingModal i AIAgentModal:100000). Sense això, els toasts
          quedaven amagats darrere de qualsevol modal oberta. */}
      <Toaster position="bottom-right" containerStyle={{ zIndex: 100001 }} />
      <CommandPalette />
      <PageOutline />
      <AgentChat />
      <MeetingReminderWatcher />
      <MeetingRecorder />
    </div>
  );
}

export default App;
