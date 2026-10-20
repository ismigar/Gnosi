import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { GnosiToggle } from '../../../shared/ui/settings/SettingsPrimitives';
import type { NormalizedTool } from './aiSettingsUtils';
import { domainLabel, localizedResourceSearchText, resourceDomain, resourceStatusLabel, toolDisplayDescription, toolDisplayName } from './aiResourceI18n';
import { originLabel } from './aiResourceLabels';
import { EffectBadges, SearchField } from './AIResourcePrimitives';

export function ToolPicker({ tools, selected, onToggle }: {
    readonly tools: readonly NormalizedTool[];
    readonly selected: readonly string[];
    readonly onToggle: (id: string) => void;
}) {
    const { t } = useTranslation();
    const [search, setSearch] = useState('');
    const [domain, setDomain] = useState('all');
    const [effect, setEffect] = useState('all');
    const [availability, setAvailability] = useState('all');
    const [activeOnly, setActiveOnly] = useState(false);
    const domains = [...new Set(tools.map(resourceDomain))].sort();
    const filtered = tools.filter(tool => (
        localizedResourceSearchText(t, tool, 'tool').includes(search.trim().toLowerCase())
        && (!activeOnly || selected.includes(tool.id))
        && (domain === 'all' || resourceDomain(tool) === domain)
        && (availability === 'all' || tool.available === (availability === 'available'))
        && (effect === 'all' || tool.effects.some(value => ['local_write', 'external_write', 'destructive', 'bulk_write'].includes(value)) === (effect === 'write'))
    ));
    return <div className="ai-resource-editor__tools">
        <strong>{t('settings.ai.resources.selected_tools', { count: selected.length })}</strong>
        <div className="ai-resource-badges">{selected.map(id => <span key={id}>{toolDisplayName(t, tools.find(tool => tool.id === id) ?? { id })}</span>)}</div>
        <SearchField value={search} onChange={setSearch} placeholder={t('settings.ai.resources.search_tools')} />
        <div className="ai-resources-toolbar">
            <select className="gnosi-select" aria-label={t('settings.ai.resources.domain_filter')} value={domain} onChange={event => { setDomain(event.target.value); }}>
                <option value="all">{t('settings.ai.resources.all_domains')}</option>
                {domains.map(value => <option key={value} value={value}>{domainLabel(t, value)}</option>)}
            </select>
            <select className="gnosi-select" aria-label={t('settings.ai.resources.effect_filter')} value={effect} onChange={event => { setEffect(event.target.value); }}>
                <option value="all">{t('settings.ai.resources.all_effects')}</option><option value="read">{t('settings.ai.resources.read_only')}</option><option value="write">{t('settings.ai.resources.modifies_data')}</option>
            </select>
            <select className="gnosi-select" aria-label={t('settings.ai.resources.availability_filter')} value={availability} onChange={event => { setAvailability(event.target.value); }}>
                <option value="all">{t('settings.ai.resources.all_statuses')}</option><option value="available">{t('settings.ai.resources.status_available')}</option><option value="unavailable">{t('settings.ai.resources.status_unavailable')}</option>
            </select>
        </div>
        <div className="inline-flex items-center gap-2">
            <GnosiToggle
                label={t('settings.ai.resources.active_tools_only')}
                active={activeOnly}
                onChange={() => { setActiveOnly(value => !value); }}
            />
            <span>{t('settings.ai.resources.active_tools_only')}</span>
        </div>
        <div className="ai-resource-tool-options">{filtered.map(tool => <div className="ai-resource-tool-option" key={tool.id}>
            <GnosiToggle label={toolDisplayName(t, tool)} active={selected.includes(tool.id)} disabled={!tool.available && !selected.includes(tool.id)} onChange={() => { onToggle(tool.id); }} />
            <span className="ai-resource-tool-option__copy">
                <strong>{toolDisplayName(t, tool)}</strong>
                <span>{toolDisplayDescription(t, tool)}</span>
                <span className="ai-resource-muted">{originLabel(t, tool.origin)}</span>
                <EffectBadges effects={tool.effects} />
                {!tool.available && <span role="status">{t('settings.ai.resources.tool_unavailable_help', { status: resourceStatusLabel(t, tool.status) })}</span>}
            </span>
        </div>)}</div>
        {filtered.length === 0 && <p>{t('settings.ai.resources.no_matching_tools')}</p>}
    </div>;
}
