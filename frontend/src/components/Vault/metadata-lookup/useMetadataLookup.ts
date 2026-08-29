import {
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState,
    type ChangeEvent,
    type KeyboardEvent,
} from 'react';
import { useTranslation } from 'react-i18next';

import { logError } from '../../../lib/notifyError';
import { toast } from '../../../lib/toast';
import {
    lookupMetadata,
    recognizePdf,
    translateUrl,
    type MetadataLookupInput,
} from '../../../shared/api/resource-lookup';
import { validateIdentifier } from '../identifierValidators';
import {
    groupMetadataEntries,
    initialFieldSelection,
    metadataScalarText,
    normalizeLookupResult,
    selectedMetadataPatch,
    type LookupResult,
    type MetadataLookupMode,
    type MetadataRecord,
    type RawLookupResult,
} from './metadataLookupModel';


type IdentifierKind = 'arxiv' | 'doi' | 'isbn' | 'pmid' | 'url';


interface IdentifierState {
    readonly arxiv: string;
    readonly doi: string;
    readonly isbn: string;
    readonly pmid: string;
    readonly url: string;
}


interface UseMetadataLookupOptions {
    readonly currentMetadata: MetadataRecord;
    readonly isOpen: boolean;
    readonly mode: MetadataLookupMode;
    readonly onApply?: (patch: Record<string, unknown>) => void;
    readonly onClose?: () => void;
    readonly onCreate?: (metadata: MetadataRecord) => void;
}


const EMPTY_IDENTIFIERS: IdentifierState = {
    arxiv: '',
    doi: '',
    isbn: '',
    pmid: '',
    url: '',
};


const IDENTIFIER_KEYS: readonly IdentifierKind[] = [
    'arxiv',
    'doi',
    'isbn',
    'pmid',
    'url',
];


