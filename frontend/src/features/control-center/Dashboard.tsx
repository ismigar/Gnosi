import {Clock3, History, Users, Gauge, Sparkles, ShieldCheck} from 'lucide-react';
import {AppHeader} from '../../shared/ui/layout/AppHeader';
import {SettingsSectionTabs} from '../../shared/ui/settings/SettingsSectionTabs';
import {releaseNotesUrl} from './releases/releaseNotesUrl';
import {APP_VERSION} from './releases/version';
import {useDashboard} from './dashboard/useDashboard';
import {useDashboardKeyboard} from './dashboard/useDashboardKeyboard';
import {SchedulerPanel} from './dashboard/SchedulerPanel';
import { SystemLogsPanel } from './dashboard/SystemLogsPanel';
import { AIActivityPanel } from '../settings/AIActivity';
import { DashboardPaginationControls } from './dashboard/DashboardPaginationControls';
import {MembersPanel} from './dashboard/MembersPanel';
import {TrapsDialog} from './dashboard/TrapsDialog';
import {DirectivesDialog} from './dashboard/DirectivesDialog';
import {DirectiveEditor} from './dashboard/DirectiveEditor';
import {ToolsDialog} from './dashboard/ToolsDialog';
import {AddMemberDialog} from './dashboard/AddMemberDialog';
import {PermissionsDialog} from './dashboard/PermissionsDialog';
import {ConfirmationDialogs} from './dashboard/ConfirmationDialogs';

export default function Dashboard() {
const state = useDashboard();
useDashboardKeyboard(state);
const {t, automationsEnabled, isAdmin, scrollContainerRef, selectedControlTab, setSelectedControlTab, gnosiMode, language} = state;
    return (
        <div className="h-full bg-[var(--bg-primary)] overflow-hidden flex flex-col">
            <AppHeader icon={Gauge} title={t('dashboard.control_center', 'Control Center')}>
                <div className="flex items-center gap-2">
                    <a
                        href={releaseNotesUrl(language, APP_VERSION)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 rounded-md border border-[var(--border-primary)] bg-[var(--bg-tertiary)] px-2 py-1 text-[10px] font-bold uppercase tracking-widest text-[var(--text-secondary)] transition-colors hover:text-[var(--text-primary)]"
                        aria-label={t('release_notes.open_aria', { version: APP_VERSION })}
                    >
                        <Sparkles size={12} aria-hidden="true" />
                        v{APP_VERSION}
                    </a>
                </div>
            </AppHeader>

            <div
                ref={scrollContainerRef}
                tabIndex={0}
                className="flex-1 overflow-y-auto overflow-x-hidden outline-none focus:outline-none bg-[var(--bg-primary)]"
            >
                <div className="w-full max-w-7xl mx-auto p-6 md:p-8 animate-in fade-in duration-300">
                    <div className="w-full">
            {/* Control Center Tabs */}
            {(automationsEnabled || state.aiEnabled || (isAdmin && gnosiMode === 'org')) && <div>
                <SettingsSectionTabs
                    ariaLabel={t('dashboard.control_center')}
                    activeId={selectedControlTab}
                    onChange={setSelectedControlTab}
                    items={[
                        ...((automationsEnabled || state.aiEnabled) ? [
                            { id: 'schedulers', icon: Clock3, label: t('activity.schedules') },
                            { id: 'history', icon: History, label: t('activity.runs') },
                            { id: 'approvals', icon: ShieldCheck, label: t('activity.approvals') },
                        ] : []),
                        ...(isAdmin && gnosiMode === 'org'
                            ? [{ id: 'admin', icon: Users, label: t('dashboard.tab_admin') }]
                            : [])
                    ]}
                />

                {selectedControlTab !== 'admin' && <AIActivityPanel
                    tab={selectedControlTab} aiEnabled={state.aiEnabled} automationsEnabled={automationsEnabled} canEdit={isAdmin}
                    systemDiagnostics={<SystemLogsPanel state={state} />}
                    systemHistoryError={state.historyError}
                    systemPanel={<SchedulerPanel state={state} />} systemHistory={state.taskHistory}
                    systemHistoryMore={<DashboardPaginationControls total={state.taskHistoryTotal} limit={state.HISTORY_LIMIT} page={state.taskHistoryPage} onPageChange={page => { void state.fetchTaskHistory(page); }} loading={state.taskHistoryLoading} />}
                />}

                <MembersPanel state={state} />
            </div>}
        </div>
    </div>

            {/* Modals moved outside animated container for better positioning */}
            {/* Traps Detail Modal */}
            <TrapsDialog state={state} />

            {/* Directives Detail Modal */}
            <DirectivesDialog state={state} />

            {/* Directive Editor Modal */}
            <DirectiveEditor state={state} />

            {/* Tools Detail Modal */}
            <ToolsDialog state={state} />

            {/* Add Member modal */}
            <AddMemberDialog state={state} />

            {/* Modal Permisos Granulars */}
            <PermissionsDialog state={state} />

            <ConfirmationDialogs state={state} />
        </div>
    </div>
);
}
