import { CalendarPlus, Clock, Sun } from 'lucide-react';
import type { EventFormController } from './useEventForm';
export function EventDates({controller}: {controller: EventFormController}) {
 const {title, setTitle, allDay, setAllDay, startDate, setStartDate, endDate, setEndDate, startTime, setStartTime, endTime, setEndTime, calendarId, setCalendarId, titleRef, t, calendars, handleFieldBlur, padTime, inputClass, labelClass} = controller;
 return <>                {/* Title */}
                <div>
                    <label className={labelClass}>{t('calendar.event_title', "Title")}</label>
                    <input
                        ref={titleRef}
                        type="text"
                        value={title}
                        onChange={(e) => { setTitle(e.target.value); }}
                        onBlur={handleFieldBlur}
                        placeholder={t('calendar.event_title_placeholder', "Meeting, Doctor's appointment...")}
                        className={inputClass}
                        required
                    />
                </div>

                {/* All day */}
                <div className="flex items-center justify-between py-1">
                    <label className="flex items-center gap-1.5 text-[12px] font-medium text-[var(--text-secondary)]">
                        <Sun size={14} className="text-amber-500" />
                        {t('calendar.all_day', "All day")}
                    </label>
                    <button
                        type="button"
                        onClick={() => {
                            setAllDay(!allDay);
                            setTimeout(() => { handleFieldBlur(); }, 100);
                        }}
                        className={`relative w-9 h-5 rounded-full transition-colors ${allDay ? 'bg-[var(--gnosi-primary)]' : 'bg-[var(--bg-tertiary)] border border-[var(--border-primary)]'}`}
                    >
                        <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow-sm transition-transform ${allDay ? 'left-[18px]' : 'left-0.5'}`} />
                    </button>
                </div>

                {/* Dates */}
                <div className="grid grid-cols-2 gap-2">
                    <div>
                        <label className={labelClass}>
                            <CalendarPlus size={10} />
                            {t('calendar.start', "Start")}
                        </label>
                        <input type="date" value={startDate} onChange={(e) => { setStartDate(e.target.value); }} onBlur={handleFieldBlur} className={inputClass} required />
                    </div>
                    <div>
                        <label className={labelClass}>
                            <CalendarPlus size={10} />
                            {t('calendar.end', "End")} <span className="text-[var(--text-tertiary)] font-normal normal-case">{t('calendar.opt', "(opt.)")}</span>
                        </label>
                        <input type="date" value={endDate} onChange={(e) => { setEndDate(e.target.value); }} onBlur={handleFieldBlur} className={inputClass} min={startDate} />
                    </div>
                </div>

                {/* Hours (hidden if "All day") */}
                {!allDay && (
                    <div className="grid grid-cols-2 gap-2">
                        <div>
                            <label className={labelClass}>
                                <Clock size={10} />
                                {t('calendar.start_time', "Start time")}
                            </label>
                            <input type="time" value={startTime} onChange={(e) => { setStartTime(padTime(e.target.value)); }} onBlur={handleFieldBlur} className={inputClass} />
                        </div>
                        <div>
                            <label className={labelClass}>
                                <Clock size={10} />
                                {t('calendar.end_time', "End time")}
                            </label>
                            <input type="time" value={endTime} onChange={(e) => { setEndTime(padTime(e.target.value)); }} onBlur={handleFieldBlur} className={inputClass} />
                        </div>
                    </div>
                )}

                {/* Calendar (Enabled tables and calendars) */}
                <div>
                    <label className={labelClass}>
                        <CalendarPlus size={10} />
                        {t('calendar.label', "Calendar")}
                    </label>
                    <select value={calendarId} onChange={(e) => { setCalendarId(e.target.value); }} onBlur={handleFieldBlur} className={inputClass}>
                        {calendars.map(cal => (
                            <option key={cal.id} value={cal.id}>{cal.name}</option>
                        ))}
                    </select>
                </div>

</>;
}
