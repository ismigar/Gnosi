import { describe, expect, it } from 'vitest';

import {
    boundedProcessingMs,
    effectiveMessageTimingMs,
    boundedTransparencyMetadata,
    boundedTurnPlan,
    boundedTurnMetrics,
    conversationRewindPlan,
    mergeCanonicalMessageMetadata,
    mergeNotebookConversation,
    processingSeconds,
    isRetryableErrorCode,
} from './agentChatMessageUtils';

function requiredValue<Value>(
    value: Value | null | undefined,
    label: string,
): Value {
    if (value === null || value === undefined) {
        throw new Error(`Expected ${label}`);
    }
    return value;
}

describe('notebook canonical transcript merge', () => {
    it('keeps a local failed turn while the canonical checkpoint is still empty', () => {
        const local = [{ role: 'assistant', content: 'Provider unavailable', retryable: true }];
        expect(mergeNotebookConversation([], local)).toBe(local);
        expect(mergeNotebookConversation(
            [{ role: 'user', content: 'Question' }],
            local,
        )).toEqual([{ role: 'user', content: 'Question' }]);
    });
});

describe('assistant message presentation metadata', () => {
    it('formats bounded elapsed time in one decimal second precision', () => {
        expect(processingSeconds(1)).toBe(0);
        expect(processingSeconds(1_001)).toBe(1);
        expect(processingSeconds(-1)).toBeNull();
        expect(processingSeconds(null)).toBeNull();
        expect(processingSeconds(1_500)).toBe(1.5);
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
    it('bounds the universal turn budget before displaying it', () => {
        const plan = requiredValue(boundedTurnPlan({
            budgets: {
                timeout_seconds: 99999,
                max_model_calls: 999,
                max_tool_calls: 999,
                max_read_tool_results: 999,
            },
        }), 'bounded turn plan');
        expect(plan.budgets).toEqual({
            timeout_seconds: 3600,
            max_model_calls: 128,
            max_tool_calls: 256,
            max_read_tool_results: 256,
        });
    });
    it('keeps semantic interpretation and capability metadata bounded', () => {
        const plan = requiredValue(boundedTurnPlan({
            interpretation: {
                operation: 'inventory',
                confidence: 3,
                concepts: ['coaching'],
                query_digest: 'private-query-must-not-be-shown',
            },
            capability_broker: {
                broker_version: 'capability-v1',
                candidate_tools: ['inventory_context'],
                guarded_tools: ['delete_page'],
                selection_policy: 'safe',
                discovery: {
                    status: 'attention_required',
                    domains: [{
                        domain: 'calendar',
                        status: 'missing_capability',
                        candidate_tools: [],
                        recommended_action: 'connect_or_assign_skill',
                    }],
                    automatic_install: false,
                    automatic_permission_grant: false,
                },
            },
            deadline: {
                hard_seconds: 120,
                soft_seconds: 100,
                synthesis_reserve_seconds: 20,
                policy: 'synthesize_or_handoff_before_hard_deadline',
            },
            memory: {
                checkpointed: true,
                scope: 'agent_session',
                historical_tool_payloads_excluded: true,
                raw_payload: 'ignored',
            },
        }), 'bounded semantic turn plan');
        const capabilityBroker = requiredValue(
            plan.capability_broker,
            'capability broker',
        );
        const discovery = requiredValue(
            capabilityBroker.discovery,
            'capability discovery',
        );
        const deadline = requiredValue(plan.deadline, 'turn deadline');

        expect(plan.interpretation).toMatchObject({
            operation: 'inventory',
            confidence: 1,
            concepts: ['coaching'],
        });
        expect(plan.interpretation).not.toHaveProperty('query_digest');
        expect(plan.interpretation).not.toHaveProperty('normalized_query');
        expect(capabilityBroker.candidate_tools).toEqual(['inventory_context']);
        expect(discovery.domains[0]).toMatchObject({
            domain: 'calendar',
            status: 'missing_capability',
        });
        expect(deadline.soft_seconds).toBe(100);
        expect(plan.memory).toEqual({
            checkpointed: true,
            scope: 'agent_session',
            historical_tool_payloads_excluded: true,
        });
    });
    it('classifies only bounded transient errors as retryable', () => {
        expect(isRetryableErrorCode(' agent_loop_exhausted ')).toBe(true);
        expect(isRetryableErrorCode('agent_model_unavailable')).toBe(false);
    });
    it('keeps only bounded operational transparency metadata', () => {
        const metadata = boundedTransparencyMetadata({
            plan: {
                plan_id: 'plan-1',
                mode: 'analysis',
                domains: ['reader', ...Array.from({ length: 20 }, () => 'ignored')],
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
                    { citation_id: 'src-1', source_id: 'note-1', title: 'Note one', source_type: 'vault_record', href: '/vault/page/note-1', source_version: 'abc123', version_status: 'exact', raw_excerpt: 'private' },
                    { citation_id: 'src-2', source_id: 'bad', title: 'Bad link', source_type: 'source', href: 'javascript:alert(1)' },
                    { citation_id: 'src-3', source_id: 'chunk-1', title: 'Paper · p. 7', source_type: 'notebook_evidence', href: 'gnosi-cite:?res=resource-1&notebook=notebook-1&revision=3&chunk=chunk-1&page=7' },
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
            quality: {
                score: 85,
                status: 'limited',
                checks: { required_evidence: true, inventory_complete: false },
                failed_checks: ['inventory_complete'],
                response: 'must-not-be-persisted',
            },
            conflicts: {
                status: 'conflicting',
                conflicts: [{
                    conflict_id: 'conflict-1',
                    entity_id: 'record-1',
                    field: 'status',
                    source_names: ['source-a', 'source-b'],
                    value_count: 2,
                    raw_values: ['open', 'closed'],
                }],
            },
            evidence_security: {
                status: 'tainted',
                severity: 'high',
                categories: [{ category: 'tool_coercion', count: 2, source_text: 'private' }],
                authorization_changed: false,
                raw_payload: 'must-not-be-persisted',
            },
        });

        const metadataPlan = requiredValue(metadata.plan, 'metadata plan');
        const citations = requiredValue(metadata.citations, 'metadata citations');
        const conflicts = requiredValue(metadata.conflicts, 'metadata conflicts');
        const evidenceSecurity = requiredValue(
            metadata.evidenceSecurity,
            'metadata evidence security',
        );
        expect(metadataPlan).toMatchObject({
            plan_id: 'plan-1',
            mode: 'analysis',
            route: 'Brain',
            execution: 'background',
        });
        expect(metadataPlan.domains).toHaveLength(12);
        expect(metadataPlan).not.toHaveProperty('allowed_tool_names');
        expect(metadata.privacy).not.toHaveProperty('raw_evidence');
        expect(metadata.verification).not.toHaveProperty('raw_payload');
        expect(citations).toMatchObject({
            status: 'complete',
            claim_count: 1,
            source_count: 1,
        });
        const firstClaim = requiredValue(citations.claims[0], 'first citation claim');
        const firstSource = requiredValue(citations.sources[0], 'first citation source');
        const secondSource = requiredValue(citations.sources[1], 'second citation source');
        const thirdSource = requiredValue(citations.sources[2], 'third citation source');
        expect(firstClaim.citation_ids).toEqual(['src-1']);
        expect(firstSource).not.toHaveProperty('raw_excerpt');
        expect(firstSource).toMatchObject({
            source_version: 'abc123',
            version_status: 'exact',
        });
        expect(secondSource.href).toBe('');
        expect(thirdSource.href).toContain('gnosi-cite:?');
        expect(citations).not.toHaveProperty('raw_payload');
        expect(metadata.job).toMatchObject({
            status: 'failed',
            result_available: false,
            capabilities: { status: true, result: true, resume: true, cancel: true },
        });
        expect(metadata.job).not.toHaveProperty('result');
        expect(metadata.quality).toMatchObject({
            score: 85,
            status: 'limited',
            failed_checks: ['inventory_complete'],
        });
        expect(metadata.quality).not.toHaveProperty('response');
        expect(conflicts.conflicts[0]).not.toHaveProperty('raw_values');
        expect(evidenceSecurity).toMatchObject({
            status: 'tainted',
            severity: 'high',
            authorization_changed: false,
        });
        expect(evidenceSecurity.categories[0]).not.toHaveProperty('source_text');
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
    it('rewinds using legacy turn_id fields too', () => {
        const messages = [
            { role: 'user', content: 'Legacy turn', turn_id: 'turn-legacy' },
            { role: 'assistant', content: 'Legacy answer', turn_id: 'turn-legacy' },
        ];

        expect(conversationRewindPlan(messages, 1)).toEqual({
            beforeTurnId: 'turn-legacy',
            keepMessages: 0,
            localKeepCount: 0,
            prompt: 'Legacy turn',
        });
    });
    it('rewinds using alternative turn identifier fields', () => {
        const messages = [
            { role: 'user', content: 'Alternatiu', turn_ref: 't-1' },
            { role: 'assistant', content: 'Resposta alternativa', turn_ref: 't-1' },
        ];

        expect(conversationRewindPlan(messages, 1)).toEqual({
            beforeTurnId: 't-1',
            keepMessages: 0,
            localKeepCount: 0,
            prompt: 'Alternatiu',
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
    it('reconciles cached metadata by turn id even when message content differs', () => {
        const canonical = [
            { role: 'user', content: 'Current user prompt', turn_id: 'turn-1' },
            { role: 'assistant', content: 'Canonical answer text', turn_id: 'turn-1' },
        ];
        const cached = [
            {
                role: 'user',
                content: 'Old user prompt',
                turn_id: 'turn-1',
                processingMs: 900,
                duration_ms: 900,
            },
            {
                role: 'assistant',
                content: 'Old answer',
                turn_id: 'turn-1',
                timings: { total_ms: 1_050 },
            },
        ];

        expect(mergeCanonicalMessageMetadata(canonical, cached)).toEqual([
            {
                role: 'user',
                content: 'Current user prompt',
                turnId: 'turn-1',
                processingMs: 900,
                turn_id: 'turn-1',
            },
            {
                role: 'assistant',
                content: 'Canonical answer text',
                turnId: 'turn-1',
                processingMs: 1_050,
                timings: { total_ms: 1_050 },
                turn_id: 'turn-1',
            },
        ]);
    });
    it('reconciles using alternate turn id keys when no strict key matches', () => {
        const canonical = [
            { role: 'user', content: 'Prompt nou', turn_ref: 't-2' },
            { role: 'assistant', content: 'Resposta nova', turn_ref: 't-2' },
        ];
        const cached = [
            {
                role: 'user',
                content: 'Pregunta antiga',
                session_id: 't-2',
                processingMs: 1200,
            },
            {
                role: 'assistant',
                content: 'Antiga resposta',
                conversation_id: 't-2',
                processingMs: 2400,
            },
        ];

        expect(mergeCanonicalMessageMetadata(canonical, cached)).toEqual([
            {
                role: 'user',
                content: 'Prompt nou',
                turn_ref: 't-2',
                turnId: 't-2',
                processingMs: 1200,
            },
            {
                role: 'assistant',
                content: 'Resposta nova',
                turn_ref: 't-2',
                turnId: 't-2',
                processingMs: 2400,
                timings: { total_ms: 2400 },
            },
        ]);
    });
    it('uses duration-like aliases when timings are not available', () => {
        const canonical = [
            { role: 'assistant', content: 'Server timed answer' },
        ];
        const cached = [
            {
                role: 'assistant',
                content: 'Server timed answer',
                duration: 2500,
            },
        ];

        expect(mergeCanonicalMessageMetadata(canonical, cached)).toEqual([{
            role: 'assistant',
            content: 'Server timed answer',
            timings: { total_ms: 2500 },
            processingMs: 2500,
        }]);
    });
    it('accepts alternative timing aliases from object payloads', () => {
        const canonical = [
            { role: 'assistant', content: 'Answer with alternate timing fields' },
        ];
        const cached = [
            {
                role: 'assistant',
                content: 'Answer with alternate timing fields',
                timings: {
                    elapsed_seconds: 2.5,
                    model_calls: 2,
                },
            },
        ];

        expect(mergeCanonicalMessageMetadata(canonical, cached)).toEqual([{
            role: 'assistant',
            content: 'Answer with alternate timing fields',
            timings: {
                total_ms: 2_500,
                model_calls: 2,
            },
            processingMs: 2_500,
        }]);
    });
    it('resolves effective timing from alias fields', () => {
        expect(effectiveMessageTimingMs({ processingMs: 1200 })).toBe(1200);
        expect(effectiveMessageTimingMs({ timings: { total_ms: 2400 } })).toBe(2400);
        expect(effectiveMessageTimingMs({ turn_metrics: { total_ms: 900 } })).toBe(900);
        expect(effectiveMessageTimingMs({ totalDurationMs: 1_200 })).toBe(1_200);
        expect(effectiveMessageTimingMs({ processingDurationSec: 1.25 })).toBe(1_250);
        expect(effectiveMessageTimingMs({ responseDuration: 1200 })).toBe(1200);
        expect(effectiveMessageTimingMs({ durationInSeconds: 0.9 })).toBe(900);
        expect(effectiveMessageTimingMs({ duration_ms: 4000 })).toBe(4000);
        expect(effectiveMessageTimingMs({ turnMetrics: { total_ms: 1300 } })).toBe(1300);
        expect(effectiveMessageTimingMs({ duration_seconds: 2.4 })).toBe(2_400);
        expect(effectiveMessageTimingMs({ duration_seconds: '2.4' })).toBe(2_400);
        expect(effectiveMessageTimingMs({ timings: { value: 2.5, unit: 's' } })).toBe(2_500);
        expect(effectiveMessageTimingMs({ timings: { value: '2.5', unit: 's' } })).toBe(2_500);
        expect(effectiveMessageTimingMs({ timings: { value: '2.5', unit: 'sec' } })).toBe(2_500);
        expect(effectiveMessageTimingMs({ timings: { value: '2.5s' } })).toBe(2_500);
        expect(effectiveMessageTimingMs({ timings: '2.5s' })).toBe(2_500);
        expect(effectiveMessageTimingMs({ duration: '5500' })).toBe(5500);
        expect(effectiveMessageTimingMs({ durationSec: 4.2 })).toBe(4_200);
        expect(effectiveMessageTimingMs({ responseSec: 0.75 })).toBe(750);
        expect(effectiveMessageTimingMs({ response_seconds: 1.2 })).toBe(1_200);
        expect(effectiveMessageTimingMs({ processingSecs: 3 })).toBe(3_000);
        expect(effectiveMessageTimingMs({ timingSecs: 0.9 })).toBe(900);
        expect(effectiveMessageTimingMs({ timeSecs: 0.5 })).toBe(500);
        expect(effectiveMessageTimingMs({ seconds: 0.8 })).toBe(800);
        expect(effectiveMessageTimingMs({ timings: { seconds: 0.7 } })).toBe(700);
        expect(effectiveMessageTimingMs({})).toBeNull();
    });
});
