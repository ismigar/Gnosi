import { AlignLeft } from 'lucide-react';
import type { EventFormController } from './useEventForm';
export function EventDescription({controller}: {controller: EventFormController}) {
 const {description, setDescription, t, handleFieldBlur, inputClass, labelClass} = controller;
 return <>                {/* Description */}
                <div className="pb-4">
                    <label className={labelClass}>
                        <AlignLeft size={10} />
                        {t('calendar.description', "Description")}
                    </label>
                    <textarea
                        value={description}
                        onChange={(e) => { setDescription(e.target.value); }}
                        onBlur={handleFieldBlur}
                        placeholder={t('calendar.event_description_placeholder', "Add details...")}
                        rows={2}
                        className={`${inputClass} resize-none`}
                    />
                </div>
</>;
}
