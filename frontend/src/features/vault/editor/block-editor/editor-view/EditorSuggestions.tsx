import { SuggestionMenuController } from '@blocknote/react';
import { slashSuggestions } from './slashItems';
import { wikiSuggestions } from './wikiSuggestions';
import { transclusionSuggestions } from './transclusionSuggestions';
import { mentionSuggestions } from './mentionSuggestions';
import type { LinkMenuInputs, MentionMenuInputs, SlashMenuInputs } from './types';

export function EditorSuggestions(props: LinkMenuInputs & MentionMenuInputs & SlashMenuInputs) {
    return <>
        <SuggestionMenuController triggerCharacter="/" getItems={query => slashSuggestions(query, props)} />
        <SuggestionMenuController triggerCharacter="[" getItems={query => wikiSuggestions(query, props)} />
        <SuggestionMenuController triggerCharacter="!" getItems={query => transclusionSuggestions(query, props)} />
        <SuggestionMenuController triggerCharacter="@" getItems={query => mentionSuggestions(query, props)} />
    </>;
}
