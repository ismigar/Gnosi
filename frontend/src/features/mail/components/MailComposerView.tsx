import { Forward, Reply, ReplyAll, Send, X } from 'lucide-react';
import type { ReactNode } from 'react';

import { MailAvailabilityOverlay } from './MailAvailabilityOverlay';
import { MailComposerDialogs } from './MailComposerDialogs';
import { MailComposerFields } from './MailComposerFields';
import { MailComposerToolbar } from './MailComposerToolbar';
import type { MailComposerController } from './useMailComposerController';


function composerHeading(controller: MailComposerController): {
  readonly icon: ReactNode;
  readonly label: string;
} {
  if (controller.mode === 'reply') {
    return { icon: <Reply size={16} />, label: controller.t('mail.reply_title') };
  }
  if (controller.mode === 'reply_all') {
    return {
      icon: <ReplyAll size={16} />,
      label: controller.t('mail.reply_all_title'),
    };
  }
  if (controller.mode === 'forward') {
    return {
      icon: <Forward size={16} />,
      label: controller.t('mail.forward_title'),
    };
  }
  return { icon: <Send size={16} />, label: controller.t('mail.new_message') };
}


interface MailComposerViewProps {
  readonly controller: MailComposerController;
}


export function MailComposerView({ controller }: MailComposerViewProps) {
  const heading = composerHeading(controller);
  return (
    <div
      className="relative flex h-full animate-in flex-col bg-[var(--bg-primary)] slide-in-from-right-4 duration-300"
      onKeyDown={controller.handleRootKeyDown}
    >
      <div className="sticky top-0 z-20 flex h-16 items-center justify-between border-b border-[var(--border-primary)] bg-[var(--bg-primary)]/80 px-6 backdrop-blur-md">
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-[var(--gnosi-blue)] text-white">
            {heading.icon}
          </div>
          <h2 className="font-bold text-[var(--text-primary)]">{heading.label}</h2>
        </div>
        <button
          type="button"
          onClick={controller.handleCloseRequest}
          className="rounded-xl p-2 text-[var(--text-secondary)] transition-all hover:bg-[var(--bg-secondary)]"
        >
          <X size={20} />
        </button>
      </div>
      <MailComposerFields controller={controller} />
      <MailComposerToolbar controller={controller} />
      <MailComposerDialogs controller={controller} />
      <MailAvailabilityOverlay controller={controller} />
    </div>
  );
}
