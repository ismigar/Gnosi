import React, { useState, useEffect, useMemo, useCallback } from 'react';
import axios from 'axios';
import { Trash2, Undo2, Clock, Search, AlertTriangle } from 'lucide-react';
import { toast } from '../../lib/toast';

function fmtDate(iso) {
    if (!iso) return '—';
    try {
        return new Date(iso).toLocaleString('ca-ES', {
            day: 'numeric', month: 'short', year: 'numeric',
            hour: '2-digit', minute: '2-digit',
        });
    } catch {
        return iso;
    }
}

function fmtBytes(bytes) {
    if (!bytes || bytes <= 0) return '';
    const units = ['B', 'kB', 'MB', 'GB'];
    let v = bytes;
    let i = 0;
    while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
    return `${v.toFixed(v >= 10 || i === 0 ? 0 : 1)} ${units[i]}`;
}

export function VaultTrashView({ onAfterChange }) {
    const [items, setItems] = useState([]);
    const [loading, setLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');
    const [retentionDays, setRetentionDays] = useState(90);
    const [confirmEmptyAll, setConfirmEmptyAll] = useState(false);

    const fetchTrash = useCallback(async () => {
        setLoading(true);
        try {
            const res = await axios.get('/api/vault/trash');
            setItems(res.data?.items || []);
            setRetentionDays(res.data?.retention_days || 90);
        } catch (err) {
            console.error('Error carregant la paperera:', err);
            toast.error('No s\'ha pogut carregar la paperera');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { fetchTrash(); }, [fetchTrash]);

    const filtered = useMemo(() => {
        if (!searchTerm) return items;
        const needle = searchTerm.toLowerCase();
        return items.filter(it =>
            String(it.title || '').toLowerCase().includes(needle)
            || String(it.id || '').toLowerCase().includes(needle)
            || String(it.original_path || '').toLowerCase().includes(needle)
        );
    }, [items, searchTerm]);

    const handleRestore = async (id) => {
        try {
            await axios.post(`/api/vault/pages/${id}/restore`);
            toast.success('Pàgina restaurada');
            await fetchTrash();
            onAfterChange?.();
        } catch (err) {
            if (err?.response?.status === 409) {
                toast.error('Ja existeix un fitxer al destí original');
            } else {
                console.error('Error restaurant:', err);
                toast.error('No s\'ha pogut restaurar');
            }
        }
    };

    const handlePurge = async (id, title) => {
        const ok = window.confirm(`Eliminar permanentment "${title || id}"? No es podrà recuperar.`);
        if (!ok) return;
        try {
            await axios.delete(`/api/vault/trash/${id}`);
            toast.success('Eliminat permanentment');
            await fetchTrash();
            onAfterChange?.();
        } catch (err) {
            console.error('Error purgant:', err);
            toast.error('No s\'ha pogut purgar');
        }
    };

    const handleEmptyAll = async () => {
        try {
            await Promise.allSettled(items.map(it => axios.delete(`/api/vault/trash/${it.id}`)));
            toast.success(`Paperera buidada (${items.length} elements)`);
            setConfirmEmptyAll(false);
            await fetchTrash();
            onAfterChange?.();
        } catch (err) {
            console.error('Error buidant:', err);
            toast.error('Error buidant la paperera');
        }
    };

    return (
        <div className="w-full h-full overflow-y-auto bg-[var(--bg-secondary)] flex flex-col">
            <div className="px-6 pt-8 pb-4 max-w-4xl w-full mx-auto">
                <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-3">
                        <Trash2 size={28} className="text-[var(--text-secondary)]" />
                        <h1 className="text-2xl font-bold text-[var(--text-primary)]">Paperera</h1>
                    </div>
                    {items.length > 0 && (
                        <button
                            type="button"
                            onClick={() => setConfirmEmptyAll(true)}
                            className="px-3 py-1.5 text-sm font-medium rounded-md border border-red-500/40 text-red-500 hover:bg-red-500/10"
                        >
                            Buidar paperera
                        </button>
                    )}
                </div>
                <p className="text-sm text-[var(--text-tertiary)] mb-6">
                    Les pàgines eliminades s'esborren automàticament després de {retentionDays} dies.
                </p>

                <div className="relative mb-4">
                    <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-tertiary)]" />
                    <input
                        type="text"
                        placeholder="Cerca a la paperera per títol, id o camí original…"
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className="w-full pl-9 pr-3 py-2 text-sm rounded-md bg-[var(--bg-primary)] border border-[var(--border-primary)] text-[var(--text-primary)] placeholder-[var(--text-tertiary)] focus:outline-none focus:border-[var(--gnosi-primary)]"
                    />
                </div>

                {loading && (
                    <div className="text-center py-12 text-[var(--text-tertiary)]">Carregant…</div>
                )}
                {!loading && filtered.length === 0 && (
                    <div className="flex flex-col items-center justify-center py-16 text-[var(--text-tertiary)]">
                        <Trash2 size={48} className="mb-4 text-[var(--bg-tertiary)]" strokeWidth={1} />
                        <p>{items.length === 0 ? 'La paperera és buida.' : 'Cap resultat per a la cerca.'}</p>
                    </div>
                )}
                {!loading && filtered.length > 0 && (
                    <ul className="flex flex-col gap-2">
                        {filtered.map((it) => {
                            const daysRemaining = it.days_remaining;
                            const urgent = daysRemaining !== null && daysRemaining <= 7;
                            return (
                                <li
                                    key={it.id}
                                    className="bg-[var(--bg-primary)] border border-[var(--border-primary)] rounded-lg px-4 py-3 flex items-center gap-4 hover:border-[var(--gnosi-primary)]/40 transition-colors"
                                >
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-2">
                                            <h3 className="text-base font-medium text-[var(--text-primary)] truncate">
                                                {it.title || 'Sense títol'}
                                            </h3>
                                            {urgent && (
                                                <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-red-500 bg-red-500/10 border border-red-500/20 rounded px-1.5 py-0.5">
                                                    <AlertTriangle size={10} />
                                                    {daysRemaining}d
                                                </span>
                                            )}
                                        </div>
                                        <div className="flex items-center gap-3 mt-1 text-xs text-[var(--text-tertiary)]">
                                            <span className="flex items-center gap-1">
                                                <Clock size={12} />
                                                Eliminat {fmtDate(it.deleted_at)}
                                            </span>
                                            {it.original_path && (
                                                <span className="truncate" title={it.original_path}>
                                                    {it.original_path}
                                                </span>
                                            )}
                                            {it.size_bytes ? <span>{fmtBytes(it.size_bytes)}</span> : null}
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-2 shrink-0">
                                        <button
                                            type="button"
                                            onClick={() => handleRestore(it.id)}
                                            className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold rounded-md bg-[var(--gnosi-primary)] text-white hover:opacity-90"
                                            title="Restaurar"
                                        >
                                            <Undo2 size={12} /> Restaurar
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => handlePurge(it.id, it.title)}
                                            className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold rounded-md border border-red-500/30 text-red-500 hover:bg-red-500/10"
                                            title="Eliminar permanentment"
                                        >
                                            <Trash2 size={12} /> Purgar
                                        </button>
                                    </div>
                                </li>
                            );
                        })}
                    </ul>
                )}
            </div>

            {confirmEmptyAll && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
                    <div className="bg-[var(--bg-primary)] border border-[var(--border-primary)] rounded-lg p-6 max-w-md w-full mx-4">
                        <h2 className="text-lg font-semibold text-[var(--text-primary)] mb-2">Buidar la paperera?</h2>
                        <p className="text-sm text-[var(--text-secondary)] mb-4">
                            S'eliminaran permanentment {items.length} elements. Aquesta acció no es pot desfer.
                        </p>
                        <div className="flex justify-end gap-2">
                            <button
                                type="button"
                                onClick={() => setConfirmEmptyAll(false)}
                                className="px-3 py-1.5 text-sm rounded-md border border-[var(--border-primary)] text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)]"
                            >
                                Cancel·lar
                            </button>
                            <button
                                type="button"
                                onClick={handleEmptyAll}
                                className="px-3 py-1.5 text-sm font-semibold rounded-md bg-red-500 text-white hover:bg-red-600"
                            >
                                Buidar
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

export default VaultTrashView;
