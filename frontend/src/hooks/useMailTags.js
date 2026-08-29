import { createContext, createElement, useContext, useState, useEffect, useCallback } from 'react';
import {
    createMailTag,
    deleteMailTag,
    fetchMailMessageTags,
    fetchMailTags,
    fetchTaggedMailMessages,
    fetchTagsForMailMessages,
    setMailMessageTags,
    updateMailTag,
} from '../shared/api/mail';
import { GnosiApiError } from '../shared/api/errors';

const MailTagsContext = createContext(null);

function legacyHttpError(error, message) {
    return error instanceof GnosiApiError ? new Error(message, { cause: error }) : error;
}

function rethrowLegacyHttpError(error, message) {
    throw legacyHttpError(error, message);
}

async function fallbackOnHttpError(operation, fallback) {
    try {
        return await operation();
    } catch (error) {
        if (error instanceof GnosiApiError) return fallback;
        throw error;
    }
}

function useMailTagsImpl() {
    const [tags, setTags] = useState([]);
    const [loading, setLoading] = useState(false);

    const fetchTags = useCallback(async () => {
        setLoading(true);
        try {
            setTags(await fetchMailTags());
        } catch (e) {
            console.error(legacyHttpError(e, 'Error carregant etiquetes'));
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { fetchTags(); }, [fetchTags]);

    const createTag = useCallback(async ({ name, color }) => {
        let created;
        try {
            created = await createMailTag({ name, color });
        } catch (error) {
            rethrowLegacyHttpError(error, 'Error creant etiqueta');
        }
        setTags(prev => [...prev, created]);
        return created;
    }, []);

    const updateTag = useCallback(async (id, { name, color }) => {
        let updated;
        try {
            updated = await updateMailTag(id, { name, color });
        } catch (error) {
            rethrowLegacyHttpError(error, 'Error actualitzant etiqueta');
        }
        setTags(prev => prev.map(t => t.id === id ? updated : t));
        return updated;
    }, []);

    const deleteTag = useCallback(async (id) => {
        try {
            await deleteMailTag(id);
        } catch (error) {
            rethrowLegacyHttpError(error, 'Error eliminant etiqueta');
        }
        setTags(prev => prev.filter(t => t.id !== id));
    }, []);

    const getMessageTags = useCallback(async (messageId) => {
        return fallbackOnHttpError(() => fetchMailMessageTags(messageId), []);
    }, []);

    const setMessageTags = useCallback(async (messageId, tagIds, metadata = {}) => {
        try {
            return await setMailMessageTags(messageId, {
                tag_ids: tagIds,
                account_email: metadata.account_email || '',
                subject: metadata.subject || '',
                sender: metadata.sender || '',
                date_str: metadata.date || '',
            });
        } catch (error) {
            rethrowLegacyHttpError(error, 'Error assignant etiquetes');
        }
    }, []);

    const getTaggedMessages = useCallback(async (tagId) => {
        return fallbackOnHttpError(
            () => fetchTaggedMailMessages(tagId),
            { tag: null, messages: [] },
        );
    }, []);

    const getBatchMessageTags = useCallback(async (messageIds) => {
        if (!messageIds.length) return {};
        return fallbackOnHttpError(() => fetchTagsForMailMessages(messageIds), {});
    }, []);

    return {
        tags,
        loading,
        fetchTags,
        createTag,
        updateTag,
        deleteTag,
        getMessageTags,
        setMessageTags,
        getTaggedMessages,
        getBatchMessageTags,
    };
}

export function MailTagsProvider({ children }) {
    const value = useMailTagsImpl();
    // createElement avoids JSX in this `.js` file (Vite's React plugin only
    // transforms `.jsx`/`.tsx` by default).
    return createElement(MailTagsContext.Provider, { value }, children);
}

export function useMailTags() {
    const ctx = useContext(MailTagsContext);
    if (!ctx) {
        throw new Error('useMailTags must be used within a <MailTagsProvider>');
    }
    return ctx;
}
