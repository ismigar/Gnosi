import { MarkdownCodeTextarea } from '../MarkdownCodeTextarea';
import { useMarkdownCode } from './useMarkdownCode';
import type { MarkdownCodeEditorProps } from './codeTypes';

function MarkdownCodeSession(props: MarkdownCodeEditorProps) {
    const { text, textareaRef, ...textareaProps } = useMarkdownCode(props);
    return <div><MarkdownCodeTextarea ref={textareaRef} value={text} {...textareaProps} /></div>;
}

export function MarkdownCodeEditor(props: MarkdownCodeEditorProps) {
    // Flush the old page through its own captured callbacks before a new session
    // starts, even when a caller replaces props without a keyed editor parent.
    return <MarkdownCodeSession key={props.noteFilename ?? ''} {...props} />;
}
