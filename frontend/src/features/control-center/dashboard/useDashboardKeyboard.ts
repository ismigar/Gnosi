import {useKeyboardScroll} from '../../../shared/hooks/useKeyboardScroll';
import {useEffect} from 'react';
import {subscribeWindowEvent} from '../../../shared/platform/browser-events';
import type {DashboardState} from './useDashboard';
export function useDashboardKeyboard({isAddMemberModalOpen, isPermissionsModalOpen, isTrapsModalOpen, isDirectivesModalOpen, isToolsModalOpen, editingDirective, scrollContainerRef, setIsAddMemberModalOpen, setIsPermissionsModalOpen, setIsTrapsModalOpen, setIsDirectivesModalOpen, setIsToolsModalOpen, setEditingDirective}: DashboardState) {
    useKeyboardScroll(scrollContainerRef, {
        modalOpen: Boolean(isAddMemberModalOpen || isPermissionsModalOpen || isTrapsModalOpen || isDirectivesModalOpen || isToolsModalOpen || editingDirective),
    });

    // Unified keyboard handler for all Dashboard modals
    useEffect(() => {
        const anyModalOpen = isAddMemberModalOpen || isPermissionsModalOpen || isTrapsModalOpen || isDirectivesModalOpen || isToolsModalOpen || editingDirective;
        if (!anyModalOpen) return;

        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.defaultPrevented || e.isComposing) return;
            if (e.key === 'Escape') {
                setIsAddMemberModalOpen(false);
                setIsPermissionsModalOpen(false);
                setIsTrapsModalOpen(false);
                setIsDirectivesModalOpen(false);
                setIsToolsModalOpen(false);
                setEditingDirective(null);
            }
        };
        return subscribeWindowEvent('keydown', handleKeyDown);
    }, [isAddMemberModalOpen, isPermissionsModalOpen, isTrapsModalOpen, isDirectivesModalOpen, isToolsModalOpen, editingDirective, setIsAddMemberModalOpen, setIsPermissionsModalOpen, setIsTrapsModalOpen, setIsDirectivesModalOpen, setIsToolsModalOpen, setEditingDirective]);


}
