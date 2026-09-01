import ConfirmModal from '../../../shared/ui/dialogs/ConfirmModal';
import type {DashboardState} from './useDashboard';

export function ConfirmationDialogs({state}: {state: DashboardState}) {
const {confirmPurgeHistory, setConfirmPurgeHistory, doPurgeHistory, confirmDeleteDirective, setConfirmDeleteDirective, doDeleteDirective, confirmDeleteMember, setConfirmDeleteMember, doDeleteMember, t, confirmPurgeLogs, setConfirmPurgeLogs, doPurgeLogs} = state;
return <><ConfirmModal
                isOpen={confirmDeleteDirective != null}
                onClose={() => { setConfirmDeleteDirective(null); }}
                onConfirm={doDeleteDirective}
                title={t('common.delete')}
                message={confirmDeleteDirective ? t('dashboard.confirm_delete_item_msg', { type: confirmDeleteDirective.path.includes("pipeline/skills") ? t('dashboard.type_skill') : t('dashboard.type_directive'), name: confirmDeleteDirective.name }) : ''}
                confirmText={t('common.erase')}
                cancelText={t('common.cancel')}
                isDestructive
            />

            <ConfirmModal
                isOpen={confirmPurgeHistory}
                onClose={() => { setConfirmPurgeHistory(false); }}
                onConfirm={doPurgeHistory}
                title={t('dashboard.purge_history_title')}
                message={t('dashboard.confirm_purge_history')}
                confirmText={t('common.erase')}
                cancelText={t('common.cancel')}
                isDestructive
            />

            <ConfirmModal
                isOpen={confirmPurgeLogs}
                onClose={() => { setConfirmPurgeLogs(false); }}
                onConfirm={doPurgeLogs}
                title={t('dashboard.purge_logs_title')}
                message={t('dashboard.confirm_purge_logs')}
                confirmText={t('common.erase')}
                cancelText={t('common.cancel')}
                isDestructive
            />

            <ConfirmModal
                isOpen={confirmDeleteMember != null}
                onClose={() => { setConfirmDeleteMember(null); }}
                onConfirm={doDeleteMember}
                title={t('dashboard.delete_member_title')}
                message={t('dashboard.confirm_delete_member')}
                confirmText={t('common.erase')}
                cancelText={t('common.cancel')}
                isDestructive
            /></>;
}
