/**
 * MediaInsertDialog.jsx
 *
 * Dialog modal d'inserció de mitjans amb 3 estratègies:
 *   1) Buscar al vault       → obre MediaPicker, retorna URL d'un asset existent.
 *   2) Pujar a Assets        → puja el fitxer a Assets/Inline o Assets/Files.
 *   3) Enllaçar fitxer local → /pick-file natiu macOS + /local-file/register;
 *                              cap còpia, només una referència persistent.
 *
 * Ús (Promise-based, integració amb BlockNote `uploadFile`):
 *   <MediaInsertDialog
 *      open={Boolean(pending)}
 *      initialFile={pending?.file}
 *      tableId={tableId}
 *      onClose={() => pending?.reject?.(new Error('cancelled'))}
 *      onResolve={(url) => pending?.resolve?.(url)}
 *   />
 *
 * El callback `onResolve` rep la URL final que es passa al bloc d'imatge/file
 * de BlockNote. Si el dialog es tanca sense resolució, el caller ha
 * d'invocar reject perquè BlockNote no es quedi penjat esperant la promise.
 */
import React, { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import {
    X, Search, Upload, Link as LinkIcon, FolderOpen, Image as ImageIcon,
    AlertTriangle,
} from 'lucide-react';
import { toast } from '../../lib/toast';
import { MediaPicker } from './MediaPicker';

function normalizeUrl(url) {
    if (!url) return '';
    const m = url.match(/^https?:\/\/[^/]+(\/api\/.*)$/i);
    return m?.[1] || url;
}

const ACTIONS = [
    {
        key: 'browse',
        title: 'Buscar al Vault',
        subtitle: 'Tria un fitxer ja existent (Images, Assets, Biblioteca o tot el Vault). Cap còpia.',
        Icon: Search,
        color: 'text-blue-500',
        bg: 'bg-blue-500/10 hover:bg-blue-500/15',
        ring: 'hover:ring-blue-500/30',
    },
    {
        key: 'upload',
        title: 'Pujar a Assets',
        subtitle: 'Copia el fitxer a la carpeta Assets de la pàgina i en genera una còpia versionada.',
        Icon: Upload,
        color: 'text-emerald-500',
        bg: 'bg-emerald-500/10 hover:bg-emerald-500/15',
        ring: 'hover:ring-emerald-500/30',
    },
    {
        key: 'local',
        title: 'Enllaçar fitxer local',
        subtitle: 'No copia res — només guarda una referència al fitxer del teu disc.',
        Icon: LinkIcon,
        color: 'text-amber-500',
        bg: 'bg-amber-500/10 hover:bg-amber-500/15',
        ring: 'hover:ring-amber-500/30',
    },
];

export function MediaInsertDialog({
    open,
    initialFile = null,
    tableId = '',
    onClose,
    onResolve,
}) {
    // mode: null = panell d'opcions; 'browse' = MediaPicker; 'busy' = pujant.
    const [mode, setMode] = useState(null);
    const [busy, setBusy] = useState(false);

    // Reset en obrir
    useEffect(() => {
        if (open) {
            setMode(null);
            setBusy(false);
        }
    }, [open]);

    const handleCancel = useCallback(() => {
        if (busy) return;
        onClose?.();
    }, [busy, onClose]);

    // Tancament amb Escape
    useEffect(() => {
        if (!open) return;
        const onKey = (e) => {
            if (e.key === 'Escape' && !busy) {
                e.preventDefault();
                handleCancel();
            }
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [open, busy, handleCancel]);

    const finishWith = useCallback((url) => {
        try { onResolve?.(url); } finally { onClose?.(); }
    }, [onResolve, onClose]);

    // --- Acció: Pujar a Assets ---
    const uploadToAssets = useCallback(async (file) => {
        if (!file) {
            toast.error('Cal seleccionar un fitxer');
            return;
        }
        setBusy(true);
        const tid = tableId;
        const url = tid
            ? `/api/vault/assets/upload?table_id=${encodeURIComponent(tid)}`
            : '/api/vault/assets/upload';
        try {
            const fd = new FormData();
            fd.append('file', file);
            const res = await axios.post(url, fd, { timeout: 120000 });
            const finalUrl = res.data?.url;
            if (!finalUrl) throw new Error('Resposta sense URL');
            finishWith(normalizeUrl(finalUrl));
        } catch (err) {
            console.error('Error pujant a Assets:', err);
            toast.error('No s\'ha pogut pujar a Assets');
            setBusy(false);
        }
    }, [tableId, finishWith]);

    const triggerUploadInput = useCallback(() => {
        // Sense fitxer inicial: obrim un input de fitxer.
        const input = document.createElement('input');
        input.type = 'file';
        input.onchange = (e) => {
            const f = e.target.files?.[0];
            if (f) uploadToAssets(f);
        };
        input.click();
    }, [uploadToAssets]);

    // --- Acció: Enllaçar fitxer local ---
    const linkLocalFile = useCallback(async () => {
        setBusy(true);
        try {
            // 1) Picker natiu macOS
            const pickRes = await axios.post('/api/vault/pick-file', {}, { timeout: 600000 });
            const filePath = pickRes.data?.path;
            if (!filePath) {
                setBusy(false);
                return; // usuari ha cancel·lat
            }
            // 2) Registrar token + URL servible
            const regRes = await axios.post('/api/vault/local-file/register',
                { file_path: filePath },
                { timeout: 30000 },
            );
            const finalUrl = regRes.data?.url;
            if (!finalUrl) throw new Error('Registre sense URL');
            finishWith(normalizeUrl(finalUrl));
        } catch (err) {
            // Cancel·lació: 204/cap path → silenciós; la resta → toast
            if (err?.response?.status === 204) {
                setBusy(false);
                return;
            }
            console.error('Error enllaçant fitxer local:', err);
            toast.error('No s\'ha pogut enllaçar el fitxer local');
            setBusy(false);
        }
    }, [finishWith]);

    // --- Acció: Buscar al vault ---
    const handlePickFromVault = useCallback((item) => {
        if (!item?.url) {
            toast.error('El fitxer no té URL servible');
            return;
        }
        finishWith(normalizeUrl(item.url));
    }, [finishWith]);

    if (!open) return null;

    return (
        <div
            className="fixed inset-0 z-[2000] flex items-center justify-center bg-black/50 backdrop-blur-sm"
            onClick={(e) => { if (e.target === e.currentTarget) handleCancel(); }}
        >
            <div
                className={`bg-[var(--bg-primary)] rounded-2xl shadow-2xl flex flex-col overflow-hidden border border-[var(--border-primary)] ${
                    mode === 'browse' ? 'w-[min(1100px,95vw)] h-[min(700px,90vh)]' : 'w-[min(640px,92vw)] max-h-[90vh]'
                }`}
            >
                <div className="flex items-center justify-between p-4 border-b border-[var(--border-primary)]">
                    <div className="flex items-center gap-3">
                        <div className="p-2 bg-[var(--gnosi-primary)]/10 rounded-lg text-[var(--gnosi-primary)]">
                            <ImageIcon size={18} />
                        </div>
                        <div>
                            <h3 className="text-sm font-bold text-[var(--text-primary)]">
                                {mode === 'browse' ? 'Buscar mitjà al Vault' : 'Inserir mitjà'}
                            </h3>
                            {initialFile && mode !== 'browse' && (
                                <p className="text-[11px] text-[var(--text-tertiary)]">
                                    Fitxer seleccionat: <span className="font-medium">{initialFile.name}</span>
                                </p>
                            )}
                        </div>
                    </div>
                    <button
                        type="button"
                        onClick={handleCancel}
                        disabled={busy}
                        className="p-1.5 rounded-md hover:bg-[var(--bg-secondary)] text-[var(--text-tertiary)] disabled:opacity-50"
                    >
                        <X size={16} />
                    </button>
                </div>

                {mode === 'browse' ? (
                    <div className="flex-1 min-h-0 p-3">
                        <MediaPicker
                            onSelect={handlePickFromVault}
                            onCancel={() => setMode(null)}
                        />
                    </div>
                ) : (
                    <div className="p-5 flex flex-col gap-3">
                        {ACTIONS.map(({ key, title, subtitle, Icon, color, bg, ring }) => {
                            const onClick = () => {
                                if (busy) return;
                                if (key === 'browse') setMode('browse');
                                else if (key === 'upload') {
                                    if (initialFile) uploadToAssets(initialFile);
                                    else triggerUploadInput();
                                }
                                else if (key === 'local') linkLocalFile();
                            };
                            return (
                                <button
                                    key={key}
                                    type="button"
                                    onClick={onClick}
                                    disabled={busy}
                                    className={`text-left flex items-start gap-4 p-4 rounded-xl border border-[var(--border-primary)] transition-all ${bg} hover:ring-2 ${ring} disabled:opacity-50 disabled:cursor-not-allowed`}
                                >
                                    <div className={`p-2.5 rounded-lg bg-[var(--bg-primary)] ${color} shadow-sm`}>
                                        <Icon size={20} />
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <p className="text-sm font-semibold text-[var(--text-primary)]">
                                            {title}
                                            {key === 'upload' && initialFile && (
                                                <span className="ml-2 text-[11px] text-[var(--text-tertiary)] font-normal">
                                                    ({initialFile.name})
                                                </span>
                                            )}
                                        </p>
                                        <p className="text-xs text-[var(--text-secondary)] mt-1 leading-relaxed">
                                            {subtitle}
                                        </p>
                                        {key === 'local' && (
                                            <p className="text-[11px] text-amber-600 mt-2 flex items-center gap-1">
                                                <AlertTriangle size={11} />
                                                Si mous o esborres el fitxer, l'enllaç es trencarà.
                                            </p>
                                        )}
                                    </div>
                                </button>
                            );
                        })}

                        {busy && (
                            <div className="flex items-center justify-center gap-2 mt-2 text-xs text-[var(--text-tertiary)]">
                                <ImageIcon size={14} className="animate-pulse" />
                                Treballant…
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}

export default MediaInsertDialog;
