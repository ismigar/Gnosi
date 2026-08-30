import ConfirmModal from '../../../components/ConfirmModal';
import { MailListBody } from './mail-list/MailListBody';
import { MailListHeader } from './mail-list/MailListHeader';
import { MailListMenus } from './mail-list/MailListMenus';
import type { MailListProps } from './mail-list/mailListTypes';
import { useMailListController } from './mail-list/useMailListController';


export type { MailListProps } from './mail-list/mailListTypes';


export default function MailList(props: MailListProps) {
  const { setListElement, setSentinelElement, view: controller } = useMailListController(props);
  return (
    <>
      <div className="flex-1 flex flex-col h-full bg-[var(--bg-primary)] overflow-hidden">
        <MailListHeader
          account={props.account}
          activeView={props.activeView}
          controller={controller}
          folder={props.folder}
          onToggleMailboxSidebar={props.onToggleMailboxSidebar}
          showMailboxSidebar={props.showMailboxSidebar}
        />
        <MailListBody
          accountEmail={props.account?.email}
          controller={controller}
          listElementRef={setListElement}
          selectedMailId={props.selectedMailId}
          sentinelElementRef={setSentinelElement}
        />
        <MailListMenus controller={controller} />
      </div>
      <ConfirmModal
        isOpen={controller.confirmConfig.isOpen}
        message={controller.confirmConfig.message}
        onClose={() => {
          controller.setConfirmConfig({ isOpen: false });
        }}
        onConfirm={controller.confirmConfig.onConfirm ?? (() => undefined)}
        title={controller.confirmConfig.title}
      />
    </>
  );
}
