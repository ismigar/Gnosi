import React from 'react';
import { VaultTable } from './VaultTable';
import { VaultKanban } from './VaultKanban';
import { VaultGallery } from './VaultGallery';
import { VaultTimeline } from './VaultTimeline';
import { VaultFeed } from './VaultFeed';
import { VaultChart } from './VaultChart';
import { DigitalBrainCalendar } from './DigitalBrainCalendar';
import { VaultViewErrorBoundary } from './VaultViewErrorBoundary';
import { useVaultViewData } from '../../hooks/useVaultViewData';

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
    maxHeight = null,
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
    registerNavApi,
    onExitTop,
    onExitBottom,
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

    // Notes filtrades/ordenades segons la vista. El calendari rep `allNotes` i no
    // aplica ell mateix els filtres de la vista, així que els hi apliquem aquí amb
    // el mateix motor que la resta de vistes (abans els ignorava per complet).
    const { sortedPages: viewFilteredNotes } = useVaultViewData({
        pages: notes,
        schema,
        view: { filters: activeView?.filters || [], sorts: activeView?.sort || { field: 'last_modified', direction: 'desc' }, search: searchTerm },
        searchTerm,
    });

    let body;
    if (t === 'board') {
        body = <VaultKanban {...common} isEmbedded={isEmbedded} />;
    } else if (t === 'gallery') {
        body = <VaultGallery {...common} />;
    } else if (t === 'timeline') {
        body = <VaultTimeline {...common} onUpdateNote={onUpdateNote} />;
    } else if (t === 'chart') {
        body = <VaultChart notes={viewFilteredNotes} schema={schema} activeView={activeView} />;
    } else if (t === 'feed') {
        body = (
            <VaultFeed
                notes={notes}
                schema={schema}
                idToTitle={idToTitle}
                allNotes={allNotes}
                activeView={activeView}
                searchTerm={searchTerm}
                onSearchChange={onSearchChange}
                onNoteSelect={onNoteSelect}
                onDeletePage={onDeletePage}
                onDeleteSelected={onDeleteSelected}
            />
        );
    } else if (t === 'calendar') {
        body = (
            <DigitalBrainCalendar
                allNotes={viewFilteredNotes}
                onNoteSelect={onNoteSelect}
                onDeletePage={onDeletePage}
                onDeleteSelected={onDeleteSelected}
                dateField={activeView?.dateField || ''}
                endDateField={activeView?.endDateField || ''}
                initialView={activeView?.calendarView || 'dayGridMonth'}
                ignoreCalendarFilter
            />
        );
    } else {
        // table / list
        body = (
            <VaultTable
                {...common}
                templates={templates}
                isEmbedded={isEmbedded}
                maxHeight={maxHeight}
                isListView={t === 'list'}
                onOpenParallel={onOpenParallel}
                onCellSaved={onCellSaved}
                onTranslated={onTranslated}
                onUpdateFieldOptions={onUpdateFieldOptions}
                actionRules={actionRules}
                registerNavApi={registerNavApi}
                onExitTop={onExitTop}
                onExitBottom={onExitBottom}
            />
        );
    }

    // Xarxa de seguretat: un throw de render transitori durant el bootstrap en
    // fred (dades/esquema/registry a mig carregar) o un error real en una cel·la
    // no ha de tombar la vista. El boundary mostra un fallback discret i
    // s'auto-recupera quan canvien les dades (resetKeys). Les claus inclouen les
    // referències de `schema`/`notes` (que canvien en arribar les dades) i la
    // identitat de la vista/tipus (canvi de vista o taula).
    return (
        <VaultViewErrorBoundary resetKeys={[t, activeView?.id, schema, notes, allNotes, isEmbedded]}>
            {body}
        </VaultViewErrorBoundary>
    );
}

export default VaultViewBody;
