import { X, Users, UserPlus } from 'lucide-react';
import type { EventFormController } from './useEventForm';
export function EventAttendees({controller}: {controller: EventFormController}) {
 const { attendees, attendeeInput, attendeeSuggestions, setAttendeeSuggestions, handleAttendeeInputChange, addAttendee, addAttendeeFromInput, removeAttendee, t, onRsvp, isViewMode, inputClass, labelClass, RSVP_META} = controller;
 return <>                {/* Convidats */}
                <div className="space-y-1.5">
                    <label className={labelClass}>
                        <Users size={10} />
                        {t('calendar.attendees', "Attendees")}
                    </label>

                    {isViewMode ? (
                        /* ── View (external events) ── */
                        <div className="space-y-1">
                            {attendees.length === 0 ? (
                                <p className="text-[11px] text-[var(--text-tertiary)] italic px-0.5">{t('calendar.no_attendees', "No guests")}</p>
                            ) : (
                                <>
                                    {attendees.map((att, i) => {
                                        const meta = att.rsvp === 'accepted' || att.rsvp === 'declined' || att.rsvp === 'tentative' ? RSVP_META[att.rsvp] : RSVP_META.needsAction;
                                        return (
                                            <div key={i} className="flex items-center justify-between gap-2 px-2 py-1.5 rounded-lg bg-[var(--bg-tertiary)] border border-[var(--border-primary)]">
                                                <div className="flex items-center gap-1.5 min-w-0">
                                                    <span className={`w-2 h-2 rounded-full flex-shrink-0 ${meta.dot}`} />
                                                    <div className="min-w-0">
                                                        <div className="text-[11px] font-semibold text-[var(--text-primary)] truncate">{att.name || att.email}</div>
                                                        {att.name && <div className="text-[10px] text-[var(--text-tertiary)] truncate">{att.email}</div>}
                                                    </div>
                                                </div>
                                                <div className="flex items-center gap-1 flex-shrink-0">
                                                    {att.organizer && <span className="text-[9px] bg-blue-100 text-blue-600 dark:bg-blue-900/40 dark:text-blue-300 px-1.5 py-0.5 rounded-full font-bold">{t('calendar.organizer_badge', 'org')}</span>}
                                                    <span className="text-[9px] text-[var(--text-tertiary)]">{meta.label}</span>
                                                </div>
                                            </div>
                                        );
                                    })}

                                    {/* RSVP buttons if the user is invited */}
                                    {attendees.some(a => a.self) && (() => {
                                        const self = attendees.find(a => a.self);
                                        return (
                                            <div className="flex gap-1 mt-1.5">
                                                {(['accepted', 'tentative', 'declined'] as const).map(rv => {
                                                    const m = RSVP_META[rv];
                                                    const isActive = self?.rsvp === rv;
                                                    return (
                                                        <button
                                                            key={rv}
                                                            type="button"
                                                            onClick={() => onRsvp?.(rv)}
                                                            className={`flex-1 py-1 text-[10px] font-bold rounded border transition-colors ${isActive ? m.activeCls : m.btn}`}
                                                        >
                                                            {rv === 'accepted' ? t('calendar.rsvp_accept_action', "✓ Accept") : rv === 'tentative' ? t('calendar.rsvp_maybe', "? Maybe") : t('calendar.rsvp_decline_action', "✗ Decline")}
                                                        </button>
                                                    );
                                                })}
                                            </div>
                                        );
                                    })()}
                                </>
                            )}
                        </div>
                    ) : (
                        /* ── Edit / Create ── */
                        <div className="space-y-1.5">
                            {/* Existing attendee chips */}
                            {attendees.length > 0 && (
                                <div className="flex flex-wrap gap-1">
                                    {attendees.map((att, i) => (
                                        <div key={i} className="flex items-center gap-1 pl-2 pr-1 py-0.5 bg-[var(--gnosi-primary)]/10 border border-[var(--gnosi-primary)]/25 rounded-full">
                                            <span className="text-[11px] text-[var(--gnosi-primary)] font-medium truncate max-w-[110px]" title={att.email}>
                                                {att.name || att.email}
                                            </span>
                                            <button type="button" onClick={() => { removeAttendee(att.email); }}
                                                className="text-[var(--gnosi-primary)]/60 hover:text-red-500 transition-colors flex-shrink-0">
                                                <X size={10} />
                                            </button>
                                        </div>
                                    ))}
                                </div>
                            )}

                            {/* Input + autocomplete */}
                            <div className="relative">
                                <div className="flex gap-1">
                                    <input
                                        type="text"
                                        value={attendeeInput}
                                        onChange={e => { handleAttendeeInputChange(e.target.value); }}
                                        onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addAttendeeFromInput(); } if (e.key === 'Escape') setAttendeeSuggestions([]); }}
                                        placeholder={t('calendar.attendee_input_placeholder', "Add by email or name...")}
                                        className={`${inputClass} flex-1`}
                                    />
                                    <button type="button" onClick={addAttendeeFromInput}
                                        disabled={!attendeeInput.includes('@')}
                                        className="px-2 py-1 bg-[var(--gnosi-primary)]/10 hover:bg-[var(--gnosi-primary)]/20 text-[var(--gnosi-primary)] rounded-lg border border-[var(--gnosi-primary)]/25 disabled:opacity-30 disabled:cursor-not-allowed transition-colors">
                                        <UserPlus size={13} />
                                    </button>
                                </div>

                                {attendeeSuggestions.length > 0 && (
                                    <div className="absolute top-full left-0 right-0 z-50 bg-[var(--bg-primary)] border border-[var(--border-primary)] rounded-lg shadow-xl mt-0.5 overflow-hidden">
                                        {attendeeSuggestions.map((s, i) => (
                                            <button key={i} type="button" onMouseDown={e => { e.preventDefault(); addAttendee(s); }}
                                                className="w-full text-left px-3 py-1.5 hover:bg-[var(--bg-secondary)] transition-colors border-b border-[var(--border-primary)] last:border-none">
                                                <div className="text-[12px] font-semibold text-[var(--text-primary)] truncate">{s.name || s.email}</div>
                                                {s.name && <div className="text-[10px] text-[var(--text-tertiary)] truncate">{s.email}</div>}
                                            </button>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </div>
                    )}
                </div>

</>;
}
