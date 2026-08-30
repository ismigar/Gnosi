import { Calendar } from 'lucide-react';
import { Hash } from 'lucide-react';
import { PropertyValue } from './PropertyValue';
import React from 'react';
import { Tag } from 'lucide-react';
import { Type } from 'lucide-react';
import { X } from 'lucide-react';
import type { PageEditorController } from './usePageEditorController';
import type { PageProperty } from './types';
export function SchemaPropertyRow({ context, prop }: { context: PageEditorController; prop: PageProperty }) {
  const { getPropConfig, openPropHelp, activeProp, setActiveProp, t, setOpenPropHelp, currentTable, handleRemoveProperty } = context;

  const propDesc = prop.description || prop.config?.description || getPropConfig(prop).description;
  const isHelpOpen = !!openPropHelp[prop.name];
  return (
    <React.Fragment key={prop.name}>
      <div
        role="button"
        tabIndex={0}
        data-prop-row={prop.name}
        aria-pressed={activeProp === prop.name}
        onClick={() => { setActiveProp(prop.name); }}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setActiveProp(prop.name); } }}
        title={t('editor.property_select_hint', { defaultValue: "Select the property (↑↓ navigate · ⌘C/⌘V copy/paste)" })}
        className={`flex items-center gap-1.5 group py-1 h-8 cursor-pointer rounded-md focus:outline-none focus:ring-1 focus:ring-[var(--gnosi-primary)]/40 ${activeProp === prop.name ? 'bg-[var(--gnosi-primary)]/10 ring-1 ring-[var(--gnosi-primary)]/40' : ''} ${['files', 'autoria', 'relation', 'multi_select', 'select', 'status', 'period'].includes(prop.type) ? 'self-start' : ''}`}
      >
        <div className="p-1.5 rounded-md bg-[var(--bg-secondary)] text-[var(--text-tertiary)]/60 group-hover:bg-[var(--gnosi-primary)]/10 group-hover:text-[var(--gnosi-primary)] transition-colors shrink-0">
          {['date', 'datetime', 'period'].includes(prop.type) ? <Calendar size={14} /> : (['select', 'status'].includes(prop.type) ? <Tag size={14} /> : (prop.type === 'number' ? <Hash size={14} /> : <Type size={14} />))}
        </div>
        <span className="text-sm text-[var(--text-secondary)] font-medium truncate">{prop.name}</span>
        {propDesc && (
          <button
            type="button"
            aria-expanded={isHelpOpen}
            aria-label={t('schema.toggle_description', 'Toggle field description')}
            title={propDesc}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setOpenPropHelp((prev) => ({ ...prev, [prop.name]: !prev[prop.name] }));
            }}
            className={`inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full border text-[9px] font-bold leading-none transition-colors ${isHelpOpen
                ? 'border-[var(--gnosi-primary)] bg-[var(--gnosi-primary)] text-white'
                : 'border-[var(--border-primary)] text-[var(--text-tertiary)] hover:border-[var(--gnosi-primary)] hover:text-[var(--gnosi-primary)]'
              }`}
          >
            ?
          </button>
        )}
      </div>
      <div className={`flex items-center gap-1.5 group ${['files', 'autoria', 'relation', 'multi_select', 'select', 'status', 'period'].includes(prop.type) ? 'min-h-[2rem] py-1' : 'h-8'}`}>
        <PropertyValue prop={prop} context={context} />
        {!currentTable && (
          <button onClick={() => { handleRemoveProperty(prop.name); }} className="opacity-0 group-hover:opacity-100 p-1.5 text-[var(--text-tertiary)]/40 hover:text-[var(--status-error)] transition-all shrink-0" title={t('editor.remove_property')}><X size={14} /></button>
        )}
      </div>
      {isHelpOpen && propDesc && (
        <div className="col-span-2 text-xs text-[var(--text-secondary)] bg-[var(--bg-secondary)]/80 p-2.5 rounded-lg border border-[var(--border-primary)] mb-1.5 animate-in fade-in duration-150 font-normal leading-relaxed">
          <div className="font-semibold text-[var(--text-primary)] mb-0.5">{prop.name}</div>
          <div>{propDesc}</div>
        </div>
      )}
    </React.Fragment>
  )
}
