import { useState, useRef, useCallback } from 'react';
import { Users } from 'lucide-react';
import { useApi } from '../../hooks/use-api';

export function AddressInput({ value, onChange, label, placeholder, accountEmail }) {
    const [suggestions, setSuggestions] = useState([]);
    const [groupSuggestions, setGroupSuggestions] = useState([]);
    const [showDropdown, setShowDropdown] = useState(false);
    const debounceRef = useRef(null);
    const { apiFetch } = useApi();

    const fetchSuggestions = useCallback(async (token) => {
        try {
            const params = new URLSearchParams({ q: token, limit: 8 });
            if (accountEmail) params.set('email', accountEmail);
            const data = await apiFetch(`/api/mail/recipients/suggest?${params}`);
            setSuggestions(data.suggestions || []);
            setGroupSuggestions(data.group_suggestions || []);
            setShowDropdown((data.suggestions?.length || 0) + (data.group_suggestions?.length || 0) > 0);
        } catch { /* silent */ }
    }, [accountEmail, apiFetch]);

    const handleChange = (e) => {
        // Normalitza el separador d'Outlook (";" → ",") perquè uns destinataris
        // enganxats com "a@x.com; b@y.com" es parteixin bé. RFC 5322 i tots dos
        // backends (Gmail posa el header "To" cru = llista per coma; Microsoft
        // fa `split(",")`) separen per COMA; un ";" feia que tot el text fos un
        // únic destinatari malformat i el correu només arribava al primer (o cap).
        // Cap adreça d'email conté ";", així que la substitució és segura.
        const raw = e.target.value.replace(/;/g, ',');
        onChange(raw);
        const token = raw.split(',').pop().trim();
        clearTimeout(debounceRef.current);
        if (token.length < 2) { setSuggestions([]); setGroupSuggestions([]); setShowDropdown(false); return; }
        debounceRef.current = setTimeout(() => fetchSuggestions(token), 280);
    };

    const handleSelect = (email) => {
        const parts = value.split(',');
        parts[parts.length - 1] = email;
        onChange(parts.map(p => p.trim()).filter(Boolean).join(', ') + ', ');
        setSuggestions([]);
        setGroupSuggestions([]);
        setShowDropdown(false);
    };

    const handleSelectGroup = (emails) => {
        const existing = value.split(',').map(p => p.trim()).filter(Boolean);
        const merged = [...new Set([...existing, ...emails])];
        onChange(merged.join(', ') + ', ');
        setSuggestions([]);
        setGroupSuggestions([]);
        setShowDropdown(false);
    };

    const SuggestionItem = ({ item }) => (
        <button
            onMouseDown={() => handleSelect(item.email)}
            className="w-full text-left px-4 py-2 hover:bg-[var(--bg-secondary)] flex items-center gap-3 transition-colors"
        >
            <div className="w-7 h-7 rounded-lg bg-[var(--sidebar-item-active)] text-[var(--gnosi-blue)] flex items-center justify-center text-[11px] font-bold uppercase shrink-0">
                {(item.name || item.email)[0]}
            </div>
            <div className="flex flex-col min-w-0">
                {item.name && <span className="text-[13px] font-semibold text-[var(--text-primary)] truncate">{item.name}</span>}
                <span className="text-[12px] text-[var(--text-secondary)] truncate">{item.email}</span>
            </div>
            {item.freq > 0 && (
                <span className="ml-auto text-[10px] text-[var(--text-secondary)] shrink-0">{item.freq}×</span>
            )}
        </button>
    );

    return (
        <div className="relative flex items-center border-b border-[var(--border-primary)] py-2">
            <span className="text-[13px] font-bold text-[var(--text-secondary)] uppercase w-20 shrink-0">{label}:</span>
            <input
                type="text"
                className="flex-1 bg-transparent border-none text-[15px] text-[var(--text-primary)] focus:ring-0 placeholder:text-[var(--text-secondary)] font-medium outline-none"
                placeholder={placeholder}
                value={value}
                onChange={handleChange}
                onKeyDown={(e) => { if (e.key === 'Enter') e.preventDefault(); }}
                onFocus={() => { if (suggestions.length > 0 || groupSuggestions.length > 0) setShowDropdown(true); }}
                onBlur={() => setTimeout(() => setShowDropdown(false), 150)}
            />
            {showDropdown && (
                <div className="absolute left-20 top-full mt-1 z-[var(--z-modal-dropdown)] bg-[var(--bg-primary)] border border-[var(--border-primary)] rounded-xl shadow-xl py-1 w-80 max-h-64 overflow-y-auto">
                    {suggestions.length > 0 && (
                        <>
                            <div className="px-3 py-1 text-[11px] font-bold text-[var(--text-secondary)] uppercase tracking-wider">
                                Contactes
                            </div>
                            {suggestions.map((s, i) => <SuggestionItem key={i} item={s} />)}
                        </>
                    )}
                    {groupSuggestions.length > 0 && (
                        <>
                            <div className="border-t border-[var(--border-primary)] mt-1 pt-1 px-3 py-1 text-[11px] font-bold text-[var(--text-secondary)] uppercase tracking-wider flex items-center gap-1">
                                <Users size={10} /> Grup habitual
                            </div>
                            <button
                                onMouseDown={() => handleSelectGroup(groupSuggestions.map(g => g.email))}
                                className="w-full text-left px-4 py-2 hover:bg-[var(--bg-secondary)] transition-colors"
                            >
                                <span className="text-[12px] text-[var(--gnosi-blue)] font-medium">
                                    + Afegir tots: {groupSuggestions.map(g => g.email).join(', ')}
                                </span>
                            </button>
                            {groupSuggestions.map((s, i) => <SuggestionItem key={i} item={s} />)}
                        </>
                    )}
                </div>
            )}
        </div>
    );
}
