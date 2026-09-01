import {
    useCallback,
    useEffect,
    useRef,
    useState,
    type InputHTMLAttributes,
    type KeyboardEvent,
} from 'react';
import { ArrowDown, ArrowUp, Plus, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import {
    authorFullName,
    authorSortLabel,
    emptyAuthor,
    sameAuthor,
    type Author,
    type AuthorLike,
} from './autoriaUtils';
import {
    eventTargetIsWithin,
    subscribeDocumentEvent,
} from '../../../shared/platform/browser-events';


interface AutoriaDisplayProps {
    readonly emptyText?: string;
    readonly value?: unknown;
}


interface AutoriaEditorProps {
    readonly onSave: (authors: readonly Author[]) => void;
    readonly suggestions?: readonly AuthorLike[];
    readonly value?: unknown;
}


type AuthorField = keyof Author;


function normalizeAuthors(value: unknown): Author[] {
    if (!Array.isArray(value)) return [];
    return value.map((candidate: unknown) => {
        const author = candidate !== null && typeof candidate === 'object'
            ? candidate as Readonly<Record<string, unknown>>
            : {};
        return {
            nom: typeof author.nom === 'string' ? author.nom : '',
            cognom1: typeof author.cognom1 === 'string' ? author.cognom1 : '',
            cognom2: typeof author.cognom2 === 'string' ? author.cognom2 : '',
        };
    });
}


function nonEmptyAuthors(authors: readonly Author[]): Author[] {
    return authors.filter((author) => author.nom || author.cognom1 || author.cognom2);
}


export function AutoriaDisplay({ value, emptyText = '-' }: AutoriaDisplayProps) {
    const authors = normalizeAuthors(value);
    if (authors.length === 0) {
        return <span className="text-[var(--text-tertiary)]">{emptyText}</span>;
    }
    return (
        <div className="custom-scrollbar flex max-h-24 flex-wrap gap-1 overflow-y-auto py-0.5 pr-1">
            {authors.map((author, index) => (
                <span
                    className="whitespace-nowrap rounded border border-[var(--gnosi-primary)]/20 bg-[var(--gnosi-primary)]/10 px-1.5 py-0.5 text-[11px] font-medium text-[var(--gnosi-primary)]"
                    key={`${authorSortLabel(author)}-${String(index)}`}
                    title={authorSortLabel(author)}
                >{authorFullName(author) || '—'}</span>
            ))}
        </div>
    );
}


export function AutoriaEditor({
    value = [],
    suggestions = [],
    onSave,
}: AutoriaEditorProps) {
    const { t } = useTranslation();
    const [authors, setAuthors] = useState<Author[]>(() => normalizeAuthors(value));
    const authorsRef = useRef(authors);
    const [focusedIndex, setFocusedIndex] = useState<number | null>(null);
    const [highlightedIndex, setHighlightedIndex] = useState(-1);
    const containerRef = useRef<HTMLDivElement>(null);
    const hadInitial = useRef(nonEmptyAuthors(normalizeAuthors(value)).length > 0);
    const lastSaved = useRef(JSON.stringify(nonEmptyAuthors(normalizeAuthors(value))));

    useEffect(() => {
        authorsRef.current = authors;
    }, [authors]);

    const commit = useCallback((nextAuthors: readonly Author[]): void => {
        const cleaned = nonEmptyAuthors(nextAuthors);
        if (cleaned.length === 0 && !hadInitial.current) return;
        const serialized = JSON.stringify(cleaned);
        if (serialized === lastSaved.current) return;
        lastSaved.current = serialized;
        onSave(cleaned);
    }, [onSave]);

    useEffect(() => subscribeDocumentEvent('mousedown', (event) => {
        const container = containerRef.current;
        if (container && !eventTargetIsWithin(container, event.target)) {
            commit(authorsRef.current);
        }
    }), [commit]);

    const update = (index: number, key: AuthorField, valuePart: string): void => {
        setAuthors((current) => current.map((author, position) => (
            position === index ? { ...author, [key]: valuePart } : author
        )));
    };
    const removeAt = (index: number): void => {
        setAuthors((current) => current.filter((_author, position) => position !== index));
    };
    const move = (index: number, direction: -1 | 1): void => {
        setAuthors((current) => {
            const targetIndex = index + direction;
            const author = current[index];
            const target = current[targetIndex];
            if (!author || !target) return current;
            const next = [...current];
            next[index] = target;
            next[targetIndex] = author;
            return next;
        });
    };
    const matchesFor = useCallback((index: number): readonly AuthorLike[] => {
        const current = authors[index];
        if (!current) return [];
        const query = authorFullName(current).trim().toLowerCase();
        if (!query) return [];
        return suggestions.filter((suggestion) => {
            if (!authorFullName(suggestion).toLowerCase().includes(query)) return false;
            if (authors.some((author) => sameAuthor(author, suggestion))) return false;
            if (current.nom && !suggestion.nom) return false;
            if (current.cognom1 && !suggestion.cognom1) return false;
            if (current.cognom2 && !suggestion.cognom2) return false;
            return true;
        }).slice(0, 6);
    }, [authors, suggestions]);
    const pick = (index: number, suggestion: AuthorLike): void => {
        setAuthors((current) => current.map((author, position) => position === index ? {
            nom: suggestion.nom ?? '',
            cognom1: suggestion.cognom1 ?? '',
            cognom2: suggestion.cognom2 ?? '',
        } : author));
        setFocusedIndex(null);
    };
    const handleKeyNavigation = (index: number, event: KeyboardEvent<HTMLInputElement>): void => {
        const matches = matchesFor(index);
        if (matches.length === 0) return;
        if (event.key === 'ArrowDown') {
            event.preventDefault();
            setHighlightedIndex((current) => Math.min(current + 1, matches.length - 1));
        } else if (event.key === 'ArrowUp') {
            event.preventDefault();
            setHighlightedIndex((current) => Math.max(current - 1, -1));
        } else if (event.key === 'Enter') {
            event.preventDefault();
            const match = highlightedIndex >= 0
                ? matches[Math.min(highlightedIndex, matches.length - 1)]
                : undefined;
            if (match) pick(index, match);
            else setFocusedIndex(null);
        } else if (event.key === 'Escape') {
            event.preventDefault();
            setFocusedIndex(null);
        }
    };
    const fieldHandlers = (
        index: number,
        key: AuthorField,
    ): InputHTMLAttributes<HTMLInputElement> => ({
        value: authors[index]?.[key] ?? '',
        onChange: (event) => {
            update(index, key, event.target.value);
            setFocusedIndex(index);
            setHighlightedIndex(-1);
        },
        onFocus: () => {
            setFocusedIndex(index);
            setHighlightedIndex(-1);
        },
        onBlur: () => {
            setFocusedIndex(null);
        },
        onKeyDown: (event) => {
            handleKeyNavigation(index, event);
        },
    });
    const inputClass = 'min-w-[56px] flex-1 rounded border border-[var(--border-primary)] bg-[var(--bg-primary)] px-1.5 py-0.5 text-xs text-[var(--text-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--gnosi-primary)]';

    return (
        <div
            className="w-full min-w-[280px] py-1"
            onClick={(event) => {
                event.stopPropagation();
            }}
            ref={containerRef}
        >
            <div className="mb-1 flex flex-col gap-1">
                {authors.map((author, index) => {
                    const matches = focusedIndex === index ? matchesFor(index) : [];
                    return (
                        <div key={`${authorSortLabel(author)}-${String(index)}`}>
                            <div className="flex items-center gap-1">
                                <div className="flex shrink-0 flex-col -space-y-1 text-[var(--text-tertiary)]">
                                    <ArrowUp
                                        className={`cursor-pointer hover:text-[var(--gnosi-primary)] ${index === 0 ? 'pointer-events-none opacity-20' : ''}`}
                                        onMouseDown={(event) => {
                                            event.preventDefault();
                                            move(index, -1);
                                        }}
                                        size={11}
                                    />
                                    <ArrowDown
                                        className={`cursor-pointer hover:text-[var(--gnosi-primary)] ${index === authors.length - 1 ? 'pointer-events-none opacity-20' : ''}`}
                                        onMouseDown={(event) => {
                                            event.preventDefault();
                                            move(index, 1);
                                        }}
                                        size={11}
                                    />
                                </div>
                                <input className={inputClass} placeholder={t('autoria.first_name', 'First name')} {...fieldHandlers(index, 'nom')} />
                                <input className={inputClass} placeholder={t('autoria.surname1', 'Surname 1')} {...fieldHandlers(index, 'cognom1')} />
                                <input className={inputClass} placeholder={t('autoria.surname2', 'Surname 2')} {...fieldHandlers(index, 'cognom2')} />
                                <span
                                    className="flex shrink-0 cursor-pointer items-center text-[var(--text-tertiary)] hover:text-red-500"
                                    onMouseDown={(event) => {
                                        event.preventDefault();
                                        removeAt(index);
                                    }}
                                    title={t('common.delete', 'Delete')}
                                ><X size={12} /></span>
                            </div>
                            {matches.length > 0 ? (
                                <div className="custom-scrollbar ml-9 mt-0.5 max-h-28 overflow-y-auto rounded border border-[var(--border-primary)] bg-[var(--bg-primary)] shadow-md">
                                    {matches.map((suggestion, suggestionIndex) => (
                                        <div
                                            className={`cursor-pointer px-2 py-1 text-xs ${highlightedIndex >= 0 && suggestionIndex === highlightedIndex ? 'bg-[var(--gnosi-primary)]/10 text-[var(--gnosi-primary)]' : 'text-[var(--text-secondary)]'}`}
                                            key={`${authorSortLabel(suggestion)}-${String(suggestionIndex)}`}
                                            onMouseDown={(event) => {
                                                event.preventDefault();
                                                pick(index, suggestion);
                                            }}
                                            onMouseEnter={() => {
                                                setHighlightedIndex(suggestionIndex);
                                            }}
                                        >{authorSortLabel(suggestion)}</div>
                                    ))}
                                </div>
                            ) : null}
                        </div>
                    );
                })}
            </div>
            <button
                className="flex items-center gap-1 text-[11px] font-medium text-[var(--gnosi-primary)] hover:underline"
                onMouseDown={(event) => {
                    event.preventDefault();
                    setAuthors((current) => [...current, emptyAuthor()]);
                }}
                type="button"
            ><Plus size={11} /> {t('autoria.add_author', 'Add author')}</button>
        </div>
    );
}
