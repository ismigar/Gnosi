import React from 'react';
import type { SchemaConfigModel } from './useSchemaConfig';
import { createPortal } from 'react-dom';
import { Settings, X, AlertTriangle, Plus } from 'lucide-react';
import { DndContext, closestCenter } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { ConfirmModal } from '../../../../shared/ui/dialogs/ConfirmModal';
import { SortableField } from './SortableField';
import { TableSettings } from './TableSettings';
import { AiActionDialog } from './AiActionDialog';
export function SchemaConfigDialog({ model }: { model: SchemaConfigModel }) {
    const {
        t, isOpen, onClose, folder, tableName, validationError, enableTranslation, enableDrupalSync,
        drupalBundle, drupalFieldMapping, setDrupalFieldMapping, drupalFields, fields, availableSkills,
        setAiActionModalFieldIndex, setAiActionPrompt, sensors, handleDragEnd, allTables,
        resolvedTableName, virtualComputers, handleUpdateField, handleRemoveField, optionTools,
        projectPlanningEnabled, handleAddField, confirmRemoveField, setConfirmRemoveField,
        executeRemoveField, toggleConfirm, closeToggleConfirm, modalRef, scrollRef,
    } = model;
    if (!isOpen) return null;
    return createPortal(
        <>
        <div
            ref={modalRef}
            className="fixed inset-0 bg-black/60 flex items-center justify-center z-[var(--z-modal-dropdown)] p-4 font-sans backdrop-blur-sm"
        >
            <div className="bg-[var(--bg-primary)] rounded-xl shadow-2xl w-full max-w-4xl overflow-hidden flex flex-col max-h-[90vh] border border-[var(--border-primary)]" role="dialog" aria-modal="true" aria-labelledby="schema-config-title">
                {/* Header */}
                <div className="px-6 py-4 border-b border-[var(--border-primary)] flex justify-between items-center bg-[var(--bg-secondary)] shrink-0">
                    <h2 id="schema-config-title" className="text-base font-bold text-[var(--text-primary)] flex items-center gap-2">
                        <Settings size={20} className="text-[var(--gnosi-primary)]" />
                        {t('schema.manage_properties_of')} {folder}{tableName ? ` · ${tableName}` : ''}
                    </h2>
                    <button onClick={onClose} className="gnosi-close-btn" aria-label={t('common.close', "Close")}>
                        <X />
                    </button>
                </div>

                <div ref={scrollRef} tabIndex={-1} className="gnosi-modal-scroll p-6 overflow-y-auto flex-1 bg-[var(--bg-primary)] outline-none">
                    {/* Autosave paused: this modal saves continuously, so an invalid
                        state means nothing is being persisted. It used to fail in
                        silence and the user only noticed on reopening the modal. */}
                    {validationError && (
                        <div
                            role="alert"
                            className="mb-6 flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-xs text-[var(--text-primary)]"
                        >
                            <AlertTriangle size={16} className="mt-px shrink-0 text-amber-500" />
                            <span>
                                <strong className="font-semibold">
                                    {t('schema.autosave_paused', "Unsaved changes")}
                                </strong>
                                {' — '}
                                {validationError}
                            </span>
                        </div>
                    )}
                    <TableSettings model={model} />

                    <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-3 flex items-center gap-2 px-1">
                        {t('schema.columns_and_properties')}
                    </h3>
                    <p className="text-xs text-[var(--text-secondary)]/60 mb-4 px-1">
                        {t('schema.columns_hint')}
                    </p>

                    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                        <SortableContext items={fields.map(f => f.id)} strategy={verticalListSortingStrategy}>
                            <div className="space-y-3">
                                {fields.map((field, idx) => (
                                    <SortableField
                                        key={field.id}
                                        field={field}
                                        idx={idx}
                                        allFields={fields}
                                        allTables={allTables}
                                        currentTableName={resolvedTableName}
                                        virtualComputers={virtualComputers}
                                        handleUpdateField={handleUpdateField}
                                        handleRemoveField={handleRemoveField}
                                        enableTranslation={enableTranslation}
                                        enableDrupalSync={enableDrupalSync}
                                        drupalBundle={drupalBundle}
                                        drupalFields={drupalFields}
                                        drupalFieldMapping={drupalFieldMapping}
                                        setDrupalFieldMapping={setDrupalFieldMapping}
                                        optionTools={optionTools}
                                        projectPlanningEnabled={projectPlanningEnabled}
                                        setAiActionModalFieldIndex={setAiActionModalFieldIndex}
                                        setAiActionPrompt={setAiActionPrompt}
                                        availableSkills={availableSkills}
                                    />
                                ))}
                            </div>
                        </SortableContext>
                    </DndContext>

                    <button
                        onClick={handleAddField}
                        className="btn-gnosi btn-gnosi-primary !text-xs !py-2 !px-4 mt-5"
                    >
                        <Plus size={16} /> {t('schema.add_property')}
                    </button>
                </div>

            </div>
        </div>

        <ConfirmModal
            isOpen={confirmRemoveField.isOpen}
            onClose={() => { setConfirmRemoveField({ isOpen: false, index: null, name: '' }); }}
            onConfirm={executeRemoveField}
            title={t('schema.confirm_remove_field_title', "Delete property")}
            message={t('schema.confirm_remove_field_message', { name: confirmRemoveField.name, defaultValue: "Are you sure you want to delete the property “{{name}}”? This action cannot be undone." })}
            confirmText={t('schema.confirm_remove_field_confirm', "Delete")}
            isDestructive={true}
        />

        <ConfirmModal
            isOpen={toggleConfirm.isOpen}
            onClose={closeToggleConfirm}
            onConfirm={async () => { await toggleConfirm.onConfirm?.(); closeToggleConfirm(); }}
            title={toggleConfirm.title}
            message={toggleConfirm.message}
            confirmText={toggleConfirm.confirmText || t('schema.disable', "Disable")}
            cancelText={t('common.cancel', "Cancel")}
            isDestructive={true}
        />

        <AiActionDialog model={model} />
        </>,
        document.body
    );
}
