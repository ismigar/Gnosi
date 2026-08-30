import type * as React from 'react';
import type { TFunction } from 'i18next';
import type { ToggleProps, SectionProps, FormGroupProps } from './types';
import { Check } from 'lucide-react';
import { Loader2 } from 'lucide-react';
import { createPortal } from 'react-dom';
// -- REUSABLE UI COMPONENTS --
/**
 * Accessible switch (role="switch") with keyboard support.
 * Replaces the non-focusable `<div className="gnosi-toggle">`: it is now
 * focusable with Tab and activatable with Enter/Space. The `onChange` handler receives
 * the event (click or keyboard) so the caller can do stopPropagation.
 * `display` leaves it visual-only (no role or keyboard) when the actual
 * interactive control is a parent container.
 */

export const GnosiToggle = ({ active, onChange, label, style, scale, display = false }: ToggleProps) => {
  const mergedStyle = scale != null ? { ...style, transform: `scale(${String(scale)})` } : style;
  if (display) {
    return (
      <div className={`gnosi-toggle ${active ? 'active' : ''}`} aria-hidden="true" style={{ pointerEvents: 'none', ...mergedStyle }}>
        <div className="gnosi-toggle-handle" />
      </div>
    );
  }
  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      onChange?.(e);
    }
  };
  return (
    <div
      role="switch"
      tabIndex={0}
      aria-checked={!!active}
      aria-label={label}
      className={`gnosi-toggle ${active ? 'active' : ''}`}
      onClick={(e) => { onChange?.(e); }}
      onKeyDown={handleKeyDown}
      style={mergedStyle}
    >
      <div className="gnosi-toggle-handle" />
    </div>
  );
};

export const Section = ({ title, icon: Icon, children, extra }: SectionProps) => (
  <div className="settings-section animate-in">
    <div className="settings-section-title-wrap">
      <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
        {Icon && <div className="settings-section-icon-wrap"><Icon size={20} /></div>}
        <h3 className="settings-section-title">{title}</h3>
      </div>
      {extra && <div style={{ flexShrink: 0 }}>{extra}</div>}
    </div>
    <div className="settings-section-content">
      {children}
    </div>
  </div>
);

export const FormGroup = ({ label, children, description, horizontal = false }: FormGroupProps) => (
  <div className="settings-form-group" style={{
    display: horizontal ? 'flex' : 'block',
    alignItems: horizontal ? 'center' : 'stretch',
    justifyContent: horizontal ? 'space-between' : 'flex-start',
    gap: horizontal ? '20px' : '0'
  }}>
    <div style={{ flex: horizontal ? 1 : 'none' }}>
      <label className="settings-label">{label}</label>
      {description && <div className="settings-desc">{description}</div>}
    </div>
    <div style={{ flex: horizontal ? '0 0 auto' : 'none' }}>
      {children}
    </div>
  </div>
);

/**
 * Keeps a collection editor next to its owning row without duplicating the
 * editor's stateful form. Creation forms render at their normal section
 * position; existing-item editors move into the matching row anchor.
 */
export const InlineEditorPlacement = ({ target, waitForTarget = false, children }: { target?: Element | DocumentFragment | null; waitForTarget?: boolean; children?: React.ReactNode }) => {
  if (target) return createPortal(children, target);
  return waitForTarget ? null : children;
};

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
