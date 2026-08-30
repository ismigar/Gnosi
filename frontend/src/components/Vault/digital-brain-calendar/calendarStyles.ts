export const DIGITAL_BRAIN_CALENDAR_STYLES = `
.custom-scrollbar::-webkit-scrollbar {
    width: 4px;
}
.custom-scrollbar::-webkit-scrollbar-track {
    background: transparent;
}
.custom-scrollbar::-webkit-scrollbar-thumb {
    background: var(--border-primary);
    border-radius: 10px;
}
.custom-scrollbar::-webkit-scrollbar-thumb:hover {
    background: var(--text-tertiary);
}
.fc {
    color: var(--text-primary);
    background-color: var(--bg-primary);
}
.dark .fc {
    background-color: #000000 !important;
}
.dark .fc-scrollgrid, 
.dark .fc-col-header-cell, 
.dark .fc-daygrid-day,
.dark .fc-timegrid-slot,
.dark .fc-timegrid-axis {
    background-color: #000000 !important;
}
.fc-theme-standard .fc-scrollgrid {
    border-color: var(--border-primary) !important;
}
.fc .fc-toolbar-title {
    font-size: 1.25rem;
    font-weight: 600;
    color: var(--text-primary);
}
.fc .fc-col-header-cell-cushion,
.fc .fc-daygrid-day-number {
    color: var(--text-primary);
    text-decoration: none;
}
/* Force styles for timed appointments */
.timed-event-colored {
    background-color: transparent !important;
    border-color: transparent !important;
    box-shadow: none !important;
}
.timed-event-colored:hover {
    background-color: var(--bg-secondary) !important;
}
/* Days that fit to available space */
.fc-daygrid-day-frame {
    height: 100% !important;
    display: flex !important;
    flex-direction: column !important;
}
.fc-daygrid-day-events {
    flex-grow: 1;
}
/* Style for the "+ more" button */
.fc-daygrid-more-link {
    font-size: 0.75rem !important;
    font-weight: 600 !important;
    color: var(--gnosi-primary) !important;
    padding: 2px 4px !important;
    border-radius: 4px !important;
    transition: background 0.2s !important;
    display: block !important;
    text-align: center !important;
    margin-top: 2px !important;
}
.fc-daygrid-more-link:hover {
    background-color: var(--bg-secondary) !important;
    text-decoration: none !important;
}
/* All-day events (blocks) */
.fc-daygrid-block-event {
    background: transparent !important;
    border: none !important;
    padding: 0 !important;
    margin: 1px 4px !important;
}
.fc-v-event {
    background-color: transparent !important;
    border: none !important;
}
.fc-daygrid-dot-event .fc-event-title {
    font-weight: 500;
}
.fc .fc-button {
    font-size: 0.85rem !important;
    padding: 0.4rem 0.6rem !important;
    border-radius: 6px !important;
    text-transform: capitalize;
    margin: 0 2px !important;
}
.fc .fc-button-primary {
    background-color: var(--gnosi-action-bg);
    border-color: var(--gnosi-action-bg);
}
.fc .fc-button-primary:not(:disabled):active, 
.fc .fc-button-primary:not(:disabled).fc-button-active {
    background-color: var(--gnosi-action-bg);
    filter: brightness(0.9);
    border-color: var(--gnosi-action-bg);
}
.fc-theme-standard td, .fc-theme-standard th, .fc-scrollgrid {
    border-color: var(--border-primary) !important;
}
 .fc .fc-day-today {
    background-color: transparent !important;
}
.fc .fc-daygrid-day.fc-day-today .fc-daygrid-day-number {
    background-color: var(--gnosi-action-bg);
    color: #ffffff !important;
    border-radius: 50%;
    width: 26px;
    height: 26px;
    display: flex;
    align-items: center;
    justify-content: center;
    margin: 4px;
    font-weight: 800;
    box-shadow: 0 2px 4px rgba(0,0,0,0.2);
}

/* Weekend Backgrounds */
.fc .fc-daygrid-day.fc-day-sat {
    background-color: rgba(0, 0, 0, 0.05) !important;
}
.dark .fc .fc-daygrid-day.fc-day-sat {
    background-color: rgba(255, 255, 255, 0.06) !important;
}
.fc .fc-daygrid-day.fc-day-sun {
    background-color: rgba(0, 0, 0, 0.1) !important;
}
.dark .fc .fc-daygrid-day.fc-day-sun {
    background-color: rgba(255, 255, 255, 0.12) !important;
}

.fc-list-day-cushion {
    background-color: var(--bg-secondary) !important;
}
/* Visible resize cursor */
.fc-event-resizer {
    cursor: ew-resize;
}
.fc-event-resizer-end {
    cursor: e-resize;
}

/* Multi-Month Year View - Compact */
.fc-multimonth {
    font-size: 0.65rem !important;
    overflow-y: auto !important;
}
.fc-multimonth .fc-multimonth-month {
    padding: 0 !important;
    margin: 0 !important;
}
.fc-multimonth .fc-daygrid-body,
.fc-multimonth .fc-scrollgrid-sync-table {
    height: auto !important;
}
.fc-multimonth .fc-daygrid-day-frame {
    min-height: 1.2em !important;
    max-height: 1.4em !important;
    padding: 0 !important;
}
.fc-multimonth .fc-daygrid-day-top {
    justify-content: center;
}
.fc-multimonth .fc-daygrid-day-number {
    padding: 1px !important;
    font-size: 0.6rem !important;
    line-height: 1 !important;
}
.fc-multimonth .fc-daygrid-day-events,
.fc-multimonth .fc-daygrid-day-bg,
.fc-multimonth .fc-daygrid-event-harness,
.fc-multimonth .fc-daygrid-day-bottom {
    display: none !important;
}
.fc-multimonth .fc-col-header-cell-cushion {
    font-size: 0.55rem !important;
    padding: 1px !important;
    text-transform: lowercase;
}
.fc-multimonth-title {
    font-size: 0.8rem !important;
    font-weight: 600 !important;
    color: var(--gnosi-primary) !important;
    padding: 4px 6px !important;
}
.fc-multimonth-header {
    border-bottom: 1px solid var(--border-primary) !important;
}
.fc-multimonth .fc-scrollgrid {
    border: none !important;
}
.fc-multimonth .fc-scrollgrid-sync-table td,
.fc-multimonth .fc-scrollgrid-sync-table th {
    padding: 0 !important;
}
.fc-multimonth .fc-col-header-cell {
    padding: 0 !important;
}
`;
