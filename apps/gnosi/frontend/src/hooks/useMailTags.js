import { createContext, createElement, useContext, useState, useEffect, useCallback } from 'react';

const API = '/api/mail/tags';

const MailTagsContext = createContext(null);

function useMailTagsImpl() {
    const [tags, setTags] = useState([]);
    const [loading, setLoading] = useState(false);

    const fetchTags = useCallback(async () => {
        setLoading(true);
        try {
            const res = await fetch(API);
            if (!res.ok) throw new Error('Error carregant etiquetes');
            setTags(await res.json());
        } catch (e) {
            console.error(e);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { fetchTags(); }, [fetchTags]);

    const createTag = useCallback(async ({ name, color }) => {
        const res = await fetch(API, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, color }),
        });
        if (!res.ok) throw new Error('Error creant etiqueta');
        const created = await res.json();
        setTags(prev => [...prev, created]);
        return created;
    }, []);

    const updateTag = useCallback(async (id, { name, color }) => {
        const res = await fetch(`${API}/${id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, color }),
        });
        if (!res.ok) throw new Error('Error actualitzant etiqueta');
        const updated = await res.json();
        setTags(prev => prev.map(t => t.id === id ? updated : t));
        return updated;
    }, []);

    const deleteTag = useCallback(async (id) => {
        const res = await fetch(`${API}/${id}`, { method: 'DELETE' });
        if (!res.ok) throw new Error('Error eliminant etiqueta');
        setTags(prev => prev.filter(t => t.id !== id));
    }, []);

    const getMessageTags = useCallback(async (messageId) => {
        const res = await fetch(`/api/mail/messages/${encodeURIComponent(messageId)}/tags`);
        if (!res.ok) return [];
        return await res.json();
    }, []);

    const setMessageTags = useCallback(async (messageId, tagIds, metadata = {}) => {
        const res = await fetch(`/api/mail/messages/${encodeURIComponent(messageId)}/tags`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                tag_ids: tagIds,
                account_email: metadata.account_email || '',
                subject: metadata.subject || '',
                sender: metadata.sender || '',
                date_str: metadata.date || '',
            }),
        });
        if (!res.ok) throw new Error('Error assignant etiquetes');
        return await res.json();
    }, []);

    const getTaggedMessages = useCallback(async (tagId) => {
        const res = await fetch(`${API}/${encodeURIComponent(tagId)}/messages`);
        if (!res.ok) return { tag: null, messages: [] };
        return await res.json();
    }, []);

    const getBatchMessageTags = useCallback(async (messageIds) => {
        if (!messageIds.length) return {};
        const res = await fetch('/api/mail/tags/messages/batch', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message_ids: messageIds }),
        });
        if (!res.ok) return {};
        return await res.json();
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
