import type { AgentChatProps } from './agent-chat/agentChatTypes';
import { ChatPanelView } from './agent-chat/ChatPanelView';
import { useAgentChatController } from './agent-chat/useAgentChatController';

export default function AgentChat(props: AgentChatProps) {
  const controller = useAgentChatController(props);
  return <ChatPanelView controller={controller} />;
}
