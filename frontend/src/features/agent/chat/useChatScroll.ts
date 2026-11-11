import { useCallback, useLayoutEffect, useRef } from 'react';

/** Follow new output only while the reader remains near the end of this session. */
export function useChatScroll(sessionKey: string, messages: unknown, visible: boolean) {
    const messagesContainerRef = useRef<HTMLDivElement | null>(null);
    const followingRef = useRef(true);

    const handleMessagesScroll = useCallback(() => {
        const container = messagesContainerRef.current;
        if (!container) return;
        followingRef.current = container.scrollHeight - container.clientHeight - container.scrollTop <= 48;
    }, []);

    useLayoutEffect(() => {
        followingRef.current = true;
    }, [sessionKey]);

    useLayoutEffect(() => {
        const container = messagesContainerRef.current;
        if (visible && followingRef.current && container) {
            // Scroll this panel only. Scrolling the sentinel into view can also
            // move enclosing notebook/page containers, and smooth scrolling can
            // race the next streamed update or the reader's own scroll gesture.
            container.scrollTop = container.scrollHeight;
        }
    }, [sessionKey, messages, visible]);

    return { messagesContainerRef, handleMessagesScroll };
}
