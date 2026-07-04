/**
 * useModalKeyboard.js
 * Gestió de teclat CANÒNICA per a modals de Gnosi.
 *
 *   Esc   → acció negativa (cancel·lar / tancar)  — sempre, sense condicions
 *   Enter → acció positiva (confirmar)            — amb salvaguardes
 *   Tab   → focus-trap dins el modal              — opcional (trapFocus)
 *
 * Per què en fase de CAPTURA i a `window`:
 *   Editors i pickers de dins del modal (BlockEditor, dnd-kit, MultiSelectPills…)
 *   criden `stopPropagation()` en els seus keydown. Si escoltéssim en bombolla,
 *   l'event mai arribaria al listener i l'Esc "no respondria" segons des d'on
 *   tinguessis el focus. En captura, l'event ens arriba ABANS que cap fill el
 *   pugui aturar. Aquest és el patró que ja fan servir FilesystemPicker,
 *   InsertContentModal, PageViewModal i BlockEditor.
 *
 * Per què refs i no deps:
 *   Vincular el listener només a `isOpen` (i no a `onClose`/`onConfirm`) evita el
 *   "churn": si depenguéssim de callbacks recreats a cada render, el listener es
 *   desvincularia/revincularia constantment i deixaria finestres on una pulsació
 *   real es perd. Llegim els callbacks via ref, sempre actualitzats.
 *
 * Conviu amb navegació pròpia (fletxes ↑↓ per llistes): aquest hook NOMÉS toca
 * Escape, Enter (si passes onConfirm) i Tab (si trapFocus). Deixa la resta de
 * tecles intactes, així un modal amb llista navegable manté el seu handler de
 * fletxes i només delega Esc/Enter aquí.
 *
 * @param {Object}   params
 * @param {boolean}  params.isOpen           - El modal és visible.
 * @param {Function} params.onClose          - Acció negativa (Esc / backdrop).
 * @param {Function} [params.onConfirm]      - Acció positiva (Enter). Omet-la si el modal no en té (p. ex. dropdowns o llistes amb Enter propi).
 * @param {boolean}  [params.confirmDisabled] - Si true, Enter no confirma (mirall del botó primari deshabilitat).
 * @param {React.RefObject} [params.containerRef] - Ref al panell del modal. Enter només confirma si el focus hi és a dins; necessari per a trapFocus.
 * @param {boolean}  [params.closeOnEscape]  - Permet desactivar Esc en casos molt concrets (per defecte true).
 * @param {boolean}  [params.trapFocus]      - Si true, Tab cicla dins el modal i es restaura el focus al tancar (necessita containerRef).
 */
import { useEffect, useRef } from 'react';

// ── Pila global de capes de modal ──────────────────────────────────────────
// Amb modals NIATS (Configuració → Importa Notion → esquema / confirmació),
// cada Esc ha de tancar només el modal SUPERIOR, no tota la pila alhora: com
// que aquest hook escolta a `window` en fase de captura, sense la pila el
// modal de sota veia l'Esc del de sobre i es tancava també (l'usuari queia
// de cop a la home). Cada modal obert registra una capa en obrir-se i
// l'allibera en tancar; els handlers d'Esc només actuen si la seva capa és
// la de dalt. Exportada perquè modals amb gestió de teclat pròpia
// (SchemaConfigModal) també hi comptin.
const modalLayerStack = [];

export function pushModalLayer() {
    const token = {};
    modalLayerStack.push(token);
    return {
        isTop: () => modalLayerStack[modalLayerStack.length - 1] === token,
        release: () => {
            const i = modalLayerStack.indexOf(token);
            if (i !== -1) modalLayerStack.splice(i, 1);
        },
    };
}

