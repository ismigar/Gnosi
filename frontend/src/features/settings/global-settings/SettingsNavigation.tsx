import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTransition } from 'react';
import { ChevronRight } from 'lucide-react';
import { preloadSettingsPanel } from './settingsPanelLoaders';

export const SidebarItem = ({ id, icon: Icon, label, active, onClick }: { id?: string; icon: LucideIcon; label: string; active: boolean; onClick: () => void }) => {
  const [isPending, startTransition] = useTransition();
  return (
  <button
    className={`settings-sidebar__item ${active ? 'active' : ''}`}
    aria-busy={isPending}
    onPointerEnter={() => { if (id) preloadSettingsPanel(id); }}
    onFocus={() => { if (id) preloadSettingsPanel(id); }}
    onTouchStart={() => { if (id) preloadSettingsPanel(id); }}
    onClick={() => { startTransition(onClick); }}
  >
    <Icon size={18} strokeWidth={active ? 2.5 : 2} />
    <span style={{ flex: 1 }}>{label}</span>
    {active && <ChevronRight size={14} style={{ opacity: 0.5 }} />}
  </button>
  );
};

export const SettingsNavGroup = ({ label, children }: { label: string; children: ReactNode }) => (
  <section className="settings-sidebar-group" aria-label={label}>
    <h3 className="settings-sidebar-group__title gnosi-sidebar-section-title">{label}</h3>
    {children}
  </section>
);
