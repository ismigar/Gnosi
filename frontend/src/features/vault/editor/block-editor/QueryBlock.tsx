import { useContext } from 'react';
import { useTranslation } from 'react-i18next';

import { VaultEditorContext } from '../../../../shared/editor/VaultEditorContext';
import { EmbeddedVaultSearch } from '../../../../shared/page-search/EmbeddedVaultSearch';

interface QueryBlockProps {
  readonly query: string;
  readonly editable: boolean;
  readonly onChange: (query: string) => void;
}

export function QueryBlock({ query, editable, onChange }: QueryBlockProps): React.JSX.Element {
  const { t } = useTranslation();
  const context = useContext(VaultEditorContext);
  return <div contentEditable={false} className="w-full">
    <label className="block text-xs text-[var(--text-secondary)]">{t('globalsearch.embedded', 'Search results')}
      <input className="w-full rounded border border-[var(--border-primary)] bg-[var(--bg-primary)] p-2 font-mono text-sm" value={query} readOnly={!editable} maxLength={2000} placeholder={t('globalsearch.search_placeholder')} onChange={(event) => { onChange(event.target.value); }} />
    </label>
    <EmbeddedVaultSearch query={query} onOpenPage={(id) => { (context.onOpenInCurrentTab ?? context.onOpenPage)?.(id); }} />
  </div>;
}
