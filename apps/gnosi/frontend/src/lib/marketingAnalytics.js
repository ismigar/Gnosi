const PLAUSIBLE_EVENT_NAME = 'plausible';

/**
 * Record an optional Plausible custom event without making analytics a runtime dependency.
 *
 * @param {string} name Event name configured in Plausible.
 * @param {Record<string, string>} [props] Optional event properties.
 */
export function trackMarketingEvent(name, props = {}) {
    if (typeof window === 'undefined' || typeof window[PLAUSIBLE_EVENT_NAME] !== 'function') {
        return;
    }

    window[PLAUSIBLE_EVENT_NAME](name, { props });
}

export function trackOutboundClick(destination) {
    trackMarketingEvent('outbound_click', { destination });
}
