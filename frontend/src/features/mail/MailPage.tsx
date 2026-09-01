import { MailTagsProvider } from './hooks/useMailTags';
import { MailPageView } from './page/MailPageView';
import { useMailPageController } from './page/useMailPageController';


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
