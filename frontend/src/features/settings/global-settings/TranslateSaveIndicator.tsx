import type { TFunction } from 'i18next';
import { Check, Loader2 } from 'lucide-react';

// Inline autosave status for the Translate tab inputs: a spinner while a
// debounced save is in flight, a transient check once it lands, nothing idle.
// Fixed width so the input doesn't shift as the indicator appears.
export const TranslateSaveIndicator = ({ saving, saved, t }: { saving: boolean; saved: boolean; t: TFunction }) => (
  <div
    aria-live="polite"
    style={{
      width: '86px', flexShrink: 0, display: 'flex', alignItems: 'center', gap: '5px',
      fontSize: '0.78rem', fontWeight: 600,
      color: saved ? 'var(--status-success)' : 'var(--text-secondary)',
    }}
  >
    {saving && <Loader2 size={14} className="animate-spin" />}
    {!saving && saved && <Check size={14} />}
    {saving
      ? (t('translate_settings.autosaving') || 'Desant…')
      : (saved ? (t('translate_settings.autosaved') || 'Desat') : null)}
  </div>
);
