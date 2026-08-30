import {
    useRef,
    useState,
    type SyntheticEvent,
} from 'react';
import {
    DndContext,
    KeyboardSensor,
    PointerSensor,
    closestCenter,
    useSensor,
    useSensors,
    type DragEndEvent,
    type UniqueIdentifier,
} from '@dnd-kit/core';
import {
    SortableContext,
    sortableKeyboardCoordinates,
    verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { Plus, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { useModalKeyboard } from '../../hooks/useModalKeyboard';
import type { MailView, MailViewCreate } from '../../shared/api/mail';
import {
    FieldRow,
    FilterRow,
    Pills,
    SectionTitle,
} from './MailViewEditorFields';
import {
    ALL_ACTIONS,
    addDefaultFilter,
    createMailViewEditorForm,
    errorMessage,
    removeFilterAt,
    reorderFields,
    toggleAction,
    toggleFieldVisibility,
    updateFilterAt,
    type MailViewEditorForm,
    type MailViewFilter,
} from './mailViewEditorModel';


export interface MailViewEditorProps {
    readonly initialView?: MailView | null;
    readonly onCancel: () => void;
    readonly onSave: (data: MailViewCreate) => unknown;
}


type SetFormValue = <Key extends keyof MailViewEditorForm>(
    key: Key,
    value: MailViewEditorForm[Key],
) => void;


interface MailViewEditorBodyProps {
    readonly form: MailViewEditorForm;
    readonly onAddFilter: () => void;
    readonly onRemoveFilter: (index: number) => void;
    readonly onReorderFields: (
        activeId: UniqueIdentifier,
        overId: UniqueIdentifier,
    ) => void;
    readonly onSetValue: SetFormValue;
    readonly onToggleAction: (value: string) => void;
    readonly onToggleField: (key: string) => void;
    readonly onUpdateFilter: (index: number, updated: MailViewFilter) => void;
}


function MailViewEditorBody({
    form,
    onAddFilter,
    onRemoveFilter,
    onReorderFields,
    onSetValue,
    onToggleAction,
    onToggleField,
    onUpdateFilter,
}: MailViewEditorBodyProps) {
    const { t } = useTranslation();
    const dndSensors = useSensors(
        useSensor(PointerSensor),
        useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
    );
    const handleFieldDragEnd = ({ active, over }: DragEndEvent): void => {
        if (over === null || active.id === over.id) return;
        onReorderFields(active.id, over.id);
    };

    return (
        <div className="overflow-y-auto flex-1 px-5 py-4 space-y-5">
            <div>
                <SectionTitle>{t('mail_view_editor.section_name', 'Name')}</SectionTitle>
                <input
                    className="w-full text-[13px] bg-[var(--bg-secondary)] border border-[var(--border-primary)] rounded-lg px-3 py-2 text-[var(--text-primary)] placeholder-[var(--text-tertiary)] focus:outline-none focus:border-[var(--gnosi-blue)]"
                    data-autofocus="true"
                    onChange={(event) => {
                        onSetValue('name', event.target.value);
                    }}
                    placeholder={t(
                        'mail_view_editor.name_placeholder',
                        'E.g.: Newsletters, Work...',
                    )}
                    type="text"
                    value={form.name}
                />
            </div>

            <div>
                <SectionTitle>
                    {t('mail_view_editor.section_fields', 'Visible fields')}
                </SectionTitle>
                <div className="border border-[var(--border-primary)] rounded-xl overflow-hidden">
                    <DndContext
                        collisionDetection={closestCenter}
                        onDragEnd={handleFieldDragEnd}
                        sensors={dndSensors}
                    >
                        <SortableContext
                            items={form.fields.map((field) => field.key)}
                            strategy={verticalListSortingStrategy}
                        >
                            {form.fields.map((field) => (
                                <FieldRow
                                    field={field}
                                    key={field.key}
                                    onToggle={onToggleField}
                                />
                            ))}
                        </SortableContext>
                    </DndContext>
                </div>
            </div>

            <div>
                <div className="flex items-center justify-between mb-2">
                    <SectionTitle>{t('view.tab_filters', 'Filters')}</SectionTitle>
                    {form.filters.length > 1 && (
                        <Pills
                            onChange={(value) => {
                                onSetValue('filter_logic', value);
                            }}
                            options={[
                                {
                                    value: 'AND',
                                    label: t('mail_view_editor.logic_and', 'AND'),
                                },
                                {
                                    value: 'OR',
                                    label: t('mail_view_editor.logic_or', 'OR'),
                                },
                            ]}
                            value={form.filter_logic}
                        />
                    )}
                </div>
                <div className="space-y-2">
                    {form.filters.map((filter, index) => (
                        <FilterRow
                            filter={filter}
                            index={index}
                            key={index}
                            onChange={onUpdateFilter}
                            onRemove={onRemoveFilter}
                        />
                    ))}
                </div>
                <button
                    className="mt-2 flex items-center gap-1.5 text-[12px] text-[var(--gnosi-blue)] hover:opacity-80 transition-opacity font-medium"
                    onClick={onAddFilter}
                    type="button"
                >
                    <Plus size={13} /> {t('view.add_filter', 'Add filter')}
                </button>
            </div>

            <div className="grid grid-cols-2 gap-4">
                <div>
                    <SectionTitle>
                        {t('mail_view_editor.section_group_by', 'Group by')}
                    </SectionTitle>
                    <select
                        className="w-full text-[12px] bg-[var(--bg-secondary)] border border-[var(--border-primary)] rounded-lg px-3 py-2 text-[var(--text-primary)]"
                        onChange={(event) => {
                            onSetValue('group_by', event.target.value);
                        }}
                        value={form.group_by}
                    >
                        <option value="none">{t('table.none', 'None')}</option>
                        <option value="date">{t('mail.date_label', 'Date')}</option>
                        <option value="sender">
                            {t('mail_view_editor.option_sender', 'Sender')}
                        </option>
                        <option value="category">
                            {t('mail_view_editor.field_category', 'Category')}
                        </option>
                        <option value="label">
                            {t('mail_view_editor.option_label', 'Label')}
                        </option>
                    </select>
                </div>
                <div>
                    <SectionTitle>
                        {t('mail_view_editor.section_sort_by', 'Sort by')}
                    </SectionTitle>
                    <div className="flex gap-1">
                        <select
                            className="flex-1 text-[12px] bg-[var(--bg-secondary)] border border-[var(--border-primary)] rounded-lg px-3 py-2 text-[var(--text-primary)]"
                            onChange={(event) => {
                                onSetValue('sort_by', event.target.value);
                            }}
                            value={form.sort_by}
                        >
                            <option value="date">{t('mail.date_label', 'Date')}</option>
                            <option value="sender">
                                {t('mail_view_editor.option_sender', 'Sender')}
                            </option>
                            <option value="subject">
                                {t('mail.subject_label', 'Subject')}
                            </option>
                        </select>
                        <button
                            className="px-2.5 text-[13px] bg-[var(--bg-secondary)] border border-[var(--border-primary)] rounded-lg text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
                            onClick={() => {
                                onSetValue(
                                    'sort_dir',
                                    form.sort_dir === 'asc' ? 'desc' : 'asc',
                                );
                            }}
                            title={form.sort_dir === 'asc'
                                ? t('view.asc', 'Ascending')
                                : t('view.desc', 'Descending')}
                            type="button"
                        >
                            {form.sort_dir === 'asc' ? '↑' : '↓'}
                        </button>
                    </div>
                </div>
            </div>

            <div>
                <SectionTitle>
                    {t('mail_view_editor.section_actions', 'Available actions')}
                </SectionTitle>
                <div className="flex flex-wrap gap-2">
                    {ALL_ACTIONS.map((action) => (
                        <button
                            className={`px-3 py-1.5 rounded-lg text-[12px] font-medium border transition-all ${
                                form.actions.includes(action.value)
                                    ? 'bg-[var(--gnosi-blue)] text-white border-[var(--gnosi-blue)]'
                                    : 'bg-[var(--bg-secondary)] text-[var(--text-secondary)] border-[var(--border-primary)] hover:border-[var(--gnosi-blue)]'
                            }`}
                            key={action.value}
                            onClick={() => {
                                onToggleAction(action.value);
                            }}
                            type="button"
                        >
                            {t(action.labelKey, action.label)}
                        </button>
                    ))}
                </div>
            </div>
        </div>
    );
}


export default function MailViewEditor({
    initialView = null,
    onCancel,
    onSave,
}: MailViewEditorProps) {
    const { t } = useTranslation();
    const [form, setForm] = useState<MailViewEditorForm>(() => (
        createMailViewEditorForm(initialView)
    ));
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null | undefined>(null);
    const formRef = useRef<HTMLFormElement>(null);
    useModalKeyboard({ isOpen: true, onClose: onCancel, containerRef: formRef });

    const setFormValue: SetFormValue = (key, value): void => {
        setForm((previous) => ({ ...previous, [key]: value }));
    };
    const handleSubmit = async (
        event: SyntheticEvent<HTMLFormElement, SubmitEvent>,
    ): Promise<void> => {
        event.preventDefault();
        if (!form.name.trim()) {
            setError(t(
                'mail_view_editor.error_name_required',
                'A name is required for the view',
            ));
            return;
        }
        setSaving(true);
        setError(null);
        try {
            await Promise.resolve(onSave(form));
        } catch (caughtError: unknown) {
            setError(errorMessage(caughtError));
        } finally {
            setSaving(false);
        }
    };

    return (
        <div
            className="fixed inset-0 z-[var(--z-modal)] flex items-center justify-center bg-black/40 backdrop-blur-sm"
            onMouseDown={(event) => {
                if (event.target === event.currentTarget) onCancel();
            }}
        >
            <form
                className="w-full max-w-lg bg-[var(--bg-primary)] border border-[var(--border-primary)] rounded-2xl shadow-2xl flex flex-col max-h-[90vh] overflow-hidden"
                onMouseDown={(event) => {
                    event.stopPropagation();
                }}
                onSubmit={(event) => {
                    void handleSubmit(event);
                }}
                ref={formRef}
            >
                <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border-primary)] shrink-0">
                    <h2 className="text-[15px] font-bold text-[var(--text-primary)]">
                        {initialView
                            ? t('mail_view_editor.edit_title', 'Edit view')
                            : t('view.new_view', 'New view')}
                    </h2>
                    <button
                        className="p-1.5 hover:bg-[var(--bg-secondary)] rounded-lg text-[var(--text-secondary)] transition-colors"
                        onClick={onCancel}
                        type="button"
                    >
                        <X size={15} />
                    </button>
                </div>

                <MailViewEditorBody
                    form={form}
                    onAddFilter={() => {
                        setForm(addDefaultFilter);
                    }}
                    onRemoveFilter={(index) => {
                        setForm((previous) => removeFilterAt(previous, index));
                    }}
                    onReorderFields={(activeId, overId) => {
                        setForm((previous) => reorderFields(previous, activeId, overId));
                    }}
                    onSetValue={setFormValue}
                    onToggleAction={(value) => {
                        setForm((previous) => toggleAction(previous, value));
                    }}
                    onToggleField={(key) => {
                        setForm((previous) => toggleFieldVisibility(previous, key));
                    }}
                    onUpdateFilter={(index, updated) => {
                        setForm((previous) => updateFilterAt(previous, index, updated));
                    }}
                />

                <div className="flex items-center justify-between gap-3 px-5 py-4 border-t border-[var(--border-primary)] shrink-0">
                    {error && (
                        <p className="text-[12px] text-red-500 flex-1">{error}</p>
                    )}
                    <div className="flex gap-2 ml-auto">
                        <button
                            className="px-4 py-2 text-[13px] rounded-lg border border-[var(--border-primary)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
                            onClick={onCancel}
                            type="button"
                        >
                            {t('common.cancel', 'Cancel')}
                        </button>
                        <button
                            className="px-4 py-2 text-[13px] font-semibold rounded-lg bg-[var(--gnosi-blue)] text-white hover:opacity-90 transition-opacity disabled:opacity-50"
                            disabled={saving}
                            type="submit"
                        >
                            {saving
                                ? t('view.saving', 'Saving…')
                                : initialView
                                    ? t('common.save', 'Save')
                                    : t('common.create', 'Create')}
                        </button>
                    </div>
                </div>
            </form>
        </div>
    );
}
