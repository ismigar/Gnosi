import { MailViewerView } from './MailViewerView';
import type { MailViewerProps } from './mailViewerTypes';
import { useMailViewerController } from './useMailViewerController';


export default function MailViewer(props: MailViewerProps) {
  return <MailViewerView controller={useMailViewerController(props)} />;
}
