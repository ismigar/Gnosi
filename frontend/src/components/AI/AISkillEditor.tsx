import { useState } from 'react';
import {
    AlertTriangle,
    Check,
    Loader2,
    ShieldAlert,
    Sparkles,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { logError } from '../../lib/notifyError';
import {
    type NormalizedSkill,
    type NormalizedTool,
    type SkillDraft,
} from './aiSettingsUtils';
import { localizedResourceSearchText, toolDisplayName } from './aiResourceI18n';
import {
    EffectBadges,
    ResourceState,
    SearchField,
} from './AIResourcePrimitives';


interface EditableSkillDraft extends SkillDraft {
    toolIds: string[];
}


interface SkillValidation {
    readonly errors: readonly string[];
    readonly missingToolIds: readonly string[];
    readonly valid: boolean;
}


export interface SkillEditorProps {
    readonly onCancel: () => void;
    readonly onSave: (draft: SkillDraft) => Promise<unknown>;
    readonly onValidate?: (draft: SkillDraft) => Promise<unknown>;
    readonly skill?: NormalizedSkill | null;
    readonly tools: readonly NormalizedTool[];
}


const createDraft = (skill?: NormalizedSkill | null): EditableSkillDraft => ({
    activation: skill?.activation ?? 'automatic',
    description: skill?.description ?? '',
    instructions: skill?.instructions ?? '',
    name: skill?.name ?? '',
    toolIds: [...(skill?.toolIds ?? [])],
});


const stringArray = (value: unknown): string[] => (
    Array.isArray(value)
        ? value.filter((item): item is string => typeof item === 'string')
        : []
);


const validationResult = (value: unknown): SkillValidation => {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        return { errors: [], missingToolIds: [], valid: false };
    }
    const record = value as Readonly<Record<string, unknown>>;
    return {
        errors: stringArray(record.errors),
        missingToolIds: stringArray(record.missing_tool_ids),
        valid: record.valid === true,
    };
};


