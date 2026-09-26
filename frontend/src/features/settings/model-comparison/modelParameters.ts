import type { AiModelComparisonEntry } from '../../../shared/api/ai';

interface ParameterMetadata {
    /** Billions of parameters (10^9), not file size or RAM. */
    readonly total: number;
    readonly active?: number;
    readonly source: string;
    readonly checkedAt: string;
    readonly verification?: string;
}

interface PublishedParameters extends Omit<ParameterMetadata, 'checkedAt'> {
    readonly creator: string;
    readonly names: readonly string[];
}

// Manufacturer disclosures checked on 2026-09-19. Exact aliases only: never
// infer a count from a model name, nor propagate one to a later generation.
const PUBLISHED_PARAMETERS: readonly PublishedParameters[] = [
    { creator: 'Alibaba', names: ['Qwen3-4B', 'Qwen3 4B'], total: 4,
        source: 'https://huggingface.co/Qwen/Qwen3-4B' },
    { creator: 'Alibaba', names: ['Qwen3-8B', 'Qwen3 8B'], total: 8.2,
        source: 'https://huggingface.co/Qwen/Qwen3-8B' },
    { creator: 'Alibaba', names: ['Qwen3-14B', 'Qwen3 14B'], total: 14.8,
        source: 'https://huggingface.co/Qwen/Qwen3-14B' },
    { creator: 'Alibaba', names: ['Qwen3-32B', 'Qwen3 32B'], total: 32.8,
        source: 'https://huggingface.co/Qwen/Qwen3-32B' },
    { creator: 'Alibaba', names: ['Qwen3-30B-A3B', 'Qwen3 30B A3B'], total: 30.5, active: 3.3,
        source: 'https://huggingface.co/Qwen/Qwen3-30B-A3B' },
    { creator: 'Alibaba', names: ['Qwen3-235B-A22B-Instruct-2507', 'Qwen3 235B A22B Instruct 2507'], total: 235, active: 22,
        source: 'https://huggingface.co/Qwen/Qwen3-235B-A22B-Instruct-2507' },
    { creator: 'Alibaba', names: ['Qwen3-235B-A22B-Thinking-2507', 'Qwen3 235B A22B Thinking 2507'], total: 235, active: 22,
        source: 'https://huggingface.co/Qwen/Qwen3-235B-A22B-Thinking-2507' },
    { creator: 'Alibaba', names: ['Qwen3-30B-A3B-Instruct-2507', 'Qwen3 30B A3B Instruct 2507'], total: 30.5, active: 3.3,
        source: 'https://huggingface.co/Qwen/Qwen3-30B-A3B-Instruct-2507' },
    { creator: 'Alibaba', names: ['Qwen3-30B-A3B-Thinking-2507', 'Qwen3 30B A3B Thinking 2507'], total: 30.5, active: 3.3,
        source: 'https://huggingface.co/Qwen/Qwen3-30B-A3B-Thinking-2507' },
    { creator: 'Alibaba', names: ['Qwen3-Coder-480B-A35B-Instruct', 'Qwen3 Coder 480B A35B', 'Qwen3 Coder 480B A35B Instruct'], total: 480, active: 35,
        source: 'https://huggingface.co/Qwen/Qwen3-Coder-480B-A35B-Instruct' },
    { creator: 'Alibaba', names: ['Qwen3-Coder-30B-A3B-Instruct', 'Qwen3 Coder 30B A3B', 'Qwen3 Coder 30B A3B Instruct'], total: 30.5, active: 3.3,
        source: 'https://huggingface.co/Qwen/Qwen3-Coder-30B-A3B-Instruct' },
    { creator: 'Alibaba', names: ['QwQ-32B', 'QwQ 32B'], total: 32.5,
        source: 'https://huggingface.co/Qwen/QwQ-32B' },
    { creator: 'Google', names: ['Gemma 3 1B', 'Gemma 3 1B Instruct', 'gemma-3-1b-it'], total: 1,
        source: 'https://ai.google.dev/gemma/docs/core/model_card_3' },
    { creator: 'Google', names: ['Gemma 3 4B', 'Gemma 3 4B Instruct', 'gemma-3-4b-it'], total: 4,
        source: 'https://ai.google.dev/gemma/docs/core/model_card_3' },
    { creator: 'Google', names: ['Gemma 3 12B', 'Gemma 3 12B Instruct', 'gemma-3-12b-it'], total: 12,
        source: 'https://ai.google.dev/gemma/docs/core/model_card_3' },
    { creator: 'Google', names: ['Gemma 3 27B', 'Gemma 3 27B Instruct', 'gemma-3-27b-it'], total: 27,
        source: 'https://ai.google.dev/gemma/docs/core/model_card_3' },
    { creator: 'Mistral', names: ['Mistral-Small-24B-Instruct-2501', 'Mistral Small 3'], total: 24,
        source: 'https://huggingface.co/mistralai/Mistral-Small-24B-Instruct-2501' },
    { creator: 'Mistral', names: ['Mistral-Small-3.1-24B-Instruct-2503', 'Mistral Small 3.1'], total: 24,
        source: 'https://huggingface.co/mistralai/Mistral-Small-3.1-24B-Instruct-2503' },
    { creator: 'Mistral', names: ['Mistral-Small-3.2-24B-Instruct-2506', 'Mistral Small 3.2'], total: 24,
        source: 'https://huggingface.co/mistralai/Mistral-Small-3.2-24B-Instruct-2506' },
    { creator: 'DeepSeek', names: ['DeepSeek-R1', 'DeepSeek R1', "DeepSeek R1 (Jan '25)"], total: 671, active: 37,
        source: 'https://huggingface.co/deepseek-ai/DeepSeek-R1' },
    { creator: 'DeepSeek', names: ['DeepSeek-V3.1', 'DeepSeek V3.1'], total: 671, active: 37,
        source: 'https://huggingface.co/deepseek-ai/DeepSeek-V3.1' },
    { creator: 'NVIDIA', names: ['NVIDIA-Nemotron-3-Nano-30B-A3B-BF16', 'NVIDIA Nemotron 3 Nano 30B A3B', 'Nemotron 3 Nano 30B A3B'], total: 30, active: 3.5,
        source: 'https://huggingface.co/nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B-BF16' },
    { creator: 'Moonshot AI', names: ['Kimi-K2-Instruct', 'Kimi K2', 'Kimi K2 Instruct'], total: 1000, active: 32,
        source: 'https://huggingface.co/moonshotai/Kimi-K2-Instruct' },
    { creator: 'Moonshot AI', names: ['Kimi-K2-Thinking', 'Kimi K2 Thinking'], total: 1000, active: 32,
        source: 'https://huggingface.co/moonshotai/Kimi-K2-Thinking' },
    { creator: 'Z AI', names: ['GLM-4.5', 'GLM 4.5'], total: 355, active: 32,
        source: 'https://huggingface.co/zai-org/GLM-4.5' },
    { creator: 'Z AI', names: ['GLM-4.5-Air', 'GLM 4.5 Air'], total: 106, active: 12,
        source: 'https://huggingface.co/zai-org/GLM-4.5-Air' },

    { creator: 'OpenAI', names: ['gpt-oss-120b'], total: 117, active: 5.1,
        source: 'https://openai.com/index/introducing-gpt-oss/' },
    { creator: 'OpenAI', names: ['gpt-oss-20b'], total: 21, active: 3.6,
        source: 'https://openai.com/index/introducing-gpt-oss/' },
    { creator: 'Mistral', names: ['Devstral 2', 'Devstral-2-123B-Instruct-2512'], total: 123,
        source: 'https://mistral.ai/news/devstral-2-vibe-cli/' },
    { creator: 'Mistral', names: ['Devstral Small 2', 'Devstral-Small-2-24B-Instruct-2512'], total: 24,
        source: 'https://mistral.ai/news/devstral-2-vibe-cli/' },
    { creator: 'DeepSeek', names: ["DeepSeek V3 (Dec '24)", 'DeepSeek-V3'], total: 671, active: 37,
        source: 'https://huggingface.co/deepseek-ai/DeepSeek-V3' },
    { creator: 'Alibaba', names: ['Qwen3 235B A22B', 'Qwen3-235B-A22B'], total: 235, active: 22,
        source: 'https://huggingface.co/Qwen/Qwen3-235B-A22B' },
    { creator: 'Meta', names: ['Llama 4 Maverick', 'Llama-4-Maverick-17B-128E-Instruct'], total: 400, active: 17,
        source: 'https://huggingface.co/meta-llama/Llama-4-Maverick-17B-128E-Instruct' },
    { creator: 'Meta', names: ['Llama 4 Scout', 'Llama-4-Scout-17B-16E-Instruct'], total: 109, active: 17,
        source: 'https://huggingface.co/meta-llama/Llama-4-Scout-17B-16E-Instruct' },
];

