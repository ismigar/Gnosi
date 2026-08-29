import { MailTagsProvider } from '../hooks/useMailTags';
import { MailPageView } from './mail-page/MailPageView';
import { useMailPageController } from './mail-page/useMailPageController';


function MailPageInner() {
  const controller = useMailPageController();
  return <MailPageView controller={controller} />;
}


export default function MailPage() {
  return (
    <MailTagsProvider>
      <MailPageInner />
    </MailTagsProvider>
  );
}
