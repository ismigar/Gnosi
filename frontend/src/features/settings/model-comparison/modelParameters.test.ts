import { describe, expect, it } from 'vitest';
import type { AiModelComparisonEntry } from '../../../shared/api/ai';
import { modelParameterDisclosure, modelParameterMetadata } from './modelParameters';

const model = (name: string, creator = 'OpenAI') => ({ name, slug: name, creator }) as AiModelComparisonEntry;

describe('published parameter counts', () => {
    it('uses disclosed counts instead of the rounded model name', () => {
        expect(modelParameterMetadata(model('gpt-oss-120b (high)'))).toMatchObject({ total: 117, active: 5.1 });
        expect(modelParameterMetadata(model('gpt-oss-20b'))).toMatchObject({ total: 21, active: 3.6 });
    });
    it('does not guess sizes or transfer them to new releases or other creators', () => {
        expect(modelParameterMetadata(model('Unknown 70B'))).toBeNull();
        expect(modelParameterMetadata(model('gpt-oss-120b-v2'))).toBeNull();
        expect(modelParameterMetadata(model('gpt-oss-120b', 'Other'))).toBeNull();
        expect(modelParameterMetadata(model('DeepSeek V3 0324', 'DeepSeek'))).toBeNull();
    });
    it('preserves dated aliases and distinguishes dense and MoE sizes', () => {
        expect(modelParameterMetadata(model("DeepSeek V3 (Dec '24)", 'DeepSeek'))).toMatchObject({ total: 671, active: 37 });
        expect(modelParameterMetadata(model('Devstral Small 2', 'Mistral'))).toMatchObject({ total: 24 });
        expect(modelParameterMetadata(model('Devstral Small 2', 'Mistral'))?.active).toBeUndefined();
    });
});

describe('parameter disclosure and aliases', () => {
    it('uses scheduled official-source updates beyond the bundled catalog', () => {
        const updated = { ...model('New model'), parameter_metadata: {
            status: 'known' as const, total: 27, active: 3,
            source: 'https://huggingface.co/Qwen/New-model', checked_at: '2026-09-20',
        } };
        expect(modelParameterMetadata(updated)).toMatchObject({ total: 27, active: 3, checkedAt: '2026-09-20' });
        expect(modelParameterDisclosure({ ...model('Other new model'), parameter_metadata: {
            status: 'not_published', source: 'https://example.test/official', checked_at: '2026-09-20',
        } })).toMatchObject({ status: 'not_published', checkedAt: '2026-09-20' });
    });

    it('matches manufacturer aliases and effort variants without guessing new releases', () => {
        expect(modelParameterMetadata(model('Qwen3 32B (Reasoning)', 'Qwen'))).toMatchObject({ total: 32.8, checkedAt: '2026-09-19' });
        expect(modelParameterMetadata(model('Qwen/Qwen3-30B-A3B (Non-Thinking)', 'Alibaba'))).toMatchObject({ total: 30.5, active: 3.3 });
        expect(modelParameterMetadata(model('Gemma 3 27B Instruct', 'Google'))).toMatchObject({ total: 27 });
        expect(modelParameterMetadata(model('GLM-4.5', 'Z.ai'))).toMatchObject({ total: 355, active: 32 });
        expect(modelParameterMetadata(model('Qwen3-32B-2507', 'Qwen'))).toBeNull();
        expect(modelParameterMetadata(model('Qwen3 32B', 'Other'))).toBeNull();
    });
    it('distinguishes reviewed undisclosed models from unreviewed ones', () => {
        expect(modelParameterDisclosure(model('Claude Fable 5.1 (Adaptive Reasoning, Max Effort, Default Fallback)', 'Anthropic'))).toMatchObject({ status: 'not_published', checkedAt: '2026-09-19' });
        expect(modelParameterDisclosure(model('GPT-6 Astra (max)'))).toMatchObject({ status: 'not_published' });
        expect(modelParameterDisclosure(model('Claude Future 9', 'Anthropic'))).toEqual({ status: 'pending' });
        expect(modelParameterDisclosure(model('Unknown 70B'))).toEqual({ status: 'pending' });
    });
});
