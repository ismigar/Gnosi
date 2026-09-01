export interface ConfirmationRecord {
  readonly [key: string]: unknown;
  readonly confirmation_id: string;
  readonly details?: unknown;
  readonly summary_key?: string;
}


export interface ConfirmationMessage<C extends ConfirmationRecord = ConfirmationRecord> {
  readonly [key: string]: unknown;
  readonly confirmation?: Partial<C> & { readonly confirmation_id?: string };
  readonly content?: unknown;
  readonly role?: string;
}


export interface AgentChatStorageIdentity {
  readonly userId?: string | null;
  readonly vaultId?: string | null;
  readonly workspaceId?: string | null;
}


type ConfirmationRefresh = () => Promise<void> | void;
type IntervalHandle = ReturnType<typeof globalThis.setInterval>;
type SetIntervalFunction = (
  callback: ConfirmationRefresh,
  delay: number,
) => IntervalHandle;
type ClearIntervalFunction = (handle: IntervalHandle) => void;


export const mergeConfirmationRecords = <C extends ConfirmationRecord>(
  messages: readonly ConfirmationMessage<C>[] | null | undefined,
  confirmations: readonly C[] | null | undefined,
  summaryFor: (confirmation: C) => string,
): ConfirmationMessage<C>[] => {
  const byId = new Map(
    (confirmations ?? []).map((item) => [item.confirmation_id, item] as const),
  );
  const existingIds = new Set<string>();
  const updated = (messages ?? []).map((message): ConfirmationMessage<C> => {
    const confirmationId = message.confirmation?.confirmation_id;
    if (!confirmationId) return message;
    existingIds.add(confirmationId);
    const current = byId.get(confirmationId);
    return current
      ? {
          ...message,
          content: summaryFor(current),
          confirmation: { ...message.confirmation, ...current },
        }
      : message;
  });
  for (const confirmation of confirmations ?? []) {
    if (existingIds.has(confirmation.confirmation_id)) continue;
    updated.push({
      role: 'assistant',
      content: summaryFor(confirmation),
      confirmation,
    });
  }
  return updated;
};


export const confirmationForStorage = <C extends ConfirmationRecord>(
  confirmation: C | null | undefined,
): (C & { readonly details: Record<string, never>; readonly summary_key: string }) | undefined => {
  if (!confirmation) return undefined;
  return {
    ...confirmation,
    details: {},
    summary_key: 'chat.confirmations.summary',
  };
};


export const agentChatStorageScope = ({
  vaultId,
  workspaceId,
  userId,
}: AgentChatStorageIdentity): string => [
  vaultId || 'default',
  workspaceId || 'personal',
  userId || 'personal',
].join(':');


export const CONFIRMATION_REFRESH_MS = 15_000;


export const startConfirmationRefresh = (
  refresh: ConfirmationRefresh,
  setIntervalFn: SetIntervalFunction = globalThis.setInterval,
  clearIntervalFn: ClearIntervalFunction = globalThis.clearInterval,
): (() => void) => {
  void refresh();
  const timer = setIntervalFn(refresh, CONFIRMATION_REFRESH_MS);
  return () => {
    clearIntervalFn(timer);
  };
};
