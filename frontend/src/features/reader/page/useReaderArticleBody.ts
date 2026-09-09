import { useEffect, useState } from 'react';

import { fetchReaderArticle, type ReaderArticle } from '../../../shared/api/reader';

interface BodyResult {
    readonly id: number;
    readonly attempt: number;
    readonly body: string;
    readonly failed: boolean;
}

export function useReaderArticleBody(article: ReaderArticle, loadFullContent: boolean) {
    const [result, setResult] = useState<BodyResult | null>(null);
    const [attempt, setAttempt] = useState(0);
    const id = article.id;

    useEffect(() => {
        if (!loadFullContent) return undefined;
        const controller = new AbortController();
        void fetchReaderArticle(id, controller.signal).then((loaded) => {
            if (!controller.signal.aborted) {
                setResult({ id, attempt, body: loaded.full_content || loaded.content || '', failed: false });
            }
        }).catch(() => {
            if (!controller.signal.aborted) setResult({ id, attempt, body: '', failed: true });
        });
        return () => { controller.abort(); };
    }, [id, loadFullContent, attempt]);

    const current = result?.id === id && result.attempt === attempt ? result : null;
    return {
        body: loadFullContent ? current?.body ?? '' : article.full_content || article.content || '',
        loading: loadFullContent && current === null,
        failed: loadFullContent && current?.failed === true,
        retry: () => { setAttempt((value) => value + 1); },
    };
}
