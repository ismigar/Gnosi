import React, { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import { KeyRound, Plus, Trash2, Copy, Check } from 'lucide-react';

/**
 * ApiTokensSettings
 * Gestió de Personal Access Tokens (PAT) per a l'API pública de Gnosi i el web
 * clipper. Crear (mostra el token un sol cop), llistar i revocar.
 */
export default function ApiTokensSettings() {
    const [tokens, setTokens] = useState([]);
    const [loading, setLoading] = useState(true);
    const [name, setName] = useState('');
    const [creating, setCreating] = useState(false);
    const [justCreated, setJustCreated] = useState(null); // {token}
    const [copied, setCopied] = useState(false);

    const load = useCallback(async () => {
        setLoading(true);
        try { const res = await axios.get('/api/tokens'); setTokens(res.data || []); }
        catch { setTokens([]); }
        finally { setLoading(false); }
    }, []);

    useEffect(() => { load(); }, [load]);

    const create = async () => {
        if (!name.trim()) return;
        setCreating(true);
        try {
            const res = await axios.post('/api/tokens', { name: name.trim() });
            setJustCreated(res.data);
            setName('');
            load();
        } catch { /* noop */ } finally { setCreating(false); }
    };

    const revoke = async (id) => {
        try { await axios.delete(`/api/tokens/${id}`); load(); } catch { /* noop */ }
    };

    const copy = async () => {
        try { await navigator.clipboard.writeText(justCreated.token); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* noop */ }
    };

    return (
        <div className="max-w-2xl">
            <div className="mb-4 flex items-center gap-2">
                <KeyRound size={18} className="text-[var(--gnosi-primary)]" />
                <h2 className="text-lg font-semibold text-[var(--text-primary)]">API i tokens</h2>
            </div>
            <p className="mb-4 text-sm text-[var(--text-secondary)]">
                Crea tokens d'accés personal (PAT) per a l'API pública (<code>/api/public/*</code>) i el web clipper.
                El token es mostra <strong>una sola vegada</strong>.
            </p>

            {/* Crear */}
            <div className="mb-4 flex gap-2">
                <input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') create(); }}
                    placeholder="Nom del token (p. ex. Web clipper)"
                    className="flex-1 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-primary)] px-3 py-2 text-sm text-[var(--text-primary)] outline-none focus:ring-1 focus:ring-[var(--gnosi-primary)]"
                />
                <button onClick={create} disabled={creating || !name.trim()} className="flex items-center gap-1.5 rounded-lg bg-[var(--gnosi-primary)] px-3 py-2 text-sm font-medium text-white disabled:opacity-50">
                    <Plus size={15} /> Crea
                </button>
            </div>

            {/* Token recent creat */}
            {justCreated && (
                <div className="mb-4 rounded-lg border border-[var(--gnosi-primary)]/40 bg-[var(--gnosi-primary)]/8 p-3">
                    <div className="mb-1 text-xs font-semibold text-[var(--gnosi-primary)]">Copia ara el token «{justCreated.name}» — no es tornarà a mostrar:</div>
                    <div className="flex items-center gap-2">
                        <code className="flex-1 truncate rounded bg-[var(--bg-primary)] px-2 py-1.5 text-xs text-[var(--text-primary)]">{justCreated.token}</code>
                        <button onClick={copy} className="flex items-center gap-1 rounded px-2 py-1.5 text-xs text-[var(--gnosi-primary)] hover:bg-[var(--gnosi-primary)]/10">
                            {copied ? <><Check size={14} /> Copiat</> : <><Copy size={14} /> Copia</>}
                        </button>
                    </div>
                </div>
            )}

            {/* Llista */}
            {loading ? (
                <div className="py-6 text-center text-sm text-[var(--text-tertiary)]">Carregant…</div>
            ) : tokens.length === 0 ? (
                <div className="rounded-lg border border-dashed border-[var(--border-primary)] py-8 text-center text-sm text-[var(--text-tertiary)]">Cap token actiu.</div>
            ) : (
                <ul className="space-y-2">
                    {tokens.map((tk) => (
                        <li key={tk.id} className="flex items-center justify-between rounded-lg border border-[var(--border-primary)] bg-[var(--bg-primary)] px-3 py-2">
                            <div className="min-w-0">
                                <div className="truncate text-sm font-medium text-[var(--text-primary)]">{tk.name}</div>
                                <div className="text-xs text-[var(--text-tertiary)]">
                                    {tk.prefix}…  ·  {tk.last_used_at ? `usat ${new Date(tk.last_used_at).toLocaleDateString('ca-ES')}` : 'mai usat'}
                                </div>
                            </div>
                            <button onClick={() => revoke(tk.id)} title="Revoca" className="rounded p-1.5 text-[var(--text-tertiary)] hover:bg-[var(--bg-secondary)] hover:text-[var(--gnosi-danger,#dc2626)]">
                                <Trash2 size={15} />
                            </button>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}
