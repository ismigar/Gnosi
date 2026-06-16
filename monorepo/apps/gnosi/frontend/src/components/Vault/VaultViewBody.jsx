import React from 'react';
import { VaultTable } from './VaultTable';
import { VaultKanban } from './VaultKanban';
import { VaultGallery } from './VaultGallery';
import { VaultTimeline } from './VaultTimeline';
import { VaultFeed } from './VaultFeed';
import { DigitalBrainCalendar } from './DigitalBrainCalendar';

/**
 * VaultViewBody — render compartit del COS d'una vista de BD segons el seu
 * tipus (taula, llista, kanban, galeria, timeline, feed, calendari).
 *
 * Reutilitzat tant per la taula completa (VaultDashboard) com per la vista
 * embeguda (DbViewEmbed) per evitar duplicar el switch per-tipus i el
 * cablejat de callbacks. NO embolcalla amb cap contenidor: qui el crida posa
 * el seu (alçada/scroll/padding). El tipus `graph` no es gestiona aquí (no té
 * component editable equivalent); el caller el tracta a part.
 *
 * Props: el conjunt de dades de la vista (notes, schema, activeView, …) i els
 * callbacks d'acció. Cada caller passa els seus.
 */
export function VaultViewBody({
    type = 'table',
    notes = [],
    templates = [],
    schema = {},
    idToTitle = {},
    allNotes = [],
    activeView = {},
    isEmbedded = false,
    searchTerm = '',
    actionRules,
    onNoteSelect,
    onOpenParallel,
    onUpdateView,
    onEditSchema,
    onCreateRecord,
    onDeletePage,
    onDeleteSelected,
    onCellSaved,
    onTranslated,
    onUpdateFieldOptions,
    onUpdateNote,
    onSearchChange,
    // Gestió de plantilles (només la fa servir la taula completa; l'embed no
    // les passa). Pass-through a VaultTable.
    onCreateTemplate,
    onDuplicateTemplate,
    onSetDefaultTemplate,
}) {
    const t = String(type || 'table').toLowerCase();

    // Props comunes als components que comparteixen la mateixa signatura.
    const common = {
        notes,
        schema,
        idToTitle,
        allNotes,
        activeView,
        searchTerm,
        onSearchChange,
        onNoteSelect,
        onCreateRecord,
        onDeletePage,
        onDeleteSelected,
        onEditSchema,
        onUpdateView,
    };

    if (t === 'board') {
        return <VaultKanban {...common} isEmbedded={isEmbedded} />;
    }
    if (t === 'gallery') {
        return <VaultGallery {...common} />;
    }
    if (t === 'timeline') {
        return <VaultTimeline {...common} onUpdateNote={onUpdateNote} />;
    }
    if (t === 'feed') {
        return (
            <VaultFeed
                notes={notes}
                schema={schema}
                idToTitle={idToTitle}
                allNotes={allNotes}
                searchTerm={searchTerm}
                onSearchChange={onSearchChange}
                onNoteSelect={onNoteSelect}
                onDeletePage={onDeletePage}
                onDeleteSelected={onDeleteSelected}
            />
        );
    }
    if (t === 'calendar') {
        return (
            <DigitalBrainCalendar
                allNotes={notes}
                onNoteSelect={onNoteSelect}
                onDeletePage={onDeletePage}
                onDeleteSelected={onDeleteSelected}
                dateField={activeView?.dateField || ''}
                endDateField={activeView?.endDateField || ''}
                ignoreCalendarFilter
            />
        );
    }
    // table / list
    return (
        <VaultTable
            {...common}
            templates={templates}
            isEmbedded={isEmbedded}
            isListView={t === 'list'}
            onOpenParallel={onOpenParallel}
            onCellSaved={onCellSaved}
            onTranslated={onTranslated}
            onUpdateFieldOptions={onUpdateFieldOptions}
            onCreateTemplate={onCreateTemplate}
            onDuplicateTemplate={onDuplicateTemplate}
            onSetDefaultTemplate={onSetDefaultTemplate}
            actionRules={actionRules}
        />
    );
}

export default VaultViewBody;
