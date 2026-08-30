import { VaultBulkActionsBar } from '../../../shared/record-views/VaultBulkActionsBar';
import { CalendarCanvas } from './digital-brain-calendar/CalendarCanvas';
import { CalendarToolbar } from './digital-brain-calendar/CalendarToolbar';
import { CalendarTooltip } from './digital-brain-calendar/CalendarTooltip';
import { DIGITAL_BRAIN_CALENDAR_STYLES } from './digital-brain-calendar/calendarStyles';
import type { DigitalBrainCalendarProps } from './digital-brain-calendar/calendarTypes';
import { useDigitalBrainCalendar } from './digital-brain-calendar/useDigitalBrainCalendar';
import './CalendarStyles.css';

export type { DigitalBrainCalendarProps } from './digital-brain-calendar/calendarTypes';

export function DigitalBrainCalendar(props: DigitalBrainCalendarProps) {
  const { calendarRef, controller: c } = useDigitalBrainCalendar(props);
  return <div className="h-full bg-[var(--bg-primary)] flex flex-col overflow-hidden" onContextMenu={c.handleContextMenu}>
    {c.selectedIds.size > 0 && <VaultBulkActionsBar selectedIds={c.selectedIds} totalCount={c.allEventIds.length}
      onSelectAll={() => { c.selectAll(c.allEventIds); }} onClearSelection={c.clearSelection}
      onDeleteSelected={(props.onDeleteSelected || props.onDeletePage) ? c.handleBulkDelete : null}
      templates={props.templates} onApplyTemplate={c.applyTemplate} />}
    {c.showHeaderToolbar && <CalendarToolbar calendarRef={calendarRef} toolbar={c.toolbar} t={c.t} />}
    <CalendarCanvas calendarRef={calendarRef} controller={c} />
    {c.hoveredEvent && <CalendarTooltip event={c.hoveredEvent} language={c.language} t={c.t} />}
    <style>{DIGITAL_BRAIN_CALENDAR_STYLES}</style>
    {c.preview}
  </div>;
}
