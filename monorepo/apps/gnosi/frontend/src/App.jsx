import React, { useEffect, useState } from 'react';
import { Routes, Route } from 'react-router-dom';
import { AppSidebar } from './components/AppSidebar';
import GraphPage from './pages/GraphPage';
import Dashboard from './pages/Dashboard';
import SocialDashboard from './pages/SocialDashboard';
import ContentCalendar from './pages/ContentCalendar';
import CalendarPage from './pages/CalendarPage';
import PostHistory from './pages/PostHistory';
import VaultDashboard from './pages/VaultDashboard';
import ReaderDashboard from './pages/ReaderDashboard';
import HomePage from './pages/HomePage';
import MailPage from './pages/MailPage';
import MediaCenter from './pages/MediaCenter';

import SchedulerPage from './pages/SchedulerPage';
import ComposerPage from './pages/ComposerPage';
import { Toaster } from 'react-hot-toast';

import AgentChat from './components/AgentChat';
import { useTheme } from './hooks/useTheme';

function App() {
  const { effectiveTheme } = useTheme();

  useEffect(() => {
    const root = window.document.documentElement;
    if (effectiveTheme === 'dark') {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
  }, [effectiveTheme]);

  return (
    <div className="flex h-screen overflow-hidden bg-[var(--bg-primary)] text-[var(--text-primary)] transition-colors duration-300">
      {/* Barra lateral global sempre present */}
      <AppSidebar />

      {/* Contingut principal */}
      <div className="flex-1 overflow-y-auto bg-[var(--bg-secondary)] transition-colors duration-300">
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/graph" element={<GraphPage />} />
          <Route path="/vault/*" element={<VaultDashboard />} />
          <Route path="/calendar" element={<CalendarPage />} />
          <Route path="/reader" element={<ReaderDashboard />} />
          <Route path="/mail" element={<MailPage />} />
          <Route path="/scheduler" element={<SchedulerPage />} />
          <Route path="/composer" element={<ComposerPage />} />
          <Route path="/social-dashboard" element={<SocialDashboard />} />
          <Route path="/social/calendar" element={<ContentCalendar />} />
          <Route path="/social/history" element={<PostHistory />} />
          <Route path="/media" element={<MediaCenter />} />
        </Routes>
      </div>
      <Toaster position="bottom-right" />
      <AgentChat />
    </div>
  );
}

export default App;
