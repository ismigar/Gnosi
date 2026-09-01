import { useEffect, useMemo, useRef, useState, type ComponentType } from 'react';
import { FileText, Plus, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import {
  canonicalStorageFolder,
  filenameFromTarget,
  fileTargetKey,
} from '../../../shared/resources/fileResource';
import { InsertContentModal } from '../content/InsertContentModal';

interface FileAttachmentFieldProps {
  readonly fileMode?: string;
  readonly namePattern?: string;
  readonly onChange: (value: string | string[]) => unknown;
  readonly propertyName: string;
  readonly rowMetadata?: Readonly<Record<string, unknown>>;
  readonly storageFolder?: string;
  readonly tableId?: string | null;
  readonly value?: unknown;
}

interface InsertContentResult {
  readonly url?: unknown;
  readonly urls?: readonly unknown[];
}

interface FileFieldConfiguration {
  readonly fileMode: string;
  readonly namePattern: string;
  readonly propertyName: string;
  readonly storageFolder: string;
}

interface FileInsertContentModalProps {
  readonly fileField: FileFieldConfiguration;
  readonly onClose: () => void;
  readonly onInsert: (result: InsertContentResult | null | undefined) => void;
  readonly open: boolean;
  readonly rowMetadata: Readonly<Record<string, unknown>>;
  readonly tableId: string;
}

const FileInsertContentModal = InsertContentModal as unknown as ComponentType<
  FileInsertContentModalProps
>;

const STORAGE_LABELS: Readonly<Record<string, string>> = {
  assets: 'Assets',
  library: 'Library',
};

function normalizedEntries(value: unknown): string[] {
  const values: readonly unknown[] = Array.isArray(value)
    ? value
    : value == null ? [] : [value];
  return values
    .map(stringEntry)
    .filter((entry) => entry.trim() !== '');
}

function emittedValue(entries: readonly unknown[]): string | string[] {
  const clean = entries
    .map(stringEntry)
    .filter((entry) => entry.trim() !== '');
  if (clean.length === 0) return '';
  return clean.length === 1 ? clean[0] ?? '' : clean;
}

function stringEntry(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value === null || value === undefined) return '';
  try {
    return Reflect.apply(String, undefined, [value]);
  } catch {
    return '';
  }
}

export function FileAttachmentField({
  fileMode = 'upload',
  namePattern = '',
  onChange,
  propertyName,
  rowMetadata = {},
  storageFolder = 'assets',
  tableId,
  value,
}: FileAttachmentFieldProps) {
  const { t } = useTranslation();
  const [error, setError] = useState('');
  const [pickerOpen, setPickerOpen] = useState(false);
  const isLink = fileMode === 'link';
  const storage = canonicalStorageFolder(storageFolder);
  const isFree = storage === 'free';
  const entries = useMemo(() => normalizedEntries(value), [value]);
  const entriesRef = useRef(entries);
  useEffect(() => {
    entriesRef.current = entries;
  }, [entries]);

  const emit = (next: readonly unknown[]) => {
    onChange(emittedValue(next));
  };

  const appendValues = (rawValues: readonly unknown[]) => {
    const current = entriesRef.current;
    const seen = new Set(current.map(fileTargetKey));
    const additions: string[] = [];
    for (const raw of rawValues) {
      const text = stringEntry(raw).trim();
      if (!text) continue;
      const key = fileTargetKey(text);
      if (seen.has(key)) continue;
      seen.add(key);
      additions.push(text);
    }
    if (additions.length === 0) {
      setError(t('files.duplicate', 'This file is already in the list.'));
      return;
    }
    emit([...current, ...additions]);
  };

  const addTitle = isLink
    ? t('files.link_existing', 'Link a local file (without copying)')
    : isFree
      ? t('files.upload_choose_folder', 'Upload and choose the destination folder')
      : t('files.upload_to', 'Upload to {{folder}}', {
          folder: STORAGE_LABELS[storage] || STORAGE_LABELS.assets,
        });

  return (
    <div className="space-y-1.5">
      {entries.map((entry, index) => {
        const fileName = filenameFromTarget(entry);
        const isServed = entry.startsWith('/api/') || /^https?:\/\//i.test(entry);
        return (
          <div
            className="flex items-center gap-2 text-xs bg-[var(--bg-secondary)] rounded-lg px-2.5 py-1.5 border border-[var(--border-primary)]"
            key={`${String(index)}-${entry}`}
          >
            <FileText className="text-[var(--gnosi-primary)] shrink-0" size={13} />
            {isServed ? (
              <a
                className="truncate text-[var(--gnosi-primary)] hover:underline flex-1"
                href={entry}
                rel="noreferrer"
                target="_blank"
              >
                {fileName}
              </a>
            ) : (
              <span
                className="truncate text-[var(--text-secondary)] flex-1"
                title={entry}
              >
                {fileName}
              </span>
            )}
            <button
              className="text-[var(--text-tertiary)] hover:text-red-500 transition-colors shrink-0"
              onClick={() => {
                emit(entriesRef.current.filter((_, itemIndex) => itemIndex !== index));
              }}
              title={t('common.delete', 'Delete')}
              type="button"
            >
              <X size={13} />
            </button>
          </div>
        );
      })}

      <button
        className="flex items-center justify-center w-7 h-7 rounded-lg border border-[var(--border-primary)] text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)] hover:border-[var(--gnosi-primary)]/50 hover:text-[var(--gnosi-primary)] transition-colors disabled:opacity-50"
        onClick={() => {
          setError('');
          setPickerOpen(true);
        }}
        title={addTitle}
        type="button"
      >
        <Plus size={15} />
      </button>

      {error ? (
        <p className="text-[11px] text-red-500 bg-red-50 dark:bg-red-900/20 rounded px-2 py-1">
          {error}
        </p>
      ) : null}

      <FileInsertContentModal
        fileField={{ propertyName, storageFolder: storage, namePattern, fileMode }}
        onClose={() => {
          setPickerOpen(false);
        }}
        onInsert={(result) => {
          const raws = Array.isArray(result?.urls) && result.urls.length
            ? result.urls
            : result?.url ? [result.url] : [];
          if (raws.length) appendValues(raws);
        }}
        open={pickerOpen}
        rowMetadata={rowMetadata}
        tableId={tableId || ''}
      />
    </div>
  );
}
