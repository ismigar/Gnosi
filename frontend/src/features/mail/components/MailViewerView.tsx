import { MailCalendarPicker } from './MailCalendarPicker';
import {
  MailViewerContent,
  MailViewerLoading,
} from './MailViewerContent';
import { MailViewerEmpty } from './MailViewerEmpty';
import { MailViewerToolbar } from './MailViewerToolbar';
import type { MailViewerController } from './useMailViewerController';


export function MailViewerView({ controller }: { readonly controller: MailViewerController }) {
  if (!controller.selectedMail) return <MailViewerEmpty />;
  if (controller.loading && !controller.mailData) {
    return <MailViewerLoading controller={controller} />;
  }
  return (
    <div className="flex-1 flex flex-col h-full bg-[var(--bg-primary)] overflow-hidden font-sans">
      <MailViewerToolbar controller={controller} />
      <MailViewerContent controller={controller} />
      <MailCalendarPicker controller={controller} />
    </div>
  );
}
