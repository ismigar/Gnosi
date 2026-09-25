import { useEffect, useState } from 'react';
import { GnosiApiError } from '../../../shared/api/errors';
import { generateAiContent } from '../../../shared/api/ai';
import { useActiveVaultId } from '../../../shared/hooks/useActiveVaultId';
import type { NormalizedSkill } from './aiSettingsUtils';

const cache = new Map<string, string>();
const languages: Record<string, string> = { ca: 'Catalan', en: 'English', es: 'Spanish', fr: 'French' };
export const instructionLanguage = (language?: string): string => (language || 'en').split('-')[0] || 'en';
const literals = (text: string): string[] => text.match(/```[\s\S]*?```|`[^`\n]+`|https?:\/\/[^\s)]+|\{\{[^}]+\}\}|\$\{[^}]+\}/g) || [];

export async function translateInstructions(text: string, language: string, vault: string, signal?: AbortSignal): Promise<string> {
    const key = JSON.stringify([vault, language, text]);
    const cached = cache.get(key);
    if (cached !== undefined) return cached;
    const result = await generateAiContent({ mode: 'translate_instructions', context: text, prompt: null, language: languages[language] || language }, signal);
    const translated = result.content.trim();
    if (!translated || JSON.stringify(literals(text)) !== JSON.stringify(literals(translated))) throw new Error('Instruction translation is incomplete');
    if (!signal?.aborted) {
        if (cache.size >= 100) cache.delete(cache.keys().next().value as string);
        cache.set(key, translated);
    }
    return translated;
}

export function useSkillInstructions(skill: NormalizedSkill, language?: string) {
    const vault = useActiveVaultId() || '';
    const target = instructionLanguage(language);
    const original = skill.instructions || '';
    const key = JSON.stringify([vault, target, original]);
    const [requested, setRequested] = useState('');
    const [result, setResult] = useState({ key: '', text: '', error: false, rateLimited: false, authenticationError: false });
    const [attempt, setAttempt] = useState(0);
    useEffect(() => {
        if (requested !== key || !original) return;
        const controller = new AbortController();
        void translateInstructions(original, target, vault, controller.signal).then(text => {
            if (!controller.signal.aborted) setResult({ key, text, error: false, rateLimited: false, authenticationError: false });
        }).catch((error: unknown) => {
            if (!controller.signal.aborted) setResult({ key, text: '', error: true, authenticationError: error instanceof GnosiApiError && ([401, 403].includes(error.status) || error.message === 'The AI provider rejected the key. Check Settings › AI.'), rateLimited: (error instanceof GnosiApiError && error.status === 429) || (error instanceof Error && /rate.?limit|quota/i.test(error.message)) });
        });
        return () => { controller.abort(); };
    }, [requested, original, target, vault, key, attempt]);
    const current = requested === key && result.key === key ? result : null;
    return {
        text: current?.text || '',
        loading: requested === key && !current,
        error: Boolean(current?.error),
        rateLimited: Boolean(current?.rateLimited),
        authenticationError: Boolean(current?.authenticationError),
        translate: () => { setRequested(key); setResult({ key: '', text: '', error: false, rateLimited: false, authenticationError: false }); setAttempt(value => value + 1); },
    };
}
