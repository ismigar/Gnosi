import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
} from 'react';
import { Users } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import {
  fetchMailRecipientSuggestions,
  type MailSuggestions,
} from '../../shared/api/mail';


type RecipientSuggestion = MailSuggestions['suggestions'][number];


export interface AddressInputProps {
  readonly accountEmail?: string;
  readonly label: string;
  readonly onChange: (value: string) => void;
  readonly placeholder?: string;
  readonly value: string;
}


interface SuggestionItemProps {
  readonly item: RecipientSuggestion;
  readonly onSelect: (email: string) => void;
}


function SuggestionItem({ item, onSelect }: SuggestionItemProps) {
  return (
    <button
      className="w-full text-left px-4 py-2 hover:bg-[var(--bg-secondary)] flex items-center gap-3 transition-colors"
      onMouseDown={() => {
        onSelect(item.email);
      }}
    >
      <div className="w-7 h-7 rounded-lg bg-[var(--sidebar-item-active)] text-[var(--gnosi-blue)] flex items-center justify-center text-[11px] font-bold uppercase shrink-0">
        {(item.name || item.email).at(0) ?? ''}
      </div>
      <div className="flex flex-col min-w-0">
        {item.name && (
          <span className="text-[13px] font-semibold text-[var(--text-primary)] truncate">
            {item.name}
          </span>
        )}
        <span className="text-[12px] text-[var(--text-secondary)] truncate">
          {item.email}
        </span>
      </div>
      {item.freq > 0 && (
        <span className="ml-auto text-[10px] text-[var(--text-secondary)] shrink-0">
          {item.freq}×
        </span>
      )}
    </button>
  );
}


function lastAddressToken(value: string): string {
  return value.split(',').at(-1)?.trim() ?? '';
}


export function AddressInput({
  accountEmail,
  label,
  onChange,
  placeholder,
  value,
}: AddressInputProps) {
  const { t } = useTranslation();
  const [suggestions, setSuggestions] = useState<RecipientSuggestion[]>([]);
  const [groupSuggestions, setGroupSuggestions] = useState<
    RecipientSuggestion[]
  >([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchSuggestions = useCallback(async (token: string): Promise<void> => {
    try {
      const data = await fetchMailRecipientSuggestions(
        token,
        accountEmail || undefined,
      );
      setSuggestions(data.suggestions);
      setGroupSuggestions(data.group_suggestions);
      setShowDropdown(
        data.suggestions.length + data.group_suggestions.length > 0,
      );
    } catch {
      // Suggestions are optional; typing remains available while offline.
    }
  }, [accountEmail]);

  useEffect(() => () => {
    if (debounceRef.current !== null) clearTimeout(debounceRef.current);
  }, []);

  const handleChange = (event: ChangeEvent<HTMLInputElement>): void => {
    const raw = event.target.value.replace(/;/g, ',');
    onChange(raw);
    const token = lastAddressToken(raw);
    if (debounceRef.current !== null) clearTimeout(debounceRef.current);
    if (token.length < 2) {
      setSuggestions([]);
      setGroupSuggestions([]);
      setShowDropdown(false);
      return;
    }
    debounceRef.current = setTimeout(() => {
      void fetchSuggestions(token);
    }, 280);
  };

  const closeSuggestions = (): void => {
    setSuggestions([]);
    setGroupSuggestions([]);
    setShowDropdown(false);
  };

  const handleSelect = (email: string): void => {
    const parts = value.split(',');
    parts[parts.length - 1] = email;
    onChange(`${parts.map((part) => part.trim()).filter(Boolean).join(', ')}, `);
    closeSuggestions();
  };

  const handleSelectGroup = (emails: readonly string[]): void => {
    const existing = value.split(',').map((part) => part.trim()).filter(Boolean);
    const merged = [...new Set([...existing, ...emails])];
    onChange(`${merged.join(', ')}, `);
    closeSuggestions();
  };

  return (
    <div className="relative flex items-center border-b border-[var(--border-primary)] py-2">
      <span className="text-[13px] font-bold text-[var(--text-secondary)] uppercase w-20 shrink-0">
        {label}:
      </span>
      <input
        className="flex-1 bg-transparent border-none text-[15px] text-[var(--text-primary)] focus:ring-0 placeholder:text-[var(--text-secondary)] font-medium outline-none"
        onBlur={() => {
          setTimeout(() => {
            setShowDropdown(false);
          }, 150);
        }}
        onChange={handleChange}
        onFocus={() => {
          if (suggestions.length > 0 || groupSuggestions.length > 0) {
            setShowDropdown(true);
          }
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.preventDefault();
        }}
        placeholder={placeholder}
        type="text"
        value={value}
      />
      {showDropdown && (
        <div className="absolute left-20 top-full mt-1 z-[var(--z-modal-dropdown)] bg-[var(--bg-primary)] border border-[var(--border-primary)] rounded-xl shadow-xl py-1 w-80 max-h-64 overflow-y-auto">
          {suggestions.length > 0 && (
            <>
              <div className="px-3 py-1 text-[11px] font-bold text-[var(--text-secondary)] uppercase tracking-wider">
                {t('contacts.title', 'Contacts')}
              </div>
              {suggestions.map((suggestion, index) => (
                <SuggestionItem
                  item={suggestion}
                  key={`${suggestion.email}-${String(index)}`}
                  onSelect={handleSelect}
                />
              ))}
            </>
          )}
          {groupSuggestions.length > 0 && (
            <>
              <div className="border-t border-[var(--border-primary)] mt-1 pt-1 px-3 py-1 text-[11px] font-bold text-[var(--text-secondary)] uppercase tracking-wider flex items-center gap-1">
                <Users size={10} /> {t('mail.usual_group', 'Usual group')}
              </div>
              <button
                className="w-full text-left px-4 py-2 hover:bg-[var(--bg-secondary)] transition-colors"
                onMouseDown={() => {
                  handleSelectGroup(groupSuggestions.map(({ email }) => email));
                }}
              >
                <span className="text-[12px] text-[var(--gnosi-blue)] font-medium">
                  + {t('mail.add_all_group', 'Add all: {{emails}}', {
                    emails: groupSuggestions.map(({ email }) => email).join(', '),
                  })}
                </span>
              </button>
              {groupSuggestions.map((suggestion, index) => (
                <SuggestionItem
                  item={suggestion}
                  key={`${suggestion.email}-${String(index)}`}
                  onSelect={handleSelect}
                />
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}
