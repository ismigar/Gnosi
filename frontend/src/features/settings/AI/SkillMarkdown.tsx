import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

const plugins = [remarkGfm];

/** Read-only instructions share the same Markdown presentation as their original. */
export function SkillMarkdown({ instructions }: { readonly instructions: string }) {
    return <div className="ai-skill-markdown">
        <ReactMarkdown remarkPlugins={plugins} skipHtml>{instructions}</ReactMarkdown>
    </div>;
}
