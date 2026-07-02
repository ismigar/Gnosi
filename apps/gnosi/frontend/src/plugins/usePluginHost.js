/**
 * usePluginHost — accés React a les contribucions dels plugins de tercers.
 *
 * Subscriu el component al store de `host.js` (comandes, vistes i panells que
 * els plugins han registrat) i dispara la càrrega inicial dels plugins un sol
 * cop per sessió. Els consumidors (paleta de comandes, shell, sidebar) hi
 * llegeixen les contribucions actives i es re-renderitzen quan canvien.
 */
import { useEffect, useState } from 'react';
import { subscribeHost, loadPlugins, isLoaded, getContributions } from './host';

let _kickoff = null;

export function usePluginHost() {
    const [state, setState] = useState(getContributions());

    useEffect(() => {
        const unsub = subscribeHost(setState);
        if (!isLoaded() && !_kickoff) {
            _kickoff = loadPlugins().finally(() => { _kickoff = null; });
        }
        return () => { unsub(); };
    }, []);

    return state; // { commands, views, sidebar }
}

/** Força una recàrrega dels plugins (p. ex. després de canviar permisos). */
export function reloadPlugins() {
    return loadPlugins();
}

export default usePluginHost;
