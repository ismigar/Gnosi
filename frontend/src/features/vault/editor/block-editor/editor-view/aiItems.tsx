import { Sparkles } from 'lucide-react';
import type { EditorMenuItem, SlashMenuInputs } from './types';

export function aiItems({ t, openAICommand }: SlashMenuInputs): EditorMenuItem[] {
    const aiItems: EditorMenuItem[] = [
        {
            title: t('editor.ai_ask', { defaultValue: "Ask AI…" }),
            onItemClick: () => { openAICommand('free'); },
            aliases: ["ia", "ai", "gpt", "assist", "assistent", "genera", "generate", "pregunta", "ask", "sparkle"],
            group: t('editor.ai_group', { defaultValue: "AI" }),
            icon: <Sparkles size={18} />,
            subtext: t('editor.ai_ask_subtext', { defaultValue: "Write an instruction and insert the result" }),
        },
        {
            title: t('editor.ai_continue', { defaultValue: "Continue writing" }),
            onItemClick: () => { openAICommand('continue'); },
            aliases: ["continua", "continue", "segueix", "writing", "ia", "ai"],
            group: t('editor.ai_group', { defaultValue: "AI" }),
            icon: <Sparkles size={18} />,
            subtext: t('editor.ai_continue_subtext', { defaultValue: "AI continues the page text" }),
        },
        {
            title: t('editor.ai_summarize', { defaultValue: "Summarize the page" }),
            onItemClick: () => { openAICommand('summarize'); },
            aliases: ["resumeix", "resum", "summary", "summarize", "tldr", "ia", "ai"],
            group: t('editor.ai_group', { defaultValue: "AI" }),
            icon: <Sparkles size={18} />,
            subtext: t('editor.ai_summarize_subtext', { defaultValue: "Generates a summary of the current content" }),
        },
    ];
    return aiItems;
}
