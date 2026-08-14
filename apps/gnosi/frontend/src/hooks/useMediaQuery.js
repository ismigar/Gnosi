import { useEffect, useState } from 'react';

function getMatches(query) {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
        return false;
    }
    return window.matchMedia(query).matches;
}

/**
 * Tracks a CSS media query without duplicating breakpoint-specific resize logic.
 *
 * @param {string} query Valid CSS media query.
 * @returns {boolean} Whether the query currently matches.
 */
export function useMediaQuery(query) {
    const [matches, setMatches] = useState(() => getMatches(query));

    useEffect(() => {
        const mediaQuery = window.matchMedia(query);
        const update = () => setMatches(mediaQuery.matches);

        update();
        mediaQuery.addEventListener('change', update);
        return () => mediaQuery.removeEventListener('change', update);
    }, [query]);

    return matches;
}
