import { lazy, Suspense, useEffect, useState } from 'react';

import { useFloatingActionDock } from '../../shared/hooks/useFloatingActionDock';
import { announceFloatingPanelOpen } from '../../shared/hooks/useExclusiveFloatingPanel';
import { ChatDock } from './chat/ChatDock';
import { subscribeAppEvent } from '../../shared/platform/app-events';
import type { AgentChatProps } from './chat/agentChatTypes';

const AgentChat = lazy(() => import('./AgentChat'));

export function AgentChatLauncher(props: AgentChatProps) {
  const [activated, setActivated] = useState(false);
  const [openRequest, setOpenRequest] = useState<AgentChatProps['openRequest']>();
  const [isDockOpen, setIsDockOpen] = useFloatingActionDock();
  useEffect(() => subscribeAppEvent('gnosi:open-assistant', request => {
    announceFloatingPanelOpen('chat');
    setOpenRequest(request);
    setActivated(true);
  }), []);

  if (!activated) {
    return (
      <ChatDock
        isDockOpen={isDockOpen}
        agentIcon="lucide:Brain:white"
        setIsDockOpen={setIsDockOpen}
        setIsOpen={(isOpen) => { if (isOpen) setActivated(true); }}
      />
    );
  }

  return (
    <Suspense fallback={null}>
      <AgentChat {...props} initiallyOpen openRequest={openRequest} />
    </Suspense>
  );
}
