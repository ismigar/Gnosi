import type { PageEditorController } from './usePageEditorController';

/** The page override travels with its metadata; automatic mode follows detection. */
export function PageSpellLanguage({ context }: { context: PageEditorController }) {
  const { metadata, metadataRef, setMetadata, handleSaveMetadata, t, isEditable } = context;
  const language = typeof metadata.spell_language === 'string' && ['ca', 'es', 'en'].includes(metadata.spell_language)
    ? metadata.spell_language : 'auto';
  return <select
    aria-label={t('editor.spellcheck_language', 'Proofreading language')}
    title={t('editor.spellcheck_language', 'Proofreading language')}
    value={language}
    disabled={!isEditable}
    className="max-w-32 rounded-md bg-[var(--bg-secondary)] px-2 py-1 text-xs text-[var(--text-primary)]"
    onChange={(event) => {
      const value = event.target.value;
      if (!['auto', 'ca', 'es', 'en'].includes(value)) return;
      const next = { ...metadataRef.current, spell_language: value };
      metadataRef.current = next;
      setMetadata(next);
      handleSaveMetadata(next);
    }}
  >
    <option value="auto">{t('editor.spellcheck_automatic', 'Automatic')}</option>
    <option value="ca">Català</option>
    <option value="es">Castellano</option>
    <option value="en">English</option>
  </select>;
}
