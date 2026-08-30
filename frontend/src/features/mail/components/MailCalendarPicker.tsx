import { ChevronRight, X } from 'lucide-react';

import type { MailViewerController } from './useMailViewerController';


export function MailCalendarPicker({ controller }: { readonly controller: MailViewerController }) {
  const event = controller.calendarPickerEvent;
  if (!event) return null;
  const { calendarPickerRef, t } = controller;
  return (
    <div className="fixed inset-0 z-[var(--z-modal)] bg-black/40 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-200" onMouseDown={(mouseEvent) => { if (mouseEvent.target === mouseEvent.currentTarget) controller.setCalendarPickerEvent(null); }}>
      <div className="bg-[var(--bg-primary)] w-full max-w-md rounded-3xl shadow-2xl border border-[var(--border-primary)] overflow-hidden animate-in zoom-in-95 duration-200" onMouseDown={(mouseEvent) => { mouseEvent.stopPropagation(); }} ref={calendarPickerRef}>
        <div className="p-6 border-b border-[var(--border-primary)] flex items-center justify-between bg-[var(--bg-secondary)]/50">
          <h3 className="font-bold text-[var(--text-primary)]">{t('mail.choose_calendar_title', 'Choose a calendar')}</h3>
          <button className="p-2 hover:bg-[var(--bg-tertiary)] rounded-xl transition-colors" onClick={() => { controller.setCalendarPickerEvent(null); }} type="button"><X size={18} /></button>
        </div>
        <div className="p-4 max-h-[300px] overflow-y-auto">
          {controller.availableCalendars.length === 0 ? (
            <div className="p-8 text-center text-[var(--text-secondary)]">{t('mail.loading_calendars', 'Loading calendars...')}</div>
          ) : (
            <div className="space-y-1">
              {controller.availableCalendars.map((calendar) => (
                <button className="w-full flex items-center gap-3 p-3 hover:bg-[var(--bg-secondary)] rounded-2xl transition-all text-left group" key={calendar.id} onClick={() => { void controller.addExtractedEvent(event, calendar.id); }} type="button">
                  <div className="w-4 h-4 rounded-full" style={{ backgroundColor: typeof calendar.backgroundColor === 'string' ? calendar.backgroundColor : 'var(--gnosi-blue)' }} />
                  <div className="flex-1"><div className="text-sm font-bold text-[var(--text-primary)]">{typeof calendar.summary === 'string' ? calendar.summary : calendar.id}</div><div className="text-[10px] text-[var(--text-secondary)] opacity-60 font-mono uppercase">{typeof calendar.account === 'string' ? calendar.account : ''}</div></div>
                  <ChevronRight className="text-[var(--text-secondary)] opacity-0 group-hover:opacity-100 transition-opacity" size={14} />
                </button>
              ))}
              <button className="w-full flex items-center gap-3 p-3 hover:bg-[var(--bg-secondary)] rounded-2xl transition-all text-left group border border-dashed border-[var(--border-primary)] mt-2" onClick={() => { void controller.addExtractedEvent(event, 'gnosi'); }} type="button">
                <div className="w-4 h-4 rounded-full bg-[var(--gnosi-blue)]" />
                <div className="flex-1"><div className="text-sm font-bold text-[var(--text-primary)]">{t('mail.gnosi_vault_local', 'Gnosi Vault (Local)')}</div><div className="text-[10px] text-[var(--text-secondary)] opacity-60 font-mono uppercase">{t('common.local', 'Local')}</div></div>
                <ChevronRight className="text-[var(--text-secondary)] opacity-0 group-hover:opacity-100 transition-opacity" size={14} />
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
