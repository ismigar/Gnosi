import React, { useEffect } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { AppSidebar } from './components/AppSidebar';
import GraphPage from './pages/GraphPage';
import Dashboard from './pages/Dashboard';
import SocialDashboard from './pages/SocialDashboard';
import CalendarPage from './pages/CalendarPage';
import VaultDashboard from './pages/VaultDashboard';
import { ZoteroReaderPage } from './components/Vault/ZoteroReaderTab';
import ReaderDashboard from './pages/ReaderDashboard';
import HomePage from './pages/HomePage';
import MailPage from './pages/MailPage';
import MediaCenter from './pages/MediaCenter';
import ContactsPage from './pages/ContactsPage';

import SchedulerPage from './pages/SchedulerPage';
import ComposerPage from './pages/ComposerPage';
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
import SharedPage from './pages/SharedPage';

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
        <Routes>
          <Route path="/s/:token" element={<SharedPage />} />
        </Routes>
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
