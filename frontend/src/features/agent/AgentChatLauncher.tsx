import { lazy, Suspense, useState } from 'react';

import { useFloatingActionDock } from '../../shared/hooks/useFloatingActionDock';
import { ChatDock } from './chat/ChatDock';
import type { AgentChatProps } from './chat/agentChatTypes';

const AgentChat = lazy(() => import('./AgentChat'));

export function AgentChatLauncher(props: AgentChatProps) {
  const [activated, setActivated] = useState(false);
  const [isDockOpen, setIsDockOpen] = useFloatingActionDock();

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
      <AgentChat {...props} initiallyOpen />
    </Suspense>
  );
}