export function SkillEditor({
    onCancel,
    onSave,
    onValidate,
    skill = null,
    tools,
}: SkillEditorProps) {
    const { t } = useTranslation();
    const [draft, setDraft] = useState(() => createDraft(skill));
    const [toolSearch, setToolSearch] = useState('');
    const [saving, setSaving] = useState(false);
    const [validation, setValidation] = useState<SkillValidation | null>(null);
    const [validating, setValidating] = useState(false);
    const normalizedSearch = toolSearch.trim().toLowerCase();
    const visibleTools = tools.filter((tool) => (
        !normalizedSearch
        || localizedResourceSearchText(t, tool, 'tool').includes(normalizedSearch)
    ));
    const canSave = Boolean(draft.name.trim() && draft.instructions.trim());

    const toggleTool = (toolId: string): void => {
        setDraft((current) => ({
            ...current,
            toolIds: current.toolIds.includes(toolId)
                ? current.toolIds.filter((id) => id !== toolId)
                : [...current.toolIds, toolId],
        }));
    };
    const handleSave = async (): Promise<void> => {
        if (!canSave || saving) return;
        setSaving(true);
        try {
            await onSave(draft);
        } finally {
            setSaving(false);
        }
    };
    const handleValidate = async (): Promise<void> => {
        if (!onValidate || validating) return;
        setValidating(true);
        try {
            setValidation(validationResult(await onValidate(draft)));
        } catch (error: unknown) {
            logError('ai-skill-validation', error);
            setValidation({
                errors: [error instanceof Error ? error.message : 'Unknown error'],
                missingToolIds: [],
                valid: false,
            });
        } finally {
            setValidating(false);
        }
    };

    return (
        <div className="ai-resource-editor">
            <div className="ai-resource-editor__title">
                <Sparkles size={19} />
                <strong>{skill
                    ? t('settings.ai.resources.edit_skill')
                    : t('settings.ai.resources.create_skill')}</strong>
            </div>
            <div className="ai-resource-editor__grid">
                <label>
                    <span>{t('settings.ai.resources.name')}</span>
                    <input
                        className="gnosi-input"
                        onChange={(event) => {
                            setDraft((current) => ({
                                ...current,
                                name: event.target.value,
                            }));
                        }}
                        value={draft.name}
                    />
                </label>
                <label>
                    <span>{t('settings.ai.resources.activation')}</span>
                    <select
                        className="gnosi-select"
                        onChange={(event) => {
                            setDraft((current) => ({
                                ...current,
                                activation: event.target.value,
                            }));
                        }}
                        value={draft.activation}
                    >
                        <option value="always">{t('settings.ai.resources.activation_always')}</option>
                        <option value="automatic">{t('settings.ai.resources.activation_automatic')}</option>
                        <option value="explicit">{t('settings.ai.resources.activation_explicit')}</option>
                    </select>
                </label>
            </div>
            <label>
                <span>{t('settings.ai.resources.description')}</span>
                <textarea
                    className="gnosi-input"
                    onChange={(event) => {
                        setDraft((current) => ({
                            ...current,
                            description: event.target.value,
                        }));
                    }}
                    rows={2}
                    value={draft.description}
                />
            </label>
            <label>
                <span>{t('settings.ai.resources.instructions')}</span>
                <textarea
                    className="gnosi-input"
                    onChange={(event) => {
                        setDraft((current) => ({
                            ...current,
                            instructions: event.target.value,
                        }));
                    }}
                    rows={7}
                    value={draft.instructions}
                />
            </label>
            <div className="ai-resource-editor__tools">
                <div>
                    <strong>{t('settings.ai.resources.approved_tools')}</strong>
                    <p>{t('settings.ai.resources.approved_tools_help')}</p>
                </div>
                <SearchField
                    onChange={setToolSearch}
                    placeholder={t('settings.ai.resources.search_tools')}
                    value={toolSearch}
                />
                <div className="ai-resource-tool-options">
                    {visibleTools.map((tool) => (
                        <label
                            className={`ai-resource-tool-option ${tool.available
                                ? ''
                                : 'is-unavailable'}`}
                            key={tool.id}
                        >
                            <input
                                checked={draft.toolIds.includes(tool.id)}
                                disabled={!tool.available
                                    && !draft.toolIds.includes(tool.id)}
                                onChange={() => {
                                    toggleTool(tool.id);
                                }}
                                type="checkbox"
                            />
                            <span className="ai-resource-tool-option__copy">
                                <strong>{toolDisplayName(t, tool)}</strong>
                                <code>{tool.id}</code>
                                <EffectBadges effects={tool.effects} />
                            </span>
                            <ResourceState
                                available={tool.available}
                                status={tool.status}
                            />
                        </label>
                    ))}
                    {visibleTools.length === 0 ? (
                        <span className="ai-resource-muted">
                            {t('settings.ai.resources.no_matching_tools')}
                        </span>
                    ) : null}
                </div>
            </div>
            {!canSave ? (
                <div className="ai-resource-validation">
                    <AlertTriangle size={15} />
                    {t('settings.ai.resources.required_fields')}
                </div>
            ) : null}
            {validation ? (
                <div className={`ai-resource-alert ${validation.valid
                    ? ''
                    : 'is-warning'}`}
                >
                    {validation.valid
                        ? <Check size={16} />
                        : <AlertTriangle size={16} />}
                    <span>{validation.valid
                        ? t('settings.ai.resources.validation_valid')
                        : t('settings.ai.resources.validation_invalid', {
                            errors: [
                                ...validation.errors,
                                ...validation.missingToolIds,
                            ].join(', '),
                        })}</span>
                </div>
            ) : null}
            <div className="ai-resource-editor__actions">
                <button
                    className="btn-gnosi-secondary"
                    onClick={onCancel}
                    type="button"
                >
                    {t('common.cancel')}
                </button>
                {skill && onValidate ? (
                    <button
                        className="btn-gnosi-secondary"
                        disabled={validating || !canSave}
                        onClick={() => {
                            void handleValidate();
                        }}
                        type="button"
                    >
                        {validating
                            ? <Loader2 className="animate-spin" size={16} />
                            : <ShieldAlert size={16} />}
                        {t('settings.ai.resources.validate')}
                    </button>
                ) : null}
                <button
                    className="btn-gnosi btn-gnosi-primary"
                    disabled={!canSave || saving}
                    onClick={() => {
                        void handleSave();
                    }}
                    type="button"
                >
                    {saving
                        ? <Loader2 className="animate-spin" size={16} />
                        : <Check size={16} />}
                    {t('common.save')}
                </button>
            </div>
        </div>
    );
}
