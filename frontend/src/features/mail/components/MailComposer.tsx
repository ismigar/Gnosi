import { MailComposerView } from './MailComposerView';
import type { MailComposerProps } from './mailComposerTypes';
import { useMailComposerController } from './useMailComposerController';


export default function MailComposer(props: MailComposerProps) {
  return <MailComposerView controller={useMailComposerController(props)} />;
}
