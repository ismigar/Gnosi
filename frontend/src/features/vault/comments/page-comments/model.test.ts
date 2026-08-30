import { describe, expect, it } from 'vitest';

import { formatCommentDate, isCommentMutationForbidden } from './model';
import { currentCommentAuthor } from './storage';


class MemoryStorage implements Storage {
    readonly #values = new Map<string, string>();

    get length(): number {
        return this.#values.size;
    }

    clear(): void {
        this.#values.clear();
    }

    getItem(key: string): string | null {
        return this.#values.get(key) ?? null;
    }

    key(index: number): string | null {
        return [...this.#values.keys()][index] ?? null;
    }

    removeItem(key: string): void {
        this.#values.delete(key);
    }

    setItem(key: string, value: string): void {
        this.#values.set(key, value);
    }
}


describe('page comments model', () => {
    it('formats dates and preserves the legacy fallback on locale errors', () => {
        expect(formatCommentDate(null, 'ca')).toBe('');
        const iso = '2026-08-29T12:00:00Z';
        expect(formatCommentDate(iso, 'invalid_locale_')).toBe(iso);
        expect(formatCommentDate(iso, 'ca')).not.toBe(iso);
    });

    it('recognizes direct and response-backed forbidden errors', () => {
        expect(isCommentMutationForbidden({ status: 403 })).toBe(true);
        expect(isCommentMutationForbidden({ response: { status: 403 } })).toBe(true);
        expect(isCommentMutationForbidden({ status: 500 })).toBe(false);
        expect(isCommentMutationForbidden(null)).toBe(false);
    });

    it('derives the author through the typed storage boundary', () => {
        const storage = new MemoryStorage();
        expect(currentCommentAuthor(storage)).toBe('Anònim');
        storage.setItem('gnosi_user_email', 'isabel@example.test');
        expect(currentCommentAuthor(storage)).toBe('isabel');
    });
});
