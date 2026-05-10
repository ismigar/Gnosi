import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import axios from 'axios';
import { X, Plus, RefreshCw, AlertTriangle, Info, Save } from 'lucide-react';
import { toast } from '../../lib/toast';

const IGNORE_VALUE = '__ignore__';

export default function ZoteroMappingModal({ isOpen, onClose, tableId, onSaved }) {
    const { t } = useTranslation();
    const [loading, setLoading] = useState(false);
    const [saving, setSaving] = useState(false);
    const [tableInfo, setTableInfo] = useState(null);     // { table_name, properties[], total_pages, pages_with_zotero_key, pages_without_zotero_key }
    const [zFields, setZFields] = useState([]);            // [{id, slug}]
    const [mapping, setMapping] = useState({});             // { z_field_id: property_id | "" }
    const [conflicts, setConflicts] = useState([]);
    const [error, setError] = useState('');

    const propertyById = useMemo(() => {
        const out = {};
        (tableInfo?.properties || []).forEach(p => { out[p.id] = p; });
        return out;
    }, [tableInfo]);

    // Carrega inicial: inspect + fields + suggest-mapping
    useEffect(() => {
        if (!isOpen || !tableId) return;
        let cancelled = false;
        setLoading(true);
        setError('');
        Promise.all([
            axios.get(`/api/zotero/inspect/${tableId}`),
            axios.get('/api/zotero/fields'),
            axios.get('/api/zotero/config'),
            axios.post('/api/zotero/suggest-mapping', { table_id: tableId }),
        ])
            .then(([inspectRes, fieldsRes, configRes, suggestRes]) => {
                if (cancelled) return;
                setTableInfo(inspectRes.data);
                setZFields(fieldsRes.data || []);
                const persisted = configRes.data?.mapping || {};
                const suggested = suggestRes.data?.mapping || {};
                // Persisted té prioritat; suggested omple els forats.
                const merged = { ...suggested, ...persisted };
                // Normalitzem null/undefined a "" per a l'estat controlat dels selects.
                Object.keys(merged).forEach(k => { if (!merged[k]) merged[k] = ''; });
                setMapping(merged);
                setConflicts(suggestRes.data?.conflicts || []);
            })
            .catch(e => {
                if (!cancelled) setError(e?.response?.data?.detail || e.message || 'Error carregant dades');
            })
            .finally(() => { if (!cancelled) setLoading(false); });
        return () => { cancelled = true; };
    }, [isOpen, tableId]);

    // Tancar amb Escape
    useEffect(() => {
        if (!isOpen) return;
        const onKey = (e) => { if (e.key === 'Escape') onClose(); };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [isOpen, onClose]);

    // IMPORTANT: tots els hooks han d'anar abans de qualsevol early return
    // (Rules of Hooks). Aquest useMemo originalment vivia després del
    // `if (!isOpen) return null` i provocava "Rendered more hooks than during
    // the previous render" quan la modal canviava entre tancada i oberta.
    const conflictByZField = useMemo(() => {
        const out = {};
        conflicts.forEach(c => { out[c.zotero_field] = c; });
        return out;
    }, [conflicts]);

    if (!isOpen) return null;

    const handleSelectChange = (zFieldId, value) => {
        setMapping(prev => ({ ...prev, [zFieldId]: value === IGNORE_VALUE ? '' : value }));
    };

    const handleCreateColumn = async (zField) => {
        try {
            const res = await axios.post('/api/zotero/create-column', {
                table_id: tableId,
                zotero_field_id: zField.id,
            });
            const newProp = res.data;
            // Refresca propietats locals
            setTableInfo(prev => ({
                ...prev,
                properties: [...(prev?.properties || []), newProp],
            }));
            setMapping(prev => ({ ...prev, [zField.id]: newProp.id }));
            toast.success(t('settings.zotero.mapping.column_created', { name: newProp.name }) || `Columna "${newProp.name}" creada`);
        } catch (e) {
            toast.error(e?.response?.data?.detail || t('settings.zotero.mapping.column_create_error') || 'Error creant columna');
        }
    };

    const handleReapplySuggestion = async () => {
        try {
            const res = await axios.post('/api/zotero/suggest-mapping', { table_id: tableId });
            const suggested = res.data?.mapping || {};
            Object.keys(suggested).forEach(k => { if (!suggested[k]) suggested[k] = ''; });
            // Garantim totes les claus
            const fullMap = {};
            zFields.forEach(f => { fullMap[f.id] = suggested[f.id] || ''; });
            setMapping(fullMap);
            setConflicts(res.data?.conflicts || []);
            toast.success(t('settings.zotero.mapping.suggestion_applied') || 'Suggerència aplicada');
        } catch (e) {
            toast.error(e?.response?.data?.detail || 'Error');
        }
    };

    const handleSave = async () => {
        setSaving(true);
        try {
            // Filtra valors buits — només desem mapping efectiu
            const cleanMapping = Object.fromEntries(
                Object.entries(mapping).filter(([, v]) => !!v)
            );
            const cfgRes = await axios.get('/api/zotero/config');
            const current = cfgRes.data || {};
            await axios.post('/api/zotero/config', {
                ...current,
                target_table: tableId,
                mapping: cleanMapping,
            });
            toast.success(t('settings.zotero.mapping.saved') || 'Mapping desat');
            if (onSaved) onSaved(cleanMapping);
            onClose();
        } catch (e) {
            toast.error(e?.response?.data?.detail || t('settings.zotero.mapping.save_error') || 'Error desant');
        } finally {
            setSaving(false);
        }
    };

    const labelForZField = (zField) => {
        const key = `settings.zotero.fields.${zField.id}`;
        const translated = t(key);
        return translated === key ? zField.id : translated;
    };

    const pagesWithoutKey = tableInfo?.pages_without_zotero_key || 0;

    return (
        <div className="modal-overlay active" style={{
            zIndex: 100000,
            backdropFilter: 'blur(8px)',
            background: 'rgba(0,0,0,0.35)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh',
        }} onClick={onClose}>
            <div className="modal-content animate-pop" onClick={e => e.stopPropagation()} style={{
                width: '720px', maxWidth: '92vw', maxHeight: '90vh',
                display: 'flex', flexDirection: 'column',
                padding: '40px', borderRadius: '32px',
                boxShadow: '0 30px 80px rgba(0,0,0,0.18)',
                border: '1px solid var(--settings-border)',
                background: 'var(--settings-bg)',
                overflow: 'hidden', position: 'relative',
            }}>
                <button onClick={onClose} className="icon-btn hover-bg" style={{
                    position: 'absolute', top: '24px', right: '24px',
                    padding: '10px', borderRadius: '50%',
                    color: 'var(--text-secondary)',
                    background: 'var(--settings-sidebar-bg)',
                    border: '1px solid var(--settings-border)',
                    width: '40px', height: '40px',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}><X size={18} /></button>

                <div style={{ marginBottom: '20px' }}>
                    <h3 style={{ margin: 0, fontSize: '1.4rem', fontWeight: 900 }}>
                        {t('settings.zotero.mapping.title') || 'Mapping de camps Zotero'}
                    </h3>
                    {tableInfo?.table_name && (
                        <div style={{ marginTop: '6px', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                            {t('settings.zotero.mapping.target_table_label') || 'Taula de destí'}: <strong>{tableInfo.table_name}</strong>
                        </div>
                    )}
                </div>

                {pagesWithoutKey > 0 && (
                    <div style={{
                        display: 'flex', gap: '12px', alignItems: 'flex-start',
                        padding: '14px 18px', borderRadius: '14px',
                        background: 'rgba(245, 158, 11, 0.08)',
                        border: '1px solid rgba(245, 158, 11, 0.2)',
                        marginBottom: '20px',
                    }}>
                        <AlertTriangle size={18} color="var(--color-warning, #f59e0b)" style={{ flexShrink: 0, marginTop: '2px' }} />
                        <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                            {t('settings.zotero.mapping.pages_without_key_warning', { count: pagesWithoutKey })
                                || `Hi ha ${pagesWithoutKey} pàgines sense zotero_key. Quan facis sync, podrien duplicar-se. (Match per títol s'introdueix a la propera fase.)`}
                        </div>
                    </div>
                )}

                {error && (
                    <div style={{
                        padding: '14px 18px', borderRadius: '14px',
                        background: 'rgba(239, 68, 68, 0.08)',
                        border: '1px solid rgba(239, 68, 68, 0.2)',
                        marginBottom: '20px', fontSize: '0.85rem', color: 'var(--color-error, #ef4444)',
                    }}>{error}</div>
                )}

                {loading && (
                    <div style={{ padding: '40px', textAlign: 'center', color: 'var(--text-secondary)' }}>
                        <RefreshCw size={20} style={{ animation: 'spin 1s linear infinite' }} />
                    </div>
                )}

                {!loading && !error && (
                    <div style={{ flex: 1, overflowY: 'auto', paddingRight: '4px' }}>
                        {/* Capçalera sticky: queda enganxada al top de la zona scrollable
                            mentre l'usuari recorre els 36 camps. Background opac i z-index
                            perquè les files no es transparentin per sota. */}
                        <div style={{
                            position: 'sticky',
                            top: 0,
                            zIndex: 2,
                            background: 'var(--settings-bg)',
                            display: 'grid',
                            gridTemplateColumns: '1fr 1.4fr auto',
                            gap: '10px 16px',
                            alignItems: 'center',
                            fontSize: '0.72rem',
                            color: 'var(--text-tertiary)',
                            textTransform: 'uppercase',
                            letterSpacing: '0.06em',
                            fontWeight: 800,
                            paddingTop: '4px',
                            paddingBottom: '10px',
                            borderBottom: '1px solid var(--settings-border)',
                            marginBottom: '8px',
                        }}>
                            <div>{t('settings.zotero.mapping.col_zotero') || 'Camp Zotero'}</div>
                            <div>{t('settings.zotero.mapping.col_property') || 'Propietat del Vault'}</div>
                            <div></div>
                        </div>

                        {zFields.map(zField => {
                            const value = mapping[zField.id] || '';
                            const conflict = conflictByZField[zField.id];
                            return (
                                <div key={zField.id} style={{
                                    display: 'grid',
                                    gridTemplateColumns: '1fr 1.4fr auto',
                                    gap: '10px 16px',
                                    alignItems: 'center',
                                    padding: '10px 0',
                                    borderBottom: '1px solid rgba(0,0,0,0.04)',
                                }}>
                                    <div>
                                        <div style={{ fontWeight: 700, fontSize: '0.92rem' }}>{labelForZField(zField)}</div>
                                        <div style={{ fontSize: '0.72rem', color: 'var(--text-tertiary)' }}>{zField.id}</div>
                                    </div>
                                    <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                                        <select
                                            className="gnosi-select"
                                            value={value || IGNORE_VALUE}
                                            onChange={e => handleSelectChange(zField.id, e.target.value)}
                                            style={{ flex: 1 }}
                                        >
                                            <option value={IGNORE_VALUE}>
                                                {t('settings.zotero.mapping.option_ignore') || '— No sincronitzar —'}
                                            </option>
                                            {(tableInfo?.properties || []).map(p => (
                                                <option key={p.id} value={p.id}>
                                                    {p.name} ({p.type})
                                                </option>
                                            ))}
                                        </select>
                                        {conflict && (
                                            <span title={t('settings.zotero.mapping.type_mismatch_tooltip', {
                                                expected: conflict.expected_type,
                                                actual: conflict.actual_type,
                                            }) || `Tipus esperat: ${conflict.expected_type}, actual: ${conflict.actual_type}`}>
                                                <AlertTriangle size={16} color="var(--color-warning, #f59e0b)" />
                                            </span>
                                        )}
                                    </div>
                                    <button
                                        className="btn-gnosi-secondary"
                                        onClick={() => handleCreateColumn(zField)}
                                        title={t('settings.zotero.mapping.create_column_tooltip') || 'Crear columna nova al Vault per aquest camp'}
                                        style={{
                                            display: 'inline-flex', alignItems: 'center', gap: '4px',
                                            padding: '6px 10px', fontSize: '0.78rem', borderRadius: '10px',
                                        }}
                                    >
                                        <Plus size={14} /> {t('settings.zotero.mapping.create_column') || 'Crear'}
                                    </button>
                                </div>
                            );
                        })}
                    </div>
                )}

                {!loading && (
                    <div style={{
                        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                        marginTop: '24px', paddingTop: '20px',
                        borderTop: '1px solid var(--settings-border)',
                    }}>
                        <button
                            className="btn-gnosi-secondary"
                            onClick={handleReapplySuggestion}
                            style={{
                                display: 'inline-flex', alignItems: 'center', gap: '6px',
                                padding: '10px 16px', fontSize: '0.85rem', borderRadius: '12px',
                            }}
                        >
                            <RefreshCw size={14} /> {t('settings.zotero.mapping.reapply_suggestion') || 'Reaplica auto-suggerència'}
                        </button>
                        <div style={{ display: 'flex', gap: '10px' }}>
                            <button
                                className="btn-gnosi-secondary"
                                onClick={onClose}
                                style={{ padding: '10px 18px', fontSize: '0.85rem', borderRadius: '12px' }}
                            >
                                {t('common.cancel') || 'Cancel·lar'}
                            </button>
                            <button
                                className="btn-gnosi-primary"
                                onClick={handleSave}
                                disabled={saving}
                                style={{
                                    display: 'inline-flex', alignItems: 'center', gap: '6px',
                                    padding: '10px 22px', fontSize: '0.9rem', borderRadius: '12px',
                                    opacity: saving ? 0.6 : 1,
                                }}
                            >
                                {saving ? <RefreshCw size={14} style={{ animation: 'spin 1s linear infinite' }} /> : <Save size={14} />}
                                {t('settings.zotero.mapping.save') || 'Desar mapping'}
                            </button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
