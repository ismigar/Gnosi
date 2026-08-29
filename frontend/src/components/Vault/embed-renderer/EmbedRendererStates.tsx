import {
  AlertTriangle,
  Edit3,
  ExternalLink,
  FolderOpen,
  Frame,
  RefreshCw,
} from 'lucide-react';

import { EmbedMedia } from './EmbedMedia';
import type { EmbedKind } from './embedRendererModel';


type Translate = (
  key: string,
  options: Readonly<{ defaultValue: string }>,
) => string;


interface EmptyEmbedProps {
  readonly onPickUrl: () => void;
  readonly onPickVault: () => void;
  readonly rootRef: React.ForwardedRef<HTMLDivElement>;
  readonly t: Translate;
}


export function EmptyEmbed({
  onPickUrl,
  onPickVault,
  rootRef,
  t,
}: EmptyEmbedProps): React.JSX.Element {
  return (
    <div
      ref={rootRef}
      className="my-4 p-8 rounded-xl border border-dashed border-[var(--border-primary)] bg-[var(--bg-secondary)]/30 flex flex-col items-center gap-4 text-center"
    >
      <div className="w-12 h-12 rounded-full bg-[var(--gnosi-primary)]/10 flex items-center justify-center">
        <Frame size={22} className="text-[var(--gnosi-primary)]" />
      </div>
      <div>
        <div className="text-sm font-semibold text-[var(--text-primary)]">
          {t('editor.embed_empty_title', { defaultValue: 'Embedded frame' })}
        </div>
        <div className="text-xs text-[var(--text-tertiary)] mt-1">
          {t('editor.embed_empty_subtitle', {
            defaultValue: 'Choose a file from the Vault, browse your disk, upload one or paste a URL',
          })}
        </div>
      </div>
      <div className="flex gap-2 flex-wrap justify-center">
        <button
          onClick={onPickVault}
          className="px-3 py-2 text-xs font-medium rounded-lg bg-[var(--gnosi-primary)] text-white hover:opacity-90 flex items-center gap-1.5"
        >
          <FolderOpen size={14} />
          {t('editor.embed_pick_file', { defaultValue: 'Choose file…' })}
        </button>
        <button
          onClick={onPickUrl}
          className="px-3 py-2 text-xs font-medium rounded-lg border border-[var(--border-primary)] hover:bg-[var(--bg-secondary)] flex items-center gap-1.5"
        >
          <ExternalLink size={14} />
          {t('editor.embed_paste_url', { defaultValue: 'External URL' })}
        </button>
      </div>
    </div>
  );
}


interface MissingEmbedProps {
  readonly onRelink: () => void;
  readonly rawUrl: string;
  readonly rootRef: React.ForwardedRef<HTMLDivElement>;
  readonly t: Translate;
}


export function MissingEmbed({
  onRelink,
  rawUrl,
  rootRef,
  t,
}: MissingEmbedProps): React.JSX.Element {
  return (
    <div
      ref={rootRef}
      className="my-4 p-6 rounded-xl border border-[var(--status-error)]/40 bg-[var(--status-error)]/5 flex flex-col items-center gap-3 text-center"
    >
      <div className="w-10 h-10 rounded-full bg-[var(--status-error)]/15 flex items-center justify-center">
        <AlertTriangle size={18} className="text-[var(--status-error)]" />
      </div>
      <div>
        <div className="text-sm font-semibold text-[var(--text-primary)]">
          {t('editor.embed_missing_title', { defaultValue: 'File not found' })}
        </div>
        <div className="text-xs text-[var(--text-tertiary)] mt-1 max-w-md break-all">
          {t('editor.embed_missing_subtitle', {
            defaultValue: 'The local file has been moved or deleted',
          })}: <span className="font-mono">{rawUrl}</span>
        </div>
      </div>
      <button
        onClick={onRelink}
        className="px-3 py-2 text-xs font-medium rounded-lg bg-[var(--gnosi-primary)] text-white hover:opacity-90 flex items-center gap-1.5"
      >
        <RefreshCw size={14} />
        {t('editor.embed_relink', { defaultValue: 'Re-link' })}
      </button>
    </div>
  );
}


interface ResolvedEmbedProps {
  readonly caption: string;
  readonly kind: EmbedKind;
  readonly onChange: () => void;
  readonly rootRef: React.ForwardedRef<HTMLDivElement>;
  readonly t: Translate;
  readonly url: string;
}


export function ResolvedEmbed({
  caption,
  kind,
  onChange,
  rootRef,
  t,
  url,
}: ResolvedEmbedProps): React.JSX.Element {
  return (
    <div ref={rootRef} className="w-full min-w-0 my-4 group/embed">
      <div className="relative">
        <EmbedMedia caption={caption} kind={kind} url={url} />
        <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover/embed:opacity-100 transition-opacity">
          <button
            onClick={onChange}
            className="p-1.5 rounded-md bg-[var(--bg-primary)]/90 border border-[var(--border-primary)] hover:bg-[var(--bg-secondary)]"
            title={t('editor.embed_change', { defaultValue: 'Change the file' })}
          >
            <Edit3 size={12} />
          </button>
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="p-1.5 rounded-md bg-[var(--bg-primary)]/90 border border-[var(--border-primary)] hover:bg-[var(--bg-secondary)] flex items-center"
            title={t('editor.open_in_new_tab', { defaultValue: 'Open in a new tab' })}
          >
            <ExternalLink size={12} />
          </a>
        </div>
      </div>
      {caption ? (
        <div className="mt-1 text-xs text-[var(--text-tertiary)] text-center italic">
          {caption}
        </div>
      ) : null}
    </div>
  );
}