export function useMetadataLookup({
    currentMetadata,
    isOpen,
    mode,
    onApply,
    onClose,
    onCreate,
}: UseMetadataLookupOptions) {
    const { t } = useTranslation();
    const [identifiers, setIdentifiers] = useState<IdentifierState>(EMPTY_IDENTIFIERS);
    const [loading, setLoading] = useState(false);
    const [result, setResult] = useState<LookupResult | null>(null);
    const [selectedFields, setSelectedFields] = useState<Record<string, boolean>>({});
    const firstInputRef = useRef<HTMLInputElement>(null);
    const pdfInputRef = useRef<HTMLInputElement>(null);
    const requestRef = useRef<AbortController | null>(null);
    const currentMetadataRef = useRef(currentMetadata);

    useEffect(() => {
        currentMetadataRef.current = currentMetadata;
    }, [currentMetadata]);

    useEffect(() => {
        if (!isOpen) {
            requestRef.current?.abort();
            return;
        }
        const current = currentMetadataRef.current;
        setIdentifiers({
            arxiv: '',
            doi: metadataScalarText(current.DOI).trim(),
            isbn: metadataScalarText(current.ISBN).trim(),
            pmid: metadataScalarText(current.PMID).trim(),
            url: metadataScalarText(current.URL).trim(),
        });
        setResult(null);
        setSelectedFields({});
        const animationId = requestAnimationFrame(() => {
            firstInputRef.current?.focus();
        });
        return () => {
            cancelAnimationFrame(animationId);
        };
    }, [isOpen]);

    useEffect(() => () => {
        requestRef.current?.abort();
    }, []);

    const populate = useCallback((raw: RawLookupResult): void => {
        const normalized = normalizeLookupResult(raw);
        if (mode === 'create') {
            if (normalized.error || Object.keys(normalized.suggested).length === 0) {
                toast.error(normalized.error ?? t('metadata_lookup.no_data', {
                    defaultValue: 'No data found.',
                }));
                return;
            }
            onCreate?.(normalized.suggested);
            onClose?.();
            return;
        }
        setResult(normalized);
        setSelectedFields(initialFieldSelection(
            normalized.suggested,
            currentMetadataRef.current,
        ));
        if (normalized.error) toast.error(normalized.error);
    }, [mode, onClose, onCreate, t]);

    const execute = useCallback(async (
        operation: string,
        fallbackKey: string,
        fallbackMessage: string,
        request: (signal: AbortSignal) => Promise<RawLookupResult>,
    ): Promise<void> => {
        requestRef.current?.abort();
        const controller = new AbortController();
        requestRef.current = controller;
        setLoading(true);
        try {
            populate(await request(controller.signal));
        } catch (error: unknown) {
            if (!controller.signal.aborted) {
                logError(operation, error);
                toast.error(t(fallbackKey, { defaultValue: fallbackMessage }));
            }
        } finally {
            if (requestRef.current === controller) {
                requestRef.current = null;
                setLoading(false);
            }
        }
    }, [populate, t]);

    const handleSearch = useCallback(async (): Promise<void> => {
        const payload: MetadataLookupInput = {
            arxiv: identifiers.arxiv.trim() || undefined,
            doi: identifiers.doi.trim() || undefined,
            isbn: identifiers.isbn.trim() || undefined,
            pmid: identifiers.pmid.trim() || undefined,
            url: identifiers.url.trim() || undefined,
        };
        if (!Object.values(payload).some(Boolean)) {
            toast.error(t('metadata_lookup.no_identifier', {
                defaultValue: 'A DOI, ISBN, arXiv id, PMID or URL is required',
            }));
            return;
        }
        await execute(
            'metadata-lookup-search',
            'metadata_lookup.fetch_failed',
            'Error querying external sources',
            async (signal) => {
                const onlyUrl = Boolean(
                    payload.url
                    && !payload.doi
                    && !payload.isbn
                    && !payload.arxiv
                    && !payload.pmid,
                );
                if (!onlyUrl || !payload.url) return lookupMetadata(payload, signal);
                const translated = await translateUrl({ url: payload.url }, signal);
                return translated.error && Object.keys(translated.suggested).length === 0
                    ? lookupMetadata(payload, signal)
                    : translated;
            },
        );
    }, [execute, identifiers, t]);

    const handlePdfUpload = useCallback((event: ChangeEvent<HTMLInputElement>): void => {
        const file = event.target.files?.[0];
        event.target.value = '';
        if (!file) return;
        void execute(
            'metadata-lookup-pdf',
            'metadata_lookup.pdf_failed',
            'Error recognizing the PDF',
            (signal) => recognizePdf(file, signal),
        );
    }, [execute]);

    const handleApply = useCallback((): void => {
        const patch = selectedMetadataPatch(result?.suggested ?? {}, selectedFields);
        if (Object.keys(patch).length === 0) {
            toast.error(t('metadata_lookup.nothing_selected', {
                defaultValue: 'No field selected',
            }));
            return;
        }
        try {
            onApply?.(patch);
            toast.success(t('metadata_lookup.applied', {
                count: Object.keys(patch).length,
                defaultValue: `${Object.keys(patch).length.toString()} camps actualitzats`,
            }));
            onClose?.();
        } catch (error: unknown) {
            logError('metadata-lookup-apply', error);
            toast.error(t('metadata_lookup.apply_failed', {
                defaultValue: 'Error applying the changes',
            }));
        }
    }, [onApply, onClose, result, selectedFields, t]);

    const handleKeyDown = useCallback((event: KeyboardEvent<HTMLDivElement>): void => {
        if (event.key === 'Enter' && !event.shiftKey && !loading && !result) {
            event.preventDefault();
            void handleSearch();
        }
    }, [handleSearch, loading, result]);

    const validation = useMemo(() => ({
        arxiv: validateIdentifier('arxiv', identifiers.arxiv),
        doi: validateIdentifier('doi', identifiers.doi),
        isbn: validateIdentifier('isbn', identifiers.isbn),
        pmid: validateIdentifier('pmid', identifiers.pmid),
        url: validateIdentifier('url', identifiers.url),
    }), [identifiers]);
    const grouped = useMemo(
        () => groupMetadataEntries(result?.suggested ?? {}),
        [result],
    );
    const hasIdentifier = IDENTIFIER_KEYS.some((key) => identifiers[key].trim());
    const allValid = Object.values(validation).every((item) => item.valid);

    return {
        allValid,
        firstInputRef,
        grouped,
        handleApply,
        handleKeyDown,
        handlePdfUpload,
        handleSearch,
        hasIdentifier,
        identifiers,
        loading,
        pdfInputRef,
        result,
        selectedFields,
        setIdentifier: (kind: IdentifierKind, value: string): void => {
            setIdentifiers((current) => ({ ...current, [kind]: value }));
        },
        setSelectedFields,
        validation,
    };
}
