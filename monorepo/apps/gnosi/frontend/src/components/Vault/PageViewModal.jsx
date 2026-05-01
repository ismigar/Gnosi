import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { X, Eye } from 'lucide-react';

/**
 * Modal per afegir una vista de BD a una pàgina concreta via slash command /vista.
 * Crida POST /api/pages/{pageId}/views i sincronitza el .md.
 */
export function PageViewModal({ isOpen, onClose, pageId, allTables = [], apiFetch, preselectedTableId = '' }) {
    const { t } = useTranslation();

    const [heading, setHeading] = useState('');
    const [headingLevel, setHeadingLevel] = useState(1);
    const [sourceTableId, setSourceTableId] = useState(preselectedTableId);
    const [filterField, setFilterField] = useState('');
    const [filterValue, setFilterValue] = useState('this');
    const [columns, setColumns] = useState('title');
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');

    useEffect(() => {
        if (isOpen) {
            setSourceTableId(preselectedTableId || '');
            setFilterField('');
        }
    }, [isOpen, preselectedTableId]);

    if (!isOpen) return null;

    const selectedTable = allTables.find(t => t.id === sourceTableId);
    // Single source of truth = property `name` in the registry. Identity (no
    // slug). Mirrors backend (virtual_fields._frontmatter_key) and pipeline
    // (import_from_export.normalize_key, sync_sections.property_name_to_frontmatter_key).
    // Slugging here while the rest of the stack uses canonical names was making
    // sync_sections silently render zero rows for these views.
    const relationProps = (selectedTable?.properties || [])
        .filter(p => p.type === 'relation')
        .map(p => ({
            label: p.name,
            key: p.name,
        }));

    const reset = () => {
        setHeading(''); setHeadingLevel(1); setSourceTableId(preselectedTableId);
        setFilterField(''); setFilterValue('this'); setColumns('title');
        setError('');
    };

    const handleClose = (changed = false) => {
        reset();
        onClose(changed);
    };

    const handleSave = async () => {
        if (!heading.trim()) {
            setError(t('page_view.error_heading', 'Cal un nom per al heading'));
            return;
        }
        if (!sourceTableId) {
            setError(t('page_view.error_table', 'Cal seleccionar una taula origen'));
            return;
        }

        setSaving(true);
        setError('');
        try {
            const body = {
                heading: heading.trim(),
                heading_level: headingLevel,
                type: 'db_view',
                source_table_id: sourceTableId,
                filter: filterField ? { field: filterField, value: filterValue || 'this' } : null,
                columns: columns.split(',').map(c => c.trim()).filter(Boolean),
            };

            const res = await apiFetch(`/api/pages/${pageId}/views`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            });

            if (!res.ok) {
                const data = await res.json().catch(() => ({}));
                throw new Error(data.detail || res.statusText);
            }

            handleClose(true);
        } catch (e) {
            setError(e.message);
        } finally {
            setSaving(false);
        }
    };

    const handleOverlayClick = (e) => {
        if (e.target === e.currentTarget) handleClose(false);
    };

    return (
        <div
            className="fixed inset-0 bg-black/60 flex items-center justify-center z-[200] p-4 backdrop-blur-sm"
            onClick={handleOverlayClick}
        >
            <div className="bg-[var(--bg-primary)] rounded-xl shadow-2xl w-full max-w-md border border-[var(--border-primary)] flex flex-col">
                {/* Header */}
                <div className="px-5 py-4 border-b border-[var(--border-primary)] flex justify-between items-center bg-[var(--bg-secondary)] rounded-t-xl">
                    <h2 className="text-sm font-bold text-[var(--text-primary)] flex items-center gap-2">
                        <Eye size={16} className="text-[var(--gnosi-primary)]" />
                        {t('page_view.title', 'Afegir vista de BD')}
                    </h2>
                    <button onClick={() => handleClose(false)} className="gnosi-close-btn">
                        <X size={16} />
                    </button>
                </div>

                {/* Body */}
                <div className="p-5 space-y-4">
                    {/* Heading */}
                    <div className="flex gap-2">
                        <div className="flex-1">
                            <label className="block text-xs font-semibold text-[var(--text-secondary)] mb-1">
                                {t('page_view.heading', 'Nom del heading')}
                            </label>
                            <input
                                className="w-full text-sm border border-[var(--border-primary)] rounded-lg px-3 py-2 bg-[var(--bg-primary)] text-[var(--text-primary)] focus:ring-1 focus:ring-[var(--gnosi-primary)] outline-none"
                                value={heading}
                                onChange={e => setHeading(e.target.value)}
                                onKeyDown={e => e.key === 'Enter' && handleSave()}
                                placeholder={t('page_view.heading_placeholder', 'ex: Contactes clau')}
                                autoFocus
                            />
                        </div>
                        <div className="w-24">
                            <label className="block text-xs font-semibold text-[var(--text-secondary)] mb-1">
                                {t('page_view.level', 'Nivell')}
                            </label>
                            <select
                                className="w-full text-sm border border-[var(--border-primary)] rounded-lg px-2 py-2 bg-[var(--bg-primary)] text-[var(--text-primary)] outline-none focus:ring-1 focus:ring-[var(--gnosi-primary)]"
                                value={headingLevel}
                                onChange={e => setHeadingLevel(Number(e.target.value))}
                            >
                                <option value={1}># H1</option>
                                <option value={2}>## H2</option>
                                <option value={3}>### H3</option>
                            </select>
                        </div>
                    </div>

                    {/* Taula origen */}
                    <div>
                        <label className="block text-xs font-semibold text-[var(--text-secondary)] mb-1">
                            {t('page_view.source_table', 'Taula origen')}
                        </label>
                        <select
                            className="w-full text-sm border border-[var(--border-primary)] rounded-lg px-3 py-2 bg-[var(--bg-primary)] text-[var(--text-primary)] outline-none focus:ring-1 focus:ring-[var(--gnosi-primary)]"
                            value={sourceTableId}
                            onChange={e => { setSourceTableId(e.target.value); setFilterField(''); }}
                        >
                            <option value="">{t('page_view.select_table', '— Selecciona taula —')}</option>
                            {allTables.map(tbl => (
                                <option key={tbl.id} value={tbl.id}>{tbl.name}</option>
                            ))}
                        </select>
                    </div>

                    {/* Filtre (opcional, apareix si hi ha relacions a la taula) */}
                    {relationProps.length > 0 && (
                        <div className="flex gap-2">
                            <div className="flex-1">
                                <label className="block text-xs font-semibold text-[var(--text-secondary)] mb-1">
                                    {t('page_view.filter_field', 'Filtre per camp')}
                                </label>
                                <select
                                    className="w-full text-sm border border-[var(--border-primary)] rounded-lg px-3 py-2 bg-[var(--bg-primary)] text-[var(--text-primary)] outline-none focus:ring-1 focus:ring-[var(--gnosi-primary)]"
                                    value={filterField}
                                    onChange={e => setFilterField(e.target.value)}
                                >
                                    <option value="">{t('page_view.no_filter', '— Sense filtre —')}</option>
                                    {relationProps.map(p => (
                                        <option key={p.key} value={p.key}>{p.label}</option>
                                    ))}
                                </select>
                            </div>
                            {filterField && (
                                <div className="w-28">
                                    <label className="block text-xs font-semibold text-[var(--text-secondary)] mb-1">
                                        {t('page_view.filter_value', 'Valor')}
                                    </label>
                                    <input
                                        className="w-full text-sm border border-[var(--border-primary)] rounded-lg px-3 py-2 bg-[var(--bg-primary)] text-[var(--text-primary)] outline-none focus:ring-1 focus:ring-[var(--gnosi-primary)]"
                                        value={filterValue}
                                        onChange={e => setFilterValue(e.target.value)}
                                        placeholder="this"
                                        title={t('page_view.filter_hint', '"this" = ID d\'aquesta pàgina')}
                                    />
                                </div>
                            )}
                        </div>
                    )}

                    {/* Columnes */}
                    <div>
                        <label className="block text-xs font-semibold text-[var(--text-secondary)] mb-1">
                            {t('page_view.columns', 'Columnes (separades per coma)')}
                        </label>
                        <input
                            className="w-full text-sm border border-[var(--border-primary)] rounded-lg px-3 py-2 bg-[var(--bg-primary)] text-[var(--text-primary)] outline-none focus:ring-1 focus:ring-[var(--gnosi-primary)]"
                            value={columns}
                            onChange={e => setColumns(e.target.value)}
                            placeholder="title, estat, data"
                        />
                    </div>

                    {error && (
                        <p className="text-xs text-red-500 bg-red-50 dark:bg-red-900/20 rounded-lg px-3 py-2">
                            {error}
                        </p>
                    )}
                </div>

                {/* Footer */}
                <div className="px-5 py-4 border-t border-[var(--border-primary)] bg-[var(--bg-secondary)] flex justify-end gap-3 rounded-b-xl">
                    <button
                        onClick={() => handleClose(false)}
                        disabled={saving}
                        className="px-4 py-2 border border-[var(--border-primary)] rounded-lg text-sm font-semibold text-[var(--text-secondary)] hover:bg-[var(--bg-primary)] transition-colors"
                    >
                        {t('common.cancel', 'Cancel·lar')}
                    </button>
                    <button
                        onClick={handleSave}
                        disabled={saving}
                        className="btn-gnosi btn-gnosi-primary px-6"
                    >
                        {saving
                            ? t('page_view.saving', 'Desant...')
                            : t('page_view.save', 'Crear vista')}
                    </button>
                </div>
            </div>
        </div>
    );
}
