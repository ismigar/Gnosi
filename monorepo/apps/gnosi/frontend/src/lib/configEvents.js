// Sistema d'invalidació de configuració global.
//
// Substitueix el `window.location.reload()` que abans aplicaven els modals
// de settings després d'editar `params.yaml` / `.env`. Ara emeten un event
// i els consumidors es subscriuen per refetch silenciós.
//
// Disseny:
// - `emitConfigChanged()` dispara un CustomEvent al window.
// - `useConfigChanged(callback)` ho escolta i crida el callback. Captura la
//   última versió del callback amb un ref intern, així el component pot
//   passar una funció inline sense haver d'embolicar-la amb `useCallback`.
//
// Quan emetre: a `SettingsModal` i `GlobalSettingsModal`, després de cada
// autosave amb èxit a `/api/config` o `/api/env`.
//
// Quan escoltar: a qualsevol component que faci GET a `/api/config`
// (AgentChat, VaultGraph, Dashboard, GraphPage). Els components que reben
// `config` com a prop (p.ex. GraphViewer) no cal que s'subscriguin — el
// pare refetcha i actualitza l'estat, i React repinta el fill.

import { useEffect, useRef } from 'react';

const CONFIG_CHANGED = 'gnosi:config-changed';

export function emitConfigChanged() {
    window.dispatchEvent(new CustomEvent(CONFIG_CHANGED));
}

export function useConfigChanged(callback) {
    const ref = useRef(callback);
    useEffect(() => { ref.current = callback; });
    useEffect(() => {
        const handler = () => ref.current?.();
        window.addEventListener(CONFIG_CHANGED, handler);
        return () => window.removeEventListener(CONFIG_CHANGED, handler);
    }, []);
}
