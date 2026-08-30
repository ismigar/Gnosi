import {useEffect} from 'react';
import {subscribeWindowEvent} from '../../../shared/platform/browser-events';
import type {DashboardState} from './useDashboard';
export function useDashboardKeyboard({isAddMemberModalOpen, isPermissionsModalOpen, isTrapsModalOpen, isDirectivesModalOpen, isToolsModalOpen, isReleaseNotesOpen, editingDirective, scrollContainerRef, setIsAddMemberModalOpen, setIsPermissionsModalOpen, setIsTrapsModalOpen, setIsDirectivesModalOpen, setIsToolsModalOpen, setEditingDirective, selectedMember, handleSaveDirective, handleAddMember, handleUpdatePermissions}: DashboardState) {
    // Keyboard scrolling support
    useEffect(() => {
        const handleScrollKeyDown = (e: KeyboardEvent) => {
            const anyModalOpen = isAddMemberModalOpen || isPermissionsModalOpen || isTrapsModalOpen || isDirectivesModalOpen || isToolsModalOpen || isReleaseNotesOpen || editingDirective;
            if (anyModalOpen) return;

            const active = document.activeElement;
            const isInput = active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.tagName === 'SELECT' || (active instanceof HTMLElement && active.isContentEditable));
            if (isInput) return;

            if (!scrollContainerRef.current) return;

            if (e.key === 'ArrowDown') {
                e.preventDefault();
                scrollContainerRef.current.scrollBy({ top: 80, behavior: 'smooth' });
            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                scrollContainerRef.current.scrollBy({ top: -80, behavior: 'smooth' });
            } else if (e.key === 'PageDown' || (e.key === ' ' && !e.shiftKey)) {
                e.preventDefault();
                scrollContainerRef.current.scrollBy({ top: scrollContainerRef.current.clientHeight * 0.8, behavior: 'smooth' });
            } else if (e.key === 'PageUp' || (e.key === ' ' && e.shiftKey)) {
                e.preventDefault();
                scrollContainerRef.current.scrollBy({ top: -scrollContainerRef.current.clientHeight * 0.8, behavior: 'smooth' });
            } else if (e.key === 'Home') {
                e.preventDefault();
                scrollContainerRef.current.scrollTo({ top: 0, behavior: 'smooth' });
            } else if (e.key === 'End') {
                e.preventDefault();
                scrollContainerRef.current.scrollTo({ top: scrollContainerRef.current.scrollHeight, behavior: 'smooth' });
            }
        };

        return subscribeWindowEvent('keydown', handleScrollKeyDown);
    }, [isAddMemberModalOpen, isPermissionsModalOpen, isTrapsModalOpen, isDirectivesModalOpen, isToolsModalOpen, isReleaseNotesOpen, editingDirective, scrollContainerRef]);

    // Unified keyboard handler for all Dashboard modals
    useEffect(() => {
        const anyModalOpen = isAddMemberModalOpen || isPermissionsModalOpen || isTrapsModalOpen || isDirectivesModalOpen || isToolsModalOpen || editingDirective;
        if (!anyModalOpen) return;

        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                setIsAddMemberModalOpen(false);
                setIsPermissionsModalOpen(false);
                setIsTrapsModalOpen(false);
                setIsDirectivesModalOpen(false);
                setIsToolsModalOpen(false);
                setEditingDirective(null);
            } else if (e.key === 'Enter') {
                if (document.activeElement?.tagName === 'TEXTAREA') return;

                // If we're editing a directive, could Enter save it?
                // We usually prefer it not to close if we're editing text, but the requirement is Enter = Confirm.
                // In this case, since there's a Sauve button, we leave it like this.
                if (editingDirective) void handleSaveDirective();
                else if (isAddMemberModalOpen) void handleAddMember();
                else if (isPermissionsModalOpen && selectedMember) void handleUpdatePermissions(selectedMember.user_id, selectedMember.permissions, selectedMember.role);
            }
        };
        return subscribeWindowEvent('keydown', handleKeyDown);
    }, [isAddMemberModalOpen, isPermissionsModalOpen, isTrapsModalOpen, isDirectivesModalOpen, isToolsModalOpen, editingDirective, selectedMember, handleAddMember, handleSaveDirective, handleUpdatePermissions, setIsAddMemberModalOpen, setIsPermissionsModalOpen, setIsTrapsModalOpen, setIsDirectivesModalOpen, setIsToolsModalOpen, setEditingDirective]);


}