const CHECKED_AT = '2026-09-19';

const normalize = (value: string): string => value.toLowerCase().replace(/[^a-z0-9]/g, '');
const baseName = (value: string): string => (value.split('/').pop() ?? value).replace(
    /\s*\((?:non-reasoning|reasoning|non-thinking|thinking|low|medium|high|xhigh|max)\)$/i, '',
);

const creatorKey = (value: string): string => {
    const key = normalize(value);
    return ({ qwen: 'alibaba', alibabacloud: 'alibaba', mistralai: 'mistral',
        moonshot: 'moonshotai', zai: 'zai', zhipuai: 'zai', zhipu: 'zai',
        googledeepmind: 'google' } as Record<string, string>)[key] ?? key;
};

export function modelParameterMetadata(model: AiModelComparisonEntry): ParameterMetadata | null {
    const remote = model.parameter_metadata;
    if (remote?.status === 'known' && typeof remote.total === 'number' && remote.source) {
        return { total: remote.total, ...(typeof remote.active === 'number' ? { active: remote.active } : {}),
            source: remote.source, checkedAt: remote.checked_at ?? '', verification: remote.verification ?? undefined };
    }

    if (remote?.status === 'not_published') return null;
    const names = [model.name, model.slug].map((name) => normalize(baseName(name)));
    const entry = PUBLISHED_PARAMETERS.find((entry) => (
        creatorKey(entry.creator) === creatorKey(model.creator)
        && entry.names.some((name) => names.includes(normalize(name)))
    ));
    return entry ? { ...entry, checkedAt: CHECKED_AT } : null;
}

