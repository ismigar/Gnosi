import { Calendar } from 'lucide-react';
import { FileText } from 'lucide-react';
import { Image } from 'lucide-react';
import * as LucideIcons from 'lucide-react';
import { Mail } from 'lucide-react';
import { Paperclip } from 'lucide-react';
import { PenTool } from 'lucide-react';
import { Users } from 'lucide-react';
import { fetchVaultGraph } from '../../shared/api/graph';
import { settingsGraphNode } from './settingsGraphModel';
import { toValueStrings } from '../../utils/graphFilters';
import { useEffect } from 'react';
import { useMemo } from 'react';
import type { SettingsState } from './stateTypes';

type Input = SettingsState;

export function useSettingsGraph(state: Input) {
  const { activeTab, draft, graphNodes, graphNodesFetchedRef, graphNodesLoading, integrations, isOpen, setDraft, setGraphNodes, setGraphNodesLoading, t, tn } = state;
  const systemEntities = useMemo(() => [
    {
      id: 'attachments',
      name: tn('graph.entity_attachments'),
      icon: Paperclip,
      color: '#6366f1',
      fields: [
        { name: 'mimetype', type: 'select' },
        { name: 'extension', type: 'text' }
      ]
    },
    {
      id: 'calendars',
      name: tn('graph.entity_calendars'),
      icon: LucideIcons.Calendar,
      color: '#ef4444',
      subItems: (integrations.calendars || []).map(c => ({ id: c.id ?? "", name: c.name })),
      fields: [
        { name: 'status', type: 'select' },
        { name: 'location', type: 'text' }
      ]
    },
    {
      id: 'contacts',
      name: tn('graph.entity_contacts'),
      icon: LucideIcons.Users,
      color: '#10b981',
      subItems: (integrations.contacts || []).map(c => ({ id: c.id ?? "", name: c.name })),
      fields: [
        { name: 'company', type: 'text' },
        { name: 'job_title', type: 'text' }
      ]
    },
    {
      id: 'drawings',
      name: tn('graph.entity_drawings'),
      icon: PenTool,
      color: '#f59e0b',
      fields: [{ name: 'tool', type: 'select' }]
    },
    {
      id: 'images',
      name: tn('graph.entity_images'),
      icon: Image,
      color: '#ec4899',
      fields: [{ name: 'dimensions', type: 'text' }]
    },
    {
      id: 'mails',
      name: tn('graph.entity_mails'),
      icon: LucideIcons.Mail,
      color: '#3b82f6',
      subItems: (integrations.mail_accounts || []).map(m => ({ id: m.id ?? "", name: m.email })),
      fields: [
        { name: 'subject', type: 'text' },
        { name: 'is_read', type: 'checkbox' }
      ]
    },
    {
      id: 'wiki',
      name: tn('graph.entity_wiki'),
      icon: FileText,
      color: '#8b5cf6',
      fields: [
        { name: 'category', type: 'text' },
        { name: 'priority', type: 'number' }
      ]
    }
  ], [integrations, tn]);

  useEffect(() => {
    if (!isOpen || activeTab !== 'graph' || graphNodesFetchedRef.current) return;
    graphNodesFetchedRef.current = true;
    setGraphNodesLoading(true);
    fetchVaultGraph()
      .then(g => { setGraphNodes(Array.isArray(g.nodes) ? g.nodes : []); })
      .catch(() => { setGraphNodes([]); })
      .finally(() => { setGraphNodesLoading(false); });
  }, [isOpen, activeTab, graphNodesFetchedRef, setGraphNodesLoading, setGraphNodes]);

  const graphFieldValues = useMemo(() => {
    const idx = new Map<string, Map<string, Set<string>>>();
    for (const node of (graphNodes || [])) {
      const { tableId: tid, metadata: meta } = settingsGraphNode(node);
      if (!tid) continue;
      let fm = idx.get(tid);
      if (!fm) { fm = new Map(); idx.set(tid, fm); }
      for (const k of Object.keys(meta)) {
        const vals = toValueStrings(meta[k]);
        if (vals.length === 0) continue;
        const kl = k.toLowerCase();
        let set = fm.get(kl);
        if (!set) { set = new Set(); fm.set(kl, set); }
        for (const v of vals) set.add(v);
      }
    }
    return idx;
  }, [graphNodes]);

  const getFieldOptions = (tableId: string | undefined, fieldName: string | undefined) => {
    const fm = graphFieldValues.get(tableId ?? "");
    if (!fm) return [];
    const set = fm.get(String(fieldName).toLowerCase());
    return set ? Array.from(set).sort((a, b) => a.localeCompare(b)) : [];
  };

  const renderFieldDefaultInput = (field: { type?: string }, fieldKey: string, placeholder: string) => {
    const ftype = (field.type || 'text').toLowerCase();
    const defaultVal = draft.graph.field_defaults?.[fieldKey] || '';
    const setVal = (v: string) => {
      setDraft(p => ({
        ...p,
        graph: { ...p.graph, field_defaults: { ...(p.graph.field_defaults || {}), [fieldKey]: v } }
      }));
    };
    const baseStyle = { fontSize: '0.75rem', padding: '6px 10px', height: 'auto', width: '130px' };

    // List (select / multi_select / status) → dropdown with real options.
    if (ftype === 'select' || ftype === 'multi_select' || ftype === 'status') {
      const [tableId, fieldName] = fieldKey.split(':');
      const opts = getFieldOptions(tableId, fieldName);
      if (opts.length === 0) {
        if (graphNodesLoading) {
          return <span style={{ ...baseStyle, color: 'var(--text-secondary)', display: 'inline-flex', alignItems: 'center' }}>{t('common.loading', 'Carregant…')}</span>;
        }
        // Without known values: free text so the user can set one.
        return <input type="text" className="gnosi-input" style={baseStyle} placeholder={placeholder} value={defaultVal} onChange={e => { setVal(e.target.value); }} />;
      }
      const withCurrent = (defaultVal && !opts.includes(defaultVal)) ? [defaultVal, ...opts] : opts;
      return (
        <select className="gnosi-input" style={baseStyle} value={defaultVal} onChange={e => { setVal(e.target.value); }}>
          <option value="">—</option>
          {withCurrent.map(o => <option key={o} value={o}>{o}</option>)}
        </select>
      );
    }

    // Checkbox (checkbox) → real checkbox. Checked = 'true'; unchecked = no value.
    if (ftype === 'checkbox') {
      const checked = defaultVal === 'true';
      return (
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', width: '130px', cursor: 'pointer' }}>
          <input type="checkbox" checked={checked} onChange={e => { setVal(e.target.checked ? 'true' : ''); }} style={{ accentColor: 'var(--gnosi-blue)', width: '16px', height: '16px' }} />
          <span style={{ fontSize: '0.72rem', color: 'var(--text-secondary)' }}>{checked ? t('common.yes', 'Sí') : '—'}</span>
        </label>
      );
    }

    // Date / Date and time / Number → native inputs of the corresponding type.
    if (ftype === 'date') return <input type="date" className="gnosi-input" style={baseStyle} value={defaultVal} onChange={e => { setVal(e.target.value); }} />;
    if (ftype === 'datetime') return <input type="datetime-local" className="gnosi-input" style={baseStyle} value={defaultVal} onChange={e => { setVal(e.target.value); }} />;
    if (ftype === 'number') return <input type="number" className="gnosi-input" style={baseStyle} placeholder={placeholder} value={defaultVal} onChange={e => { setVal(e.target.value); }} />;

    // By default → text.
    return <input type="text" className="gnosi-input" style={baseStyle} placeholder={placeholder} value={defaultVal} onChange={e => { setVal(e.target.value); }} />;
  };
  return { getFieldOptions, graphFieldValues, renderFieldDefaultInput, systemEntities };
}
