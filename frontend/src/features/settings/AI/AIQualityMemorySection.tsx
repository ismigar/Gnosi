import { useState } from 'react';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { logError } from '../../../shared/notifications/notifyError';
import { toast } from '../../../shared/notifications/toast';
import type {
    AgentMemory,
    AIQualityResources,
} from './aiQualityTypes';


interface AIQualityMemorySectionProps {
    readonly resources: Pick<
        AIQualityResources,
        'agentMemories' | 'removeAgentMemory' | 'saveAgentMemory'
    >;
    readonly selectedAgentId: string;
}


export const AIQualityMemorySection = ({
    resources,
    selectedAgentId,
}: AIQualityMemorySectionProps) => {
    const { t } = useTranslation();
    const [memoryText, setMemoryText] = useState('');
    const [editingMemory, setEditingMemory] = useState<AgentMemory | null>(null);

    const saveNewMemory = async (): Promise<void> => {
        if (!selectedAgentId || !memoryText.trim()) return;
        try {
            await resources.saveAgentMemory(selectedAgentId, {
                category: 'preference',
                text: memoryText,
            });
            setMemoryText('');
            toast.success(t('settings.ai.quality.memory_saved'));
        } catch (error) {
            logError('ai-quality-memory-create', error);
            toast.error(t('settings.ai.quality.memory_error'));
        }
    };

    const saveEditedMemory = async (): Promise<void> => {
        if (!selectedAgentId || !editingMemory?.text.trim()) return;
        try {
            await resources.saveAgentMemory(selectedAgentId, editingMemory);
            setEditingMemory(null);
            toast.success(t('settings.ai.quality.memory_saved'));
        } catch (error) {
            logError('ai-quality-memory-update', error);
            toast.error(t('settings.ai.quality.memory_error'));
        }
    };

    const removeMemory = async (memoryId: string): Promise<void> => {
        if (!selectedAgentId) return;
        try {
            await resources.removeAgentMemory(selectedAgentId, memoryId);
            toast.success(t('settings.ai.quality.memory_deleted'));
        } catch (error) {
            logError('ai-quality-memory-delete', error);
            toast.error(t('settings.ai.quality.memory_error'));
        }
    };

    return (
        <>
            <h4>{t('settings.ai.quality.memory_title')}</h4>
            <p className="ai-resource-muted">
                {t('settings.ai.quality.memory_help')}
            </p>
            <div className="ai-resource-editor">
                <textarea
                    className="gnosi-input"
                    rows={3}
                    value={memoryText}
                    onChange={(event) => {
                        setMemoryText(event.target.value);
                    }}
                />
                <div className="ai-resource-editor__actions">
                    <button
                        type="button"
                        className="btn-gnosi btn-gnosi-primary"
                        disabled={!selectedAgentId || !memoryText.trim()}
                        onClick={() => {
                            void saveNewMemory();
                        }}
                    >
                        <Plus size={16} /> {t('common.add')}
                    </button>
                </div>
            </div>
            <div className="ai-resource-list">
                {resources.agentMemories.map((item) => (
                    <article key={item.memory_id} className="ai-resource-card">
                        {editingMemory?.memory_id === item.memory_id ? (
                            <div className="ai-resource-editor" style={{ flex: 1 }}>
                                <textarea
                                    className="gnosi-input"
                                    rows={3}
                                    value={editingMemory.text}
                                    onChange={(event) => {
                                        setEditingMemory((current) => current === null
                                            ? null
                                            : ({ ...current, text: event.target.value }));
                                    }}
                                />
                                <label style={{
                                    alignItems: 'center',
                                    display: 'flex',
                                    gap: 8,
                                }}>
                                    <input
                                        type="checkbox"
                                        checked={editingMemory.enabled !== false}
                                        onChange={(event) => {
                                            setEditingMemory((current) => current === null
                                                ? null
                                                : ({
                                                    ...current,
                                                    enabled: event.target.checked,
                                                }));
                                        }}
                                    />
                                    {t('settings.ai.quality.memory_enabled')}
                                </label>
                                <div className="ai-resource-editor__actions">
                                    <button
                                        type="button"
                                        className="btn-gnosi-secondary"
                                        onClick={() => {
                                            setEditingMemory(null);
                                        }}
                                    >
                                        {t('common.cancel')}
                                    </button>
                                    <button
                                        type="button"
                                        className="btn-gnosi btn-gnosi-primary"
                                        disabled={!editingMemory.text.trim()}
                                        onClick={() => {
                                            void saveEditedMemory();
                                        }}
                                    >
                                        {t('common.save')}
                                    </button>
                                </div>
                            </div>
                        ) : (
                            <>
                                <div className="ai-resource-card__main">
                                    <span className="ai-resource-card__copy">
                                        <strong>
                                            {item.category}
                                            {item.enabled === false
                                                ? ` · ${t('settings.ai.quality.memory_disabled')}`
                                                : ''}
                                        </strong>
                                        <span>{item.text}</span>
                                    </span>
                                </div>
                                <div className="ai-resource-card__actions">
                                    <button
                                        type="button"
                                        onClick={() => {
                                            setEditingMemory({ ...item });
                                        }}
                                    >
                                        <Pencil size={15} /> {t('common.edit')}
                                    </button>
                                    <button
                                        type="button"
                                        className="is-danger"
                                        onClick={() => {
                                            void removeMemory(item.memory_id);
                                        }}
                                    >
                                        <Trash2 size={15} /> {t('common.delete')}
                                    </button>
                                </div>
                            </>
                        )}
                    </article>
                ))}
            </div>
        </>
    );
};