// These specific model families were reviewed in the official specifications.
// "Not published" means absent from that documentation on checkedAt, not a
// permanent claim about a vendor. Unreviewed releases remain pending.
const UNDISCLOSED_PARAMETERS = [
    { creator: 'Anthropic', names: ['Claude Fable 5.1', 'Claude Opus 5', 'Claude Sonnet 5', 'Claude Haiku 4.5'],
        source: 'https://platform.claude.com/docs/en/models/overview' },
    { creator: 'OpenAI', names: ['GPT-6 Astra', 'GPT-5.6 Sol', 'GPT-5.6 Terra', 'GPT-5.6 Luna', 'GPT-5.5', 'GPT-4o', 'GPT-4o mini', 'GPT-4.1', 'GPT-4.1 mini', 'GPT-4.1 nano', 'o3', 'o3-pro', 'o4-mini'],
        source: 'https://developers.openai.com/api/docs/models' },
    { creator: 'Google', names: ['Gemini 3.8 Flash', 'Gemini 3.7 Flash', 'Gemini 3.6 Flash', 'Gemini 3.5 Flash', 'Gemini 3.5 Flash-Lite', 'Gemini 3.1 Flash-Lite'],
        source: 'https://ai.google.dev/gemini-api/docs/models' },
] as const;

export function modelParameterDisclosure(model: AiModelComparisonEntry): {
    status: 'not_published' | 'pending'; source?: string; checkedAt?: string;
} {

    const remote = model.parameter_metadata;
    if (remote?.status === 'not_published') {
        return { status: 'not_published', source: remote.source ?? undefined, checkedAt: remote.checked_at ?? undefined };
    }
    // Effort/fallback settings do not change the reviewed closed model family.
    const name = normalize(model.name.replace(/\s*\([^)]*\)$/, ''));
    const entry = UNDISCLOSED_PARAMETERS.find((candidate) => (
        creatorKey(candidate.creator) === creatorKey(model.creator)
        && candidate.names.some((alias) => normalize(alias) === name)
    ));
    return entry ? { status: 'not_published', source: entry.source, checkedAt: CHECKED_AT }
        : { status: 'pending' };
}
