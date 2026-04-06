import { useState, useEffect } from 'react';

/**
 * Hook per obtenir el tema actiu real (light o dark).
 * Gestiona la preferència de localStorage i el canvi de sistema si està en mode 'system'.
 */
export function useTheme() {
    const [themePreference, setThemePreference] = useState(() => localStorage.getItem('db-theme') || 'system');
    const [effectiveTheme, setEffectiveTheme] = useState('light');

    useEffect(() => {
        const updateEffectiveTheme = () => {
            const pref = localStorage.getItem('db-theme') || 'system';
            setThemePreference(pref);
            
            if (pref === 'dark') {
                setEffectiveTheme('dark');
            } else if (pref === 'light') {
                setEffectiveTheme('light');
            } else {
                // System mode
                const isDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
                setEffectiveTheme(isDark ? 'dark' : 'light');
            }
        };

        // Initial update
        updateEffectiveTheme();

        const handleThemeChanged = () => updateEffectiveTheme();
        const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
        const handleSystemChange = () => {
            if (localStorage.getItem('db-theme') === 'system') {
                updateEffectiveTheme();
            }
        };

        window.addEventListener('db-theme-changed', handleThemeChanged);
        mediaQuery.addEventListener('change', handleSystemChange);

        return () => {
            window.removeEventListener('db-theme-changed', handleThemeChanged);
            mediaQuery.removeEventListener('change', handleSystemChange);
        };
    }, []);

    return {
        themePreference,
        effectiveTheme,
        isDark: effectiveTheme === 'dark'
    };
}
