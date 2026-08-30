import { Bell, Navigation } from 'lucide-react';
import type { EventFormController } from './useEventForm';
export function EventDetails({controller}: {controller: EventFormController}) {
 const {reminder, setReminder, travelTime, setTravelTime, t, handleFieldBlur, inputClass, labelClass, REMINDER_OPTIONS, TRAVEL_TIME_OPTIONS} = controller;
 return <>                {/* Recordatori */}
                <div>
                    <label className={labelClass}>
                        <Bell size={10} />
                        {t('calendar.reminder', "Reminder")}
                    </label>
                    <select value={reminder} onChange={(e) => { setReminder(e.target.value); }} onBlur={handleFieldBlur} className={inputClass}>
                        {REMINDER_OPTIONS.map(opt => (
                            <option key={opt.value} value={opt.value}>{opt.label}</option>
                        ))}
                    </select>
                </div>

                {/* Travel time */}
                <div>
                    <label className={labelClass}>
                        <Navigation size={10} />
                        {t('calendar.travel_time', "Travel time")}
                    </label>
                    <select value={travelTime} onChange={(e) => { setTravelTime(e.target.value); }} className={inputClass}>
                        {TRAVEL_TIME_OPTIONS.map(opt => (
                            <option key={opt.value} value={opt.value}>{opt.label}</option>
                        ))}
                    </select>
                </div>

</>;
}
