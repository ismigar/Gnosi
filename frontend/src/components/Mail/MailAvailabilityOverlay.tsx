import type { ComponentType, RefObject } from 'react';
import type FullCalendar from '@fullcalendar/react';
import { Calendar, ChevronLeft, ChevronRight, X } from 'lucide-react';

import { DigitalBrainCalendar } from '../Vault/DigitalBrainCalendar';
import type { VaultPageSummary } from '../../shared/api/vaults';
import type { MailAvailabilitySelection } from './mailComposerTypes';
import type { MailComposerController } from './useMailComposerController';


interface CalendarBoundaryProps {
  readonly allNotes: readonly VaultPageSummary[];
  readonly calendarConfigs: readonly unknown[];
  readonly calendarRef: RefObject<FullCalendar | null>;
  readonly colorMap: Readonly<Record<string, string>>;
  readonly onSelection: (selection: MailAvailabilitySelection) => void;
  readonly onTitleChange: (title: string) => void;
  readonly selectedCalendars: ReadonlySet<string>;
}


const TypedDigitalBrainCalendar = DigitalBrainCalendar as unknown as ComponentType<
  CalendarBoundaryProps
>;


interface MailAvailabilityOverlayProps {
  readonly controller: MailComposerController;
}


export function MailAvailabilityOverlay({
  controller,
}: MailAvailabilityOverlayProps) {
  const {
    calendarData,
    calendarRef,
    handleSlotSelection,
    selectedCalendarSources,
    setCalendarTitle,
    setShowAvailability,
    showAvailability,
    t,
  } = controller;
  if (!showAvailability) return null;

  return (
    <div className="fixed inset-0 z-[var(--z-modal)] flex animate-in items-center justify-center bg-[var(--bg-primary)]/40 p-4 backdrop-blur-sm fade-in duration-300 lg:p-12">
      <div className="flex h-full max-h-[800px] w-full max-w-5xl animate-in flex-col overflow-hidden rounded-3xl border border-[var(--border-primary)] bg-[var(--bg-primary)] shadow-2xl zoom-in-95 duration-300">
        <div className="flex h-20 items-center justify-between border-b border-[var(--border-primary)] bg-[var(--bg-secondary)]/50 px-8">
          <h3 className="flex items-center gap-3 text-xl font-bold text-[var(--text-primary)]">
            <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-[var(--gnosi-blue)] text-white shadow-lg">
              <Calendar size={20} />
            </span>
            {t('mail.availability_modal_title', 'Choose your availability')}
          </h3>
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-1 rounded-xl border border-[var(--border-primary)] bg-[var(--bg-primary)] p-1 shadow-sm">
              <button
                type="button"
                onClick={() => { calendarRef.current?.getApi().prev(); }}
                className="rounded-lg p-2 text-[var(--text-secondary)] transition-all hover:bg-[var(--bg-secondary)] hover:text-[var(--gnosi-blue)]"
              >
                <ChevronLeft size={18} />
              </button>
              <button
                type="button"
                onClick={() => { calendarRef.current?.getApi().today(); }}
                className="px-4 text-xs font-bold uppercase tracking-tight text-[var(--text-secondary)] hover:text-[var(--gnosi-blue)]"
              >
                {t('calendar.today', 'Today')}
              </button>
              <button
                type="button"
                onClick={() => { calendarRef.current?.getApi().next(); }}
                className="rounded-lg p-2 text-[var(--text-secondary)] transition-all hover:bg-[var(--bg-secondary)] hover:text-[var(--gnosi-blue)]"
              >
                <ChevronRight size={18} />
              </button>
            </div>
            <button
              type="button"
              onClick={() => { setShowAvailability(false); }}
              className="rounded-2xl bg-[var(--bg-secondary)] p-3 text-[var(--text-secondary)] transition-all hover:bg-[var(--bg-tertiary)] active:scale-95"
            >
              <X size={20} />
            </button>
          </div>
        </div>
        <div className="flex-1 overflow-hidden bg-[var(--bg-primary)] p-8">
          <TypedDigitalBrainCalendar
            allNotes={calendarData.pages}
            calendarRef={calendarRef}
            onTitleChange={setCalendarTitle}
            onSelection={handleSlotSelection}
            selectedCalendars={selectedCalendarSources}
            colorMap={{ Gnosi: 'var(--gnosi-primary)' }}
            calendarConfigs={[]}
          />
        </div>
        <div className="border-t border-[var(--border-primary)] bg-[var(--bg-secondary)] p-6 text-center">
          <p className="text-sm font-medium italic text-[var(--text-secondary)]">
            {t(
              'mail.availability_modal_hint',
              'Click and drag to create an availability slot. It will appear automatically in the email.',
            )}
          </p>
        </div>
      </div>
    </div>
  );
}
