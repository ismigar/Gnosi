import { useEffect, useRef, useState } from 'react';
import { Search, Settings, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';

interface HeaderSearchActionsProps {
    readonly onEditSchema?: ((section: string) => unknown) | null;
    readonly searchTerm: string;
    readonly setSearchTerm: (value: string) => unknown;
}

export function HeaderSearchActions({
    onEditSchema,
    searchTerm,
    setSearchTerm,
}: HeaderSearchActionsProps) {
    const { t } = useTranslation();
    const [showSearch, setShowSearch] = useState(false);
    const searchRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        if (showSearch) searchRef.current?.focus();
    }, [showSearch]);

    return (
        <>
            <div className="flex items-center">
                {showSearch ? (
                    <div className="flex items-center gap-1 bg-[var(--bg-primary)] border border-[var(--gnosi-primary)]/40 rounded-md px-2 py-1 shadow-sm animate-in slide-in-from-right-4 duration-200">
                        <Search size={14} className="text-[var(--gnosi-primary)]" />
                        <input
                            ref={searchRef}
                            type="text"
                            value={searchTerm}
                            onChange={(event) => {
                                setSearchTerm(event.target.value);
                            }}
                            onBlur={(event) => {
                                if (!event.currentTarget.value) setShowSearch(false);
                            }}
                            placeholder={t('views_header.search_placeholder')}
                            className="text-xs outline-none w-32 md:w-48 text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] bg-transparent"
                        />
                        <button
                            onClick={() => {
                                setSearchTerm('');
                                setShowSearch(false);
                            }}
                            className="text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]"
                        >
                            <X size={14} />
                        </button>
                    </div>
                ) : (
                    <button
                        onClick={() => {
                            setShowSearch(true);
                        }}
                        className="p-1.5 rounded-md text-[var(--text-tertiary)] hover:text-[var(--gnosi-primary)] hover:bg-[var(--bg-tertiary)] transition-colors"
                        title={t('views_header.search_title')}
                    >
                        <Search size={18} />
                    </button>
                )}
            </div>
            <button
                onClick={() => {
                    onEditSchema?.('schema');
                }}
                className="btn-gnosi !text-xs !py-1.5 !px-3"
            >
                <Settings size={14} />
                <span className="hidden md:inline">{t('views_header.fields')}</span>
            </button>
        </>
    );
}
