import { CalendarContextMenu } from '../../../components/Vault/CalendarContextMenu';
import { ConfirmModal } from '../../../components/ConfirmModal';
import { RecurrenceChoiceModal } from '../../../components/Vault/RecurrenceChoiceModal';
import { GlobalSearchModal } from '../../../components/Vault/GlobalSearchModal';
import { vaultPath } from '../../../lib/vaultRouting';
import type { CalendarPageController } from './useCalendarPage';
import { calendarSearchNote } from './calendarSearchModel';

export function CalendarPageDialogs({ controller }: {controller: CalendarPageController}) {
 const { t, contextMenu, closeContextMenu, handleNewEventFromContext, handleDeleteFromContext, isConfirmDeleteOpen, setIsConfirmDeleteOpen, executeDelete, isRecurrenceChoiceOpen, setIsRecurrenceChoiceOpen, isRecurrenceModifyOpen, setIsRecurrenceModifyOpen, executeModify, isGlobalSearchOpen, setIsGlobalSearchOpen, pages, navigate } = controller;
 return <>            {/* Context menu (right click) */}
            <CalendarContextMenu
                isOpen={contextMenu.open}
                position={{ x: contextMenu.x, y: contextMenu.y }}
                onClose={closeContextMenu}
                onNewEvent={handleNewEventFromContext}
                onDeleteEvent={contextMenu.eventId ? handleDeleteFromContext : undefined}
            />

            <ConfirmModal
                isOpen={isConfirmDeleteOpen}
                onClose={() => { setIsConfirmDeleteOpen(false); }}
                onConfirm={() => executeDelete()}
                title={t('calendar.confirm_delete_event_title', "Delete event")}
                message={t('calendar.confirm_delete_event', "Are you sure you want to delete this appointment?")}
                confirmText={t('common.delete', "Delete")}
                isDestructive={true}
            />

            <RecurrenceChoiceModal
                isOpen={isRecurrenceChoiceOpen}
                onClose={() => { setIsRecurrenceChoiceOpen(false); }}
                onConfirm={executeDelete}
                title={t('calendar.recurrent_delete_title', "Delete recurring event")}
                message={t('calendar.recurrent_delete_msg', "This is a recurring event. What do you want to delete?")}
                actionType="delete"
            />

            <RecurrenceChoiceModal
                isOpen={isRecurrenceModifyOpen}
                onClose={() => { setIsRecurrenceModifyOpen(false); }}
                onConfirm={executeModify}
                title={t('calendar.recurrent_modify_title', "Modify recurring event")}
                message={t('calendar.recurrent_modify_msg', "This is a recurring event. How do you want to apply the changes?")}
                actionType="modify"
            />
            <GlobalSearchModal
                isOpen={isGlobalSearchOpen}
                onClose={() => { setIsGlobalSearchOpen(false); }}
                allNotes={pages.map(calendarSearchNote)}
                onNoteSelect={(id) => {
                    void navigate(vaultPath('knowledge', `page/${encodeURIComponent(id)}`));
                    setIsGlobalSearchOpen(false);
                }}
            />
</>;
}
