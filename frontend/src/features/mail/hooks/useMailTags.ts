import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';

import { GnosiApiError } from '../../../shared/api/errors';
import {
  createMailTag,
  deleteMailTag,
  fetchMailMessageTags,
  fetchMailTags,
  fetchTaggedMailMessages,
  fetchTagsForMailMessages,
  setMailMessageTags,
  updateMailTag,
  type MailMessageTagsInput,
  type MailTag,
  type MailTagCreate,
  type MailTaggedMessages,
  type MailTagsByMessage,
  type MailTagUpdate,
} from '../../../shared/api/mail';


export interface MailMessageTagMetadata {
  readonly account_email?: string;
  readonly date?: string;
  readonly sender?: string;
  readonly subject?: string;
}


export type MailMessageTagsResult = Awaited<
  ReturnType<typeof setMailMessageTags>
>;


export type TaggedMailMessagesResult = MailTaggedMessages | {
  readonly messages: readonly [];
  readonly tag: null;
};


export interface MailTagsContextValue {
  readonly createTag: (input: MailTagCreate) => Promise<MailTag>;
  readonly deleteTag: (id: string) => Promise<void>;
  readonly fetchTags: () => Promise<void>;
  readonly getBatchMessageTags: (
    messageIds: string[],
  ) => Promise<MailTagsByMessage>;
  readonly getMessageTags: (messageId: string) => Promise<string[]>;
  readonly getTaggedMessages: (
    tagId: string,
  ) => Promise<TaggedMailMessagesResult>;
  readonly loading: boolean;
  readonly setMessageTags: (
    messageId: string,
    tagIds: string[],
    metadata?: MailMessageTagMetadata,
  ) => Promise<MailMessageTagsResult>;
  readonly tags: MailTag[];
  readonly updateTag: (
    id: string,
    input: MailTagUpdate,
  ) => Promise<MailTag>;
}


const MailTagsContext = createContext<MailTagsContextValue | null>(null);


function legacyHttpError(error: unknown, message: string): Error {
  if (error instanceof GnosiApiError) return new Error(message, { cause: error });
  return error instanceof Error ? error : new Error(message, { cause: error });
}


function rethrowLegacyHttpError(error: unknown, message: string): never {
  throw legacyHttpError(error, message);
}


async function fallbackOnHttpError<T>(
  operation: () => Promise<T>,
  fallback: T,
): Promise<T> {
  try {
    return await operation();
  } catch (error: unknown) {
    if (error instanceof GnosiApiError) return fallback;
    throw error;
  }
}


function useMailTagsImpl(): MailTagsContextValue {
  const [tags, setTags] = useState<MailTag[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchTags = useCallback(async (): Promise<void> => {
    setLoading(true);
    try {
      setTags(await fetchMailTags());
    } catch (error: unknown) {
      console.error(legacyHttpError(error, 'Error carregant etiquetes'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (active) void fetchTags();
    });
    return () => {
      active = false;
    };
  }, [fetchTags]);

  const createTag = useCallback(async (
    input: MailTagCreate,
  ): Promise<MailTag> => {
    let created: MailTag;
    try {
      created = await createMailTag(input);
    } catch (error: unknown) {
      rethrowLegacyHttpError(error, 'Error creant etiqueta');
    }
    setTags((previous) => [...previous, created]);
    return created;
  }, []);

  const updateTag = useCallback(async (
    id: string,
    input: MailTagUpdate,
  ): Promise<MailTag> => {
    let updated: MailTag;
    try {
      updated = await updateMailTag(id, input);
    } catch (error: unknown) {
      rethrowLegacyHttpError(error, 'Error actualitzant etiqueta');
    }
    setTags((previous) => previous.map((tag) => (
      tag.id === id ? updated : tag
    )));
    return updated;
  }, []);

  const deleteTag = useCallback(async (id: string): Promise<void> => {
    try {
      await deleteMailTag(id);
    } catch (error: unknown) {
      rethrowLegacyHttpError(error, 'Error eliminant etiqueta');
    }
    setTags((previous) => previous.filter((tag) => tag.id !== id));
  }, []);

  const getMessageTags = useCallback(async (
    messageId: string,
  ): Promise<string[]> => fallbackOnHttpError(
    () => fetchMailMessageTags(messageId),
    [],
  ), []);

  const setMessageTags = useCallback(async (
    messageId: string,
    tagIds: string[],
    metadata: MailMessageTagMetadata = {},
  ): Promise<MailMessageTagsResult> => {
    const input: MailMessageTagsInput = {
      account_email: metadata.account_email || '',
      date_str: metadata.date || '',
      sender: metadata.sender || '',
      subject: metadata.subject || '',
      tag_ids: tagIds,
    };
    try {
      return await setMailMessageTags(messageId, input);
    } catch (error: unknown) {
      rethrowLegacyHttpError(error, 'Error assignant etiquetes');
    }
  }, []);

  const getTaggedMessages = useCallback(async (
    tagId: string,
  ): Promise<TaggedMailMessagesResult> => fallbackOnHttpError<
    TaggedMailMessagesResult
  >(
    () => fetchTaggedMailMessages(tagId),
    { messages: [], tag: null },
  ), []);

  const getBatchMessageTags = useCallback(async (
    messageIds: string[],
  ): Promise<MailTagsByMessage> => {
    if (messageIds.length === 0) return {};
    return fallbackOnHttpError(
      () => fetchTagsForMailMessages(messageIds),
      {},
    );
  }, []);

  return {
    createTag,
    deleteTag,
    fetchTags,
    getBatchMessageTags,
    getMessageTags,
    getTaggedMessages,
    loading,
    setMessageTags,
    tags,
    updateTag,
  };
}


interface MailTagsProviderProps {
  readonly children: ReactNode;
}


export function MailTagsProvider({ children }: MailTagsProviderProps) {
  const value = useMailTagsImpl();
  return createElement(MailTagsContext.Provider, { value }, children);
}


export function useMailTags(): MailTagsContextValue {
  const context = useContext(MailTagsContext);
  if (!context) {
    throw new Error('useMailTags must be used within a <MailTagsProvider>');
  }
  return context;
}
