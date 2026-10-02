import { DraftSaveStatus } from '../../../shared/editor/DraftSaveStatus';
import { useState } from 'react';
import {
    AlertTriangle,
    Check,
    Loader2,
    ShieldAlert,
    Sparkles,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { logError } from '../../../shared/notifications/notifyError';
import {
    type NormalizedSkill,
    type NormalizedTool,
    type SkillDraft,
} from './aiSettingsUtils';
import { ToolPicker } from './AIToolPicker';
import { useDraftAutosave } from '../../../shared/hooks/useDraftAutosave';
import { InstructionMarkdownEditor } from '../../../shared/editor/InstructionMarkdownEditor';
import { ConfirmModal } from '../../../shared/ui/dialogs/ConfirmModal';


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
    readonly original?: NormalizedSkill;
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
    original,
    tools,
}: SkillEditorProps) {
    const { t } = useTranslation();
    const [draft, setDraft] = useState(() => createDraft(skill));
    const [validation, setValidation] = useState<SkillValidation | null>(null);
    const [validating, setValidating] = useState(false);
    const [restoring, setRestoring] = useState(false);
    const originalInstructions = original?.instructions ?? skill?.metadata?.derived_from?.instructions;
    const canSave = Boolean(draft.name.trim() && draft.instructions.trim());

    const toggleTool = (toolId: string): void => {
        setDraft((current) => ({
            ...current,
            toolIds: current.toolIds.includes(toolId)
                ? current.toolIds.filter((id) => id !== toolId)
                : [...current.toolIds, toolId],
        }));
    };
    const autosave = useDraftAutosave(draft, canSave, onSave);
    const close = async () => { if (await autosave.flush()) onCancel(); };
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
                <strong>{skill?.id
                    ? t('settings.ai.resources.edit_skill')
                    : t('settings.ai.resources.create_skill')}</strong>
                <DraftSaveStatus status={!canSave && autosave.dirty ? 'incomplete' : skill?.id && autosave.status === 'idle' ? 'saved' : autosave.status} />
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
            <InstructionMarkdownEditor
                label={t('settings.ai.resources.instructions')}
                description={t('settings.ai.resources.instructions_help')}
                value={draft.instructions}
                onChange={instructions => {
                    setDraft(current => ({ ...current, instructions }));
                }}
            />
            <ToolPicker tools={tools} selected={draft.toolIds} onToggle={toggleTool} />
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
                {skill?.id && originalInstructions !== undefined && <button type="button" className="btn-gnosi-secondary" disabled={autosave.status === 'saving'} onClick={() => { setRestoring(true); }}>{t('settings.ai.resources.restore_original')}</button>}
                <button
                    className="btn-gnosi-secondary"
                    onClick={() => { void close(); }}
                    type="button"
                >
                    {t('common.close')}
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
                {autosave.status === 'error' && <button type="button" className="btn-gnosi btn-gnosi-secondary"
                    onClick={() => { void autosave.flush(); }}>{t('common.retry')}</button>}

            </div>
            <ConfirmModal isOpen={restoring} onClose={() => { setRestoring(false); }}
                title={t('settings.ai.resources.restore_original')} message={t('settings.ai.resources.restore_original_help')}
                confirmText={t('settings.ai.resources.restore_original')} autofocusConfirm={false}
                onConfirm={() => {
                    setDraft(current => ({ ...current, instructions: originalInstructions ?? current.instructions,
                        toolIds: [...(original?.toolIds ?? skill?.metadata?.derived_from?.tool_ids ?? current.toolIds)],
                        activation: original?.activation ?? current.activation }));
                    setValidation(null); setRestoring(false);
                }} />
        </div>
    );
}
