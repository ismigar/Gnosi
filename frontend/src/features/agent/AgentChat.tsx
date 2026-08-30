import type { AgentChatProps } from './chat/agentChatTypes';
import { ChatPanelView } from './chat/ChatPanelView';
import { useAgentChatController } from './chat/useAgentChatController';

export default function AgentChat(props: AgentChatProps) {
  const controller = useAgentChatController(props);
  return <ChatPanelView controller={controller} />;
}
