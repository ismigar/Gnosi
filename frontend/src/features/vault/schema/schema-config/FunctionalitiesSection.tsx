import React from 'react';
import type { SchemaConfigModel } from './useSchemaConfig';
import { Zap, Plus } from 'lucide-react';
import { FunctionalityEditor } from './FunctionalityEditor';
export function FunctionalitiesSection({ model }: { model: SchemaConfigModel }) {
    const {
        t, handleAddFunctionality, functionalities, fields, availableSkills, handleUpdateFunctionality,
        handleRemoveFunctionality, setAiActionModalFieldIndex, setAiActionPrompt,
    } = model;
    return <>
                        <div className="border-t border-[var(--border-primary)] pt-4 space-y-3">
                            <div className="flex items-start justify-between gap-3">
                                <div>
                                    <h4 className="text-sm font-semibold text-[var(--text-primary)] flex items-center gap-1.5">
                                        <Zap size={14} className="text-[var(--gnosi-primary)]" />
                                        {t('schema.functionalities_title', 'Functionalities')}
                                    </h4>
                                    <p className="mt-1 text-xs text-[var(--text-secondary)]/60">
                                        {t('schema.functionalities_hint', 'Configure row actions. Enabled functionalities appear as buttons at the left of the table.')}
                                    </p>
                                </div>
                                <button type="button" onClick={handleAddFunctionality}
                                    className="btn-gnosi btn-gnosi-primary !text-xs !py-1.5 !px-3 shrink-0">
                                    <Plus size={14} /> {t('schema.add_functionality', 'Add functionality')}
                                </button>
                            </div>
                            {functionalities.length === 0 ? (
                                <p className="rounded-lg border border-dashed border-[var(--border-primary)] px-3 py-4 text-center text-xs text-[var(--text-tertiary)]">
                                    {t('schema.functionalities_empty', 'No custom functionalities configured.')}
                                </p>
                            ) : functionalities.map((functionality, index) => (
                                <FunctionalityEditor
                                    key={functionality.id}
                                    functionality={functionality}
                                    index={index}
                                    allFields={fields}
                                    availableSkills={availableSkills}
                                    onUpdate={handleUpdateFunctionality}
                                    onRemove={handleRemoveFunctionality}
                                    onProgramWithAi={(functionalityIndex) => {
                                        setAiActionModalFieldIndex(functionalityIndex);
                                        setAiActionPrompt('');
                                    }}
                                />
                            ))}
                        </div>

    </>;
}