export function useModalKeyboard({
    isOpen,
    onClose,
    onConfirm = null,
    confirmDisabled = false,
    containerRef = null,
    closeOnEscape = true,
    trapFocus = false,
}) {
    const onCloseRef = useRef(onClose);
    const onConfirmRef = useRef(onConfirm);
    const confirmDisabledRef = useRef(confirmDisabled);
    // Mantenim els refs frescos en un effect (la regla react-hooks/refs prohibeix
    // escriure'ls durant el render). Sense array de deps → corre després de cada
    // commit, així el listener (vinculat només per isOpen) llegeix sempre els
    // valors actuals sense haver-se de re-registrar.
    useEffect(() => {
        onCloseRef.current = onClose;
        onConfirmRef.current = onConfirm;
        confirmDisabledRef.current = confirmDisabled;
    });

    useEffect(() => {
        if (!isOpen) return undefined;

        // Registra aquest modal a la pila de capes: només el de dalt respon a Esc.
        const layer = pushModalLayer();

        // Recordem qui tenia el focus ABANS d'obrir, per restaurar-lo en tancar
        // (accessibilitat). Funciona perquè els modals ja NO usen autoFocus HTML
        // (que mouria el focus abans d'aquesta línia): el focus inicial el posa
        // aquest hook més avall, després de capturar l'element extern.
        const previouslyFocused = trapFocus ? document.activeElement : null;

        // Focus inicial dins el modal: l'element marcat amb [data-autofocus], o
        // el primer focusable, o el panell mateix. Síncron dins l'effect (NO en
        // requestAnimationFrame, que es pausa en pestanyes en segon pla). El
        // contingut ja és al DOM quan corre l'effect. Només amb trapFocus.
        if (trapFocus && containerRef?.current) {
            const root = containerRef.current;
            if (!root.contains(document.activeElement)) {
                const target = root.querySelector('[data-autofocus]')
                    || root.querySelector(
                        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
                    )
                    || root;
                try { target?.focus?.(); } catch { /* element no enfocable */ }
            }
        }

        const getFocusable = () => {
            const root = containerRef?.current;
            if (!root) return [];
            return Array.from(
                root.querySelectorAll(
                    'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
                ),
            ).filter((el) => el.offsetParent !== null || el === document.activeElement);
        };

        const handleKeyDown = (e) => {
            if (closeOnEscape && e.key === 'Escape') {
                // Amb un modal niat obert a sobre (capa superior d'un altre),
                // l'Esc és seu: no tanquem ni consumim l'event.
                if (!layer.isTop()) return;
                e.preventDefault();
                onCloseRef.current?.();
                return;
            }

            // Focus-trap: Tab cicla dins el modal (opcional).
            if (trapFocus && e.key === 'Tab') {
                const items = getFocusable();
                if (items.length === 0) return;
                const root = containerRef?.current;
                const first = items[0];
                const last = items[items.length - 1];
                const active = document.activeElement;
                if (e.shiftKey) {
                    if (active === first || !root?.contains(active)) {
                        e.preventDefault();
                        last.focus();
                    }
                } else if (active === last || !root?.contains(active)) {
                    e.preventDefault();
                    first.focus();
                }
                return;
            }

            if (e.key === 'Enter' && onConfirmRef.current) {
                // Combinacions de tecles: no són "confirmar".
                if (e.shiftKey || e.ctrlKey || e.metaKey || e.altKey) return;
                // IME (xinès, japonès, coreà…): Enter tanca la composició, no el modal.
                if (e.isComposing || e.keyCode === 229) return;

                const ae = document.activeElement;
                const tag = ae?.tagName;
                // En text multilínia, Enter és salt de línia.
                if (tag === 'TEXTAREA' || ae?.isContentEditable) return;
                // Si el focus és en un element interactiu propi (botó, enllaç,
                // select), deixem el seu comportament natiu: així Enter sobre
                // "Cancel·lar" cancel·la i sobre el botó primari confirma, sense
                // que el hook ho sobreescrigui.
                if (tag === 'BUTTON' || tag === 'A' || tag === 'SELECT') return;
                // Mirall del botó primari deshabilitat.
                if (confirmDisabledRef.current) return;
                // Evita confirmar des d'un input del fons (fora del modal).
                if (containerRef?.current && !containerRef.current.contains(ae)) return;

                e.preventDefault();
                onConfirmRef.current();
            }
        };

        window.addEventListener('keydown', handleKeyDown, true);
        return () => {
            window.removeEventListener('keydown', handleKeyDown, true);
            layer.release();
            // Restaura el focus a qui el tenia abans d'obrir (només amb trapFocus).
            if (previouslyFocused && typeof previouslyFocused.focus === 'function') {
                try { previouslyFocused.focus(); } catch { /* l'element ja no existeix */ }
            }
        };
    }, [isOpen, closeOnEscape, containerRef, trapFocus]);
}

export default useModalKeyboard;
