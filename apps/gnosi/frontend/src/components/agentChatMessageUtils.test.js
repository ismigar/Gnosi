import { describe, expect, it } from 'vitest';

import {
    boundedProcessingMs,
    conversationRewindPlan,
    mergeCanonicalMessageMetadata,
    processingSeconds,
} from './agentChatMessageUtils';

describe('assistant message presentation metadata', () => {
    it('formats bounded elapsed time as whole seconds', () => {
        expect(processingSeconds(1)).toBe(1);
        expect(processingSeconds(1_001)).toBe(2);
        expect(processingSeconds(-1)).toBeNull();
        expect(processingSeconds(null)).toBeNull();
        expect(boundedProcessingMs(Number.POSITIVE_INFINITY)).toBeNull();
        expect(boundedProcessingMs(90_000_000)).toBe(86_400_000);
    });

    it('rewinds the complete turn containing either message', () => {
        const messages = [
            { role: 'user', content: 'First', turnId: 'turn-1' },
            { role: 'assistant', content: 'Answer one', turnId: 'turn-1' },
            { role: 'user', content: 'Second', turnId: 'turn-2' },
            { role: 'assistant', content: 'Answer two', turnId: 'turn-2' },
        ];

        expect(conversationRewindPlan(messages, 3)).toEqual({
            beforeTurnId: 'turn-2',
            keepMessages: 2,
            localKeepCount: 2,
            prompt: 'Second',
        });
        expect(conversationRewindPlan(messages, 0)).toMatchObject({
            beforeTurnId: 'turn-1',
            keepMessages: 0,
            localKeepCount: 0,
        });
    });

    it('merges only local presentation fields into canonical content', () => {
        const canonical = [
            { role: 'user', content: 'Question', turn_id: 'server-turn' },
            { role: 'assistant', content: 'Canonical answer', turn_id: 'server-turn' },
        ];
        const cached = [
            { role: 'user', content: 'Question', contentOverride: 'Unsafe' },
            {
                role: 'assistant',
                content: 'Canonical answer',
                processingMs: 1_250,
                feedback: 'up',
                saved: true,
            },
        ];

        expect(mergeCanonicalMessageMetadata(canonical, cached)).toEqual([
            { ...canonical[0], turnId: 'server-turn' },
            {
                ...canonical[1],
                turnId: 'server-turn',
                processingMs: 1_250,
                feedback: 'up',
                saved: true,
            },
        ]);
    });
});
