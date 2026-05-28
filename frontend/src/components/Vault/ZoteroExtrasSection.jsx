import React from 'react';
import { useTranslation } from 'react-i18next';
import { Sparkles, ChevronRight } from 'lucide-react';

/**
 * Renderitza la clau `Zotero Extras` del frontmatter (un dict amb camps
 * Zotero rars com `patentNumber`, `conferenceName`, `meetingName`, ...).
 *
 * El backend captura aquests camps al mapper central (L3.4) quan un
 * Zotero item porta info que no encaixa a cap columna canònica de
 * Recursos. Aquest component els mostra al panell Propietats com a
 * secció expandible separada del grid principal.
 *
 * Lectura-només per a aquest PR: si l'usuari vol editar un valor,
 * pot fer-ho al .md directament. Edició interactiva ve en un PR posterior
 * si cal.
 *
 * No es renderitza si `extras` és null/undefined/buit. Tampoc si el
 * caller ja l'ha filtrat — aquí afegim defensivament el check `typeof`
 * per si ve un valor corrupte (string en lloc de dict).
 */
export function ZoteroExtrasSection({ extras }) {
    const { t } = useTranslation();
    if (!extras || typeof extras !== 'object' || Array.isArray(extras)) return null;
    const entries = Object.entries(extras).filter(([, v]) => v !== null && v !== undefined && v !== '');
    if (entries.length === 0) return null;

    return (
        <details className="col-span-2 mt-3 rounded-xl border border-[var(--border-primary)] bg-[var(--bg-secondary)]/40 overflow-hidden group">
            <summary
                className="cursor-pointer flex items-center justify-between gap-3 px-3 py-2.5 hover:bg-[var(--bg-secondary)]/60 transition-colors list-none [&::-webkit-details-marker]:hidden"
            >
                <div className="flex items-center gap-2 text-sm font-medium text-[var(--text-secondary)]">
                    <Sparkles size={14} className="text-[var(--gnosi-primary)]/70" />
                    <span>
                        {t('zotero_extras.title', { defaultValue: 'Detalls Zotero addicionals' })}
                    </span>
                    <span className="text-xs font-normal text-[var(--text-tertiary)]">({entries.length})</span>
                </div>
                <ChevronRight
                    size={14}
                    className="text-[var(--text-tertiary)] transition-transform group-open:rotate-90"
                />
            </summary>
            <div className="px-3 py-2.5 border-t border-[var(--border-primary)]/50">
                <p className="text-[11px] text-[var(--text-tertiary)] italic mb-2">
                    {t('zotero_extras.hint', {
                        defaultValue: 'Camps importats des de Zotero que no tenen columna pròpia al Vault. Lectura-només.',
                    })}
                </p>
                <dl className="grid grid-cols-[minmax(0,1fr)_minmax(0,2fr)] gap-x-3 gap-y-1.5 text-xs">
                    {entries.map(([k, v]) => (
                        <React.Fragment key={k}>
                            <dt className="font-mono text-[var(--text-secondary)] truncate" title={k}>{k}</dt>
                            <dd className="text-[var(--text-primary)] break-words whitespace-pre-wrap">
                                {typeof v === 'object' ? JSON.stringify(v) : String(v)}
                            </dd>
                        </React.Fragment>
                    ))}
                </dl>
            </div>
        </details>
    );
}

export default ZoteroExtrasSection;
