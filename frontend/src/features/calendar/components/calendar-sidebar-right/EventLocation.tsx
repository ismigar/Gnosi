import { MapPin, Loader2, Check } from 'lucide-react';
import type { EventFormController } from './useEventForm';
export function EventLocation({controller}: {controller: EventFormController}) {
 const { location, locationLat, locationLon, locationSuggestions, setLocationSuggestions, locationLoading, locationHighlight, setLocationHighlight, locationBlurTimeoutRef, handleLocationChange, selectLocationSuggestion, handleLocationKeyDown, t, inputClass, labelClass} = controller;
 return <>                {/* Location */}
                <div>
                    <label className={labelClass}>
                        <MapPin size={10} />
                        {t('calendar.location', "Location / URL")}
                    </label>
                    <div className="relative">
                        <input
                            type="text"
                            value={location}
                            onChange={(e) => { handleLocationChange(e.target.value); }}
                            onKeyDown={handleLocationKeyDown}
                            onFocus={() => { if (locationBlurTimeoutRef.current) clearTimeout(locationBlurTimeoutRef.current); }}
                            onBlur={() => {
                                // Delay to allow clicking a suggestion before closing
                                locationBlurTimeoutRef.current = setTimeout(() => {
                                    setLocationSuggestions([]);
                                    setLocationHighlight(-1);
                                }, 150);
                            }}
                            placeholder={t('calendar.location_placeholder', "Room 3, https://meet.google...")}
                            className={`${inputClass} ${(locationLoading || locationLat != null) ? 'pr-8' : ''}`}
                            autoComplete="off"
                            title={location || undefined}
                        />
                        {locationLoading ? (
                            <Loader2 size={14} className="absolute right-2.5 top-1/2 -translate-y-1/2 animate-spin text-[var(--text-tertiary)]" />
                        ) : locationLat != null ? (
                            <span
                                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[var(--status-success,#22c55e)]"
                                title={t('calendar.location_verified', "Verified location")}
                            >
                                <Check size={14} strokeWidth={3} />
                            </span>
                        ) : null}

                        {locationSuggestions.length > 0 && (
                            <div className="absolute top-full left-0 right-0 z-50 bg-[var(--bg-primary)] border border-[var(--border-primary)] rounded-lg shadow-xl mt-0.5 overflow-hidden max-h-56 overflow-y-auto">
                                {locationSuggestions.map((s, i) => (
                                    <button
                                        key={`${s.label}-${String(i)}`}
                                        type="button"
                                        onMouseDown={(e) => { e.preventDefault(); selectLocationSuggestion(s); }}
                                        onMouseEnter={() => { setLocationHighlight(i); }}
                                        className={`w-full text-left px-3 py-1.5 transition-colors border-b border-[var(--border-primary)] last:border-none flex items-start gap-2 ${i === locationHighlight ? 'bg-[var(--bg-secondary)]' : 'hover:bg-[var(--bg-secondary)]'}`}
                                    >
                                        <MapPin size={12} className="mt-0.5 flex-shrink-0 text-[var(--text-tertiary)]" />
                                        <span className="text-[12px] text-[var(--text-primary)] leading-tight">{s.label}</span>
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>
                    {location && (location.length > 36 || locationLat != null) && (
                        <div className="mt-1 flex items-start gap-1.5 px-0.5">
                            <span className="text-[11px] text-[var(--text-tertiary)] leading-snug break-words flex-1" title={location}>
                                {location}
                            </span>
                            {locationLat != null && locationLon != null && (
                                <a
                                    href={`https://www.openstreetmap.org/?mlat=${String(locationLat)}&mlon=${String(locationLon)}#map=17/${String(locationLat)}/${String(locationLon)}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-[10px] text-[var(--gnosi-primary)] hover:underline shrink-0 whitespace-nowrap"
                                    title={t('calendar.view_on_map', "View on map")}
                                >
                                    {t('calendar.map', "map")}
                                </a>
                            )}
                        </div>
                    )}
                </div>

</>;
}
