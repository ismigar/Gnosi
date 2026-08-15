import { describe, expect, it } from 'vitest';

import {
    boundedProcessingMs,
    boundedTransparencyMetadata,
    boundedTurnMetrics,
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

    it('keeps only bounded numeric server timing fields', () => {
        expect(boundedTurnMetrics({
            total_ms: 1_250.4,
            model_ms: -1,
            tools_ms: 12,
            input_tokens: 51_543.9,
            model_calls: 0,
            unexpected: 'ignored',
        })).toEqual({
            total_ms: 1_250,
            tools_ms: 12,
            input_tokens: 51_543,
            model_calls: 0,
        });
        expect(boundedTurnMetrics(null)).toBeNull();
    });

    it('keeps only bounded operational transparency metadata', () => {
        const metadata = boundedTransparencyMetadata({
            plan: {
                plan_id: 'plan-1',
                mode: 'analysis',
                domains: ['reader', ...Array(20).fill('ignored')],
                route: 'Brain',
                execution: 'background',
                allowed_tool_names: ['must-not-be-persisted'],
            },
            privacy: {
                classification: 'private_remote_processing',
                private_source_count: 2,
                private_evidence_to_remote_model: true,
                raw_evidence: 'must-not-be-persisted',
            },
            verification: {
                status: 'passed',
                evidence_count: 64,
                tool_names: ['inventory_context'],
                raw_payload: 'must-not-be-persisted',
            },
            citations: {
                status: 'complete',
                sources: [
                    { citation_id: 'src-1', source_id: 'note-1', title: 'Note one', source_type: 'vault_record', href: '/vault/page/note-1', raw_excerpt: 'private' },
                    { citation_id: 'src-2', source_id: 'bad', title: 'Bad link', source_type: 'source', href: 'javascript:alert(1)' },
                ],
                claims: [
                    { claim_id: 'claim-1', line_index: 0, text: 'Grounded claim', citation_ids: ['src-1', 'unknown'] },
                ],
                raw_payload: 'must-not-be-persisted',
            },
            job: {
                job_id: 'reader:job-1',
                provider: 'reader',
                state: 'failed',
                result_available: false,
                capabilities: { status: true, result: true, resume: true, cancel: true },
                result: 'must-not-be-persisted',
            },
        });

        expect(metadata.plan).toMatchObject({
            plan_id: 'plan-1',
            mode: 'analysis',
            route: 'Brain',
            execution: 'background',
        });
        expect(metadata.plan.domains).toHaveLength(12);
        expect(metadata.plan).not.toHaveProperty('allowed_tool_names');
        expect(metadata.privacy).not.toHaveProperty('raw_evidence');
        expect(metadata.verification).not.toHaveProperty('raw_payload');
        expect(metadata.citations).toMatchObject({
            status: 'complete',
            claim_count: 1,
            source_count: 1,
        });
        expect(metadata.citations.claims[0].citation_ids).toEqual(['src-1']);
        expect(metadata.citations.sources[0]).not.toHaveProperty('raw_excerpt');
        expect(metadata.citations.sources[1].href).toBe('');
        expect(metadata.citations).not.toHaveProperty('raw_payload');
        expect(metadata.job).toMatchObject({
            status: 'failed',
            result_available: false,
            capabilities: { status: true, result: true, resume: true, cancel: true },
        });
        expect(metadata.job).not.toHaveProperty('result');
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
                timings: { total_ms: 1_200, tool_calls: 1 },
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
                timings: { total_ms: 1_200, tool_calls: 1 },
                feedback: 'up',
                saved: true,
            },
        ]);
    });
});
