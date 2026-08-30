import type { RefObject } from 'react';
import type { TFunction } from 'i18next';
import type { DefaultReactSuggestionItem } from '@blocknote/react';
import type { EffectiveTheme } from '../../../../../shared/hooks/useTheme';
import type { fetchContacts } from '../../../../../shared/api/contacts';
import type { VaultEditorContextValue } from '../../../../../shared/editor/VaultEditorContext';
import type { IconPickerProps } from '../../IconPicker';
import type { InsertContentResult } from '../../../content/InsertContentModal';
import type { InsertContentTab } from '../../../content/insert-content/insertContentTypes';
import type { AiGenerateRequest } from '../../AIGenerateModal';
import type { ContextualLinkPasteMenuProps } from '../../ContextualLinkPasteMenu';
import type { EditorBlock, GnosiEditor } from '../schema';

/** BlockNote discards command results; some application commands are asynchronous. */
export type EditorMenuItem = Omit<DefaultReactSuggestionItem, 'onItemClick'> & {
    readonly onItemClick: () => unknown;
};

export interface LinkableNote {
    readonly id: string;
    readonly title: string;
    readonly aliases?: readonly string[];
}

export interface MenuTable {
    readonly id: string;
    readonly name?: string | null;
}

export interface NoteHeading {
    readonly title?: string | null;
    readonly path?: string | null;
    readonly level?: number | null;
    readonly kind?: string | null;
    readonly preview?: string | null;
}

export interface CreateMissingLink {
    readonly rawTitle: string;
    readonly tableId: string | null;
    readonly mode: 'wiki' | 'transclusion';
    readonly section: string;
}

export interface LinkMenuInputs {
    readonly t: TFunction;
    readonly normalizedLinkableNotes: readonly LinkableNote[];
    readonly allTables: readonly MenuTable[];
    readonly normalizePendingLinkTitle: (rawTitle: string) => string;
    readonly formatNoteDisambiguator: (id: string) => string;
    readonly createMissingPageAndInsertLink: (input: CreateMissingLink) => void | Promise<void>;
    readonly getNoteHeadings: (id: string) => Promise<readonly NoteHeading[]>;
    readonly insertWikiLink: (title: string, section?: string, targetId?: string, rawQuery?: string) => void;
    readonly insertTransclusion: (id: string, title: string, section: string) => void;
}

export interface InsertContentRequest {
    readonly initialFile?: File | null;
    readonly initialTab?: InsertContentTab;
}

export interface PendingInsert extends InsertContentRequest {
    readonly resolve: (result: InsertContentResult) => void;
    readonly reject: (error: Error) => void;
}

export interface SlashMenuInputs {
    readonly editor: GnosiEditor;
    readonly t: TFunction;
    readonly allTables: readonly MenuTable[];
    readonly openInlineIconPicker: () => void;
    readonly capturePageViewAnchor: (id: string | null) => void;
    readonly onOpenPageViewModal?: ((tableId: string) => void) | null;
    readonly requestInsertContent: (request: InsertContentRequest) => Promise<InsertContentResult>;
    readonly applyInsertResult: (result: InsertContentResult, anchor: EditorBlock) => void;
    readonly insertWikiLink: LinkMenuInputs['insertWikiLink'];
    readonly setIsCitePickerOpen: (open: boolean) => void;
    readonly openAICommand: (mode: 'free' | 'continue' | 'summarize') => void;
    readonly setLinkCardCtx: (context: { readonly editor: GnosiEditor } | null) => void;
}

export interface MentionMenuInputs {
    readonly editor: GnosiEditor;
    readonly t: TFunction;
    readonly loadContacts: typeof fetchContacts;
}

export interface EditorModalInputs {
    readonly editor: GnosiEditor;
    readonly t: TFunction;
    readonly inlineIconPickerAnchor: IconPickerProps['anchorRect'];
    readonly closeInlineIconPicker: () => void;
    readonly insertInlineIcon: IconPickerProps['onSelectIcon'];
    readonly pendingInsert: InsertContentRequest | null;
    readonly getPendingInsert: () => PendingInsert | null;
    readonly setPendingInsert: (pending: PendingInsert | null) => void;
    readonly tableId: string | null;
    readonly isCitePickerOpen: boolean;
    readonly setIsCitePickerOpen: (open: boolean) => void;
    readonly insertCitation: (key: string) => void;
    readonly aiRequest: AiGenerateRequest | null;
    readonly setAiRequest: (request: AiGenerateRequest | null) => void;
    readonly insertGeneratedMarkdown: (markdown: string, anchor: unknown) => unknown;
    readonly linkCardCtx: { readonly editor: GnosiEditor } | null;
    readonly setLinkCardCtx: SlashMenuInputs['setLinkCardCtx'];
    readonly doLinkCard: (value: string) => unknown;
    readonly linkPasteCtx: { readonly position: ContextualLinkPasteMenuProps['position'] } | null;
    readonly applyContextualLinkPaste: ContextualLinkPasteMenuProps['onChoose'];
    readonly closeContextualLinkPaste: ContextualLinkPasteMenuProps['onClose'];
}

/** Parent owns all state, persistence, refs and native capture/drop effects. */
export interface EditorViewProps extends SlashMenuInputs, LinkMenuInputs, MentionMenuInputs, EditorModalInputs {
    readonly providerValue: VaultEditorContextValue;
    readonly editorWrapperRef: RefObject<HTMLDivElement | null>;
    readonly isEditable: boolean;
    readonly effectiveTheme: EffectiveTheme;
    readonly spellEnabled: boolean;
    readonly noteFilename: string | null;
    readonly onLangDetected?: (language: string) => void;
    readonly spellLang?: string | null;
    readonly detectEmbeddableUrl: (text: string) => 'youtube' | 'vimeo' | 'pdf' | null;
}
