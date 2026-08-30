import type { SchemaState } from './useSchemaState';
import type { ResolvedProps } from './props';
import { useEffect, useEffectEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from '../../../lib/toast';
import { pushModalLayer } from '../../../hooks/useModalKeyboard';
import { subscribeWindowEvent } from '../../../shared/platform/browser-events';
import { fetchAvailableAgentSkills, generateButtonAction } from '../../../shared/api/vault-schema';
import { apiErrorDetail, readString, readActionConfig } from './readers';
export function useAiAction(state: SchemaState, props: ResolvedProps) {
    const { t } = useTranslation();
    const {
        fields, setFunctionalities, aiActionModalFieldIndex, setAiActionModalFieldIndex, aiActionPrompt,
        setAiActionPrompt, setAiActionLoading, setAvailableSkills,
    } = state;
    const { isOpen } = props;
    const loadSkills = useEffectEvent(() => {
        if (isOpen) {
            fetchAvailableAgentSkills().then(data => {
                setAvailableSkills(data.skills.map((skill) => ({ ...skill, id: readString(skill.id), name: readString(skill.name) })));
            }).catch(() => {});
        }
    });
    useEffect(() => { loadSkills(); }, [isOpen]);

    const handleGenerateAiAction = async () => {
        if (!aiActionPrompt.trim() || aiActionModalFieldIndex === null) return;
        setAiActionLoading(true);
        try {
            const data = await generateButtonAction({
                prompt: aiActionPrompt,
                fields: fields.map(f => ({ name: f.name, type: f.type }))
            });
            const result = data.result;
            const idx = aiActionModalFieldIndex;
            setFunctionalities((current) => current.map((functionality, functionalityIndex) => functionalityIndex === idx ? {
                ...functionality,
                action: readString(result.button_action) || functionality.action,
                label: readString(result.button_label) || functionality.label,
                config: result.button_config ? readActionConfig(result.button_config) : functionality.config,
            } : functionality));
            toast.success(t('schema.button_program_success', "Acció programada correctament"));
            setAiActionModalFieldIndex(null);
            setAiActionPrompt('');
        } catch (err) {
            toast.error(apiErrorDetail(err, "Could not generate AI action"));
        } finally {
            setAiActionLoading(false);
        }
    };

    // The AI action modal renders in its own portal above this one, so it must
    // ALSO push its own layer into the modal stack; otherwise Esc is captured
    // by this modal's handler (still the top layer) and closes the whole dialog
    // instead of just the AI modal. Capture phase on `window`, like useModalKeyboard.
    const registerAiLayer = useEffectEvent(() => {
        if (aiActionModalFieldIndex === null) return undefined;
        const layer = pushModalLayer();
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape' && layer.isTop()) {
                e.preventDefault();
                e.stopPropagation();
                setAiActionModalFieldIndex(null);
                setAiActionPrompt('');
            }
        };
        const unsubscribe = subscribeWindowEvent('keydown', handleKeyDown, true);
        return () => {
            unsubscribe();
            layer.release();
        };
    });
    useEffect(() => registerAiLayer(), [aiActionModalFieldIndex]);


    return { handleGenerateAiAction };
}
