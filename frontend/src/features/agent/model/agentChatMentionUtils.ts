export interface AgentChatMention {
  readonly id: string;
  readonly label: string;
  readonly token?: string | null;
  readonly type: string;
}


export type VisibleAgentChatMention = Pick<
  AgentChatMention,
  'type' | 'id' | 'label'
>;


export const visibleMentionToken = (label: string): string => `@${label}`;


export const selectedMentionsInText = (
  text: string,
  selectedMentions: readonly AgentChatMention[] | null | undefined,
): VisibleAgentChatMention[] => (
  (selectedMentions ?? [])
    .filter((mention) => Boolean(mention.token && text.includes(mention.token)))
    .map(({ type, id, label }) => ({ type, id, label }))
);
