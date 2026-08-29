import type { RefObject } from 'react';
import { Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import {
    SOURCE_LABELS,
    zoteroTypeLabel,
} from './metadataLookupModel';
import type { useMetadataLookup } from './useMetadataLookup';


type LookupController = ReturnType<typeof useMetadataLookup>;
type IdentifierKind = keyof LookupController['identifiers'];


interface MetadataLookupFormProps {
    readonly controller: LookupController;
    readonly language?: string;
}


function IdentifierInput({
    firstInputRef,
    kind,
    label,
    onChange,
    placeholder,
    validation,
    value,
}: {
    readonly firstInputRef?: RefObject<HTMLInputElement | null>;
    readonly kind: IdentifierKind;
    readonly label: string;
    readonly onChange: (kind: IdentifierKind, value: string) => void;
    readonly placeholder: string;
    readonly validation: { readonly hint: string | null; readonly valid: boolean };
    readonly value: string;
}) {
    const inputClass = `px-2 py-1.5 text-sm rounded-md border bg-[var(--bg-primary)] outline-none transition-colors ${validation.valid
        ? 'border-[var(--border-primary)] focus:border-[var(--gnosi-primary)]'
        : 'border-red-500 focus:border-red-600'}`;
    return (
        <label className="flex flex-col gap-1">
            <span className="text-xs font-semibold text-[var(--text-secondary)]">
                {label}
            </span>
            <input
                aria-invalid={!validation.valid}
                className={inputClass}
                onChange={(event) => {
                    onChange(kind, event.target.value);
                }}
                placeholder={placeholder}
                ref={firstInputRef}
                type="text"
                value={value}
            />
            {!validation.valid ? (
                <span className="text-[10px] text-red-500 mt-0.5">
                    {validation.hint}
                </span>
            ) : null}
        </label>
    );
}


export function MetadataLookupForm({
    controller,
    language,
}: MetadataLookupFormProps) {
    const { t } = useTranslation();
    const {
        allValid,
        firstInputRef,
        grouped,
        handlePdfUpload,
        handleSearch,
        hasIdentifier,
        identifiers,
        loading,
        pdfInputRef,
        result,
        setIdentifier,
        validation,
    } = controller;
    const typeLabel = zoteroTypeLabel(grouped.zoteroType, language);
    return (
        <>
            <div className="px-4 py-3 border-b border-[var(--border-secondary)] grid grid-cols-2 gap-3 shrink-0">
                <IdentifierInput
                    firstInputRef={firstInputRef}
                    kind="doi"
                    label="DOI"
                    onChange={setIdentifier}
                    placeholder="10.xxxx/xxxxx"
                    validation={validation.doi}
                    value={identifiers.doi}
                />
                <IdentifierInput
                    kind="isbn"
                    label="ISBN"
                    onChange={setIdentifier}
                    placeholder="978…"
                    validation={validation.isbn}
                    value={identifiers.isbn}
                />
                <IdentifierInput
                    kind="arxiv"
                    label="arXiv id"
                    onChange={setIdentifier}
                    placeholder="2103.00020"
                    validation={validation.arxiv}
                    value={identifiers.arxiv}
                />
                <IdentifierInput
                    kind="pmid"
                    label="PMID"
                    onChange={setIdentifier}
                    placeholder="29083320"
                    validation={validation.pmid}
                    value={identifiers.pmid}
                />
                <IdentifierInput
                    kind="url"
                    label="URL"
                    onChange={setIdentifier}
                    placeholder="https://…"
                    validation={validation.url}
                    value={identifiers.url}
                />
            </div>
            <div className="flex items-center gap-3 px-4 py-2 border-b border-[var(--border-secondary)] shrink-0">
                <button
                    className="px-3 py-1.5 rounded-md bg-[var(--gnosi-primary)] text-white text-sm font-medium hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                    disabled={loading || !hasIdentifier || !allValid}
                    onClick={() => {
                        void handleSearch();
                    }}
                    title={!hasIdentifier
                        ? t('metadata_lookup.need_identifier', {
                            defaultValue: 'A DOI, ISBN, arXiv id, PMID or URL is required',
                        })
                        : !allValid
                            ? t('metadata_lookup.fix_invalid', {
                                defaultValue: 'Fix the fields in red before searching',
                            })
                            : ''}
                    type="button"
                >
                    {loading ? <Loader2 className="animate-spin" size={14} /> : null}
                    {t('metadata_lookup.search', { defaultValue: 'Search' })}
                </button>
                <input
                    accept="application/pdf,.pdf"
                    className="hidden"
                    onChange={handlePdfUpload}
                    ref={pdfInputRef}
                    type="file"
                />
                <button
                    className="px-3 py-1.5 rounded-md border border-[var(--border-primary)] text-[var(--text-secondary)] text-sm font-medium hover:bg-[var(--bg-hover)] disabled:opacity-50"
                    disabled={loading}
                    onClick={() => {
                        pdfInputRef.current?.click();
                    }}
                    type="button"
                >
                    {t('metadata_lookup.from_pdf', {
                        defaultValue: 'Detect from a PDF',
                    })}
                </button>
                {result?.source ? (
                    <span className="text-xs text-[var(--text-tertiary)]">
                        {t('metadata_lookup.source_label', { defaultValue: 'Source' })}
                        {': '}
                        <strong className="text-[var(--text-secondary)]">
                            {SOURCE_LABELS[result.source] ?? result.source}
                        </strong>
                        {result.identifier ? (
                            <>
                                {' · '}
                                <code className="text-[10px] bg-[var(--bg-secondary)] px-1 rounded">
                                    {result.identifier}
                                </code>
                            </>
                        ) : null}
                        {typeLabel ? (
                            <>
                                {' · '}
                                {t('metadata_lookup.type_label', { defaultValue: 'Type' })}
                                {': '}
                                <strong className="text-[var(--text-secondary)]">
                                    {typeLabel}
                                </strong>
                            </>
                        ) : null}
                    </span>
                ) : null}
            </div>
        </>
    );
}
