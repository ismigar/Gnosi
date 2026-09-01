import type { ComponentProps } from 'react';
import { act } from 'react';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { mountTestComponent } from '../../../../../../tests/mount-react';
import type { IconPickerProps } from '../../IconPicker';
import type { InsertContentModalProps, InsertContentResult } from '../../../content/InsertContentModal';
import type { CitePicker } from '../../../../literature/records/CitePicker';
import type AIGenerateModal from '../../AIGenerateModal';
import type { PromptModalProps } from '../../../../../shared/ui/dialogs/PromptModal';
import type { ContextualLinkPasteMenuProps } from '../../ContextualLinkPasteMenu';
import { EditorModals } from './EditorModals';
import { translationsReady, viewInputs } from './test-support';

const observed = vi.hoisted(() => {
    const result: {
        insert: InsertContentModalProps | null; icon: IconPickerProps | null;
        cite: ComponentProps<typeof CitePicker> | null; ai: ComponentProps<typeof AIGenerateModal> | null;
        prompt: PromptModalProps | null; paste: ContextualLinkPasteMenuProps | null;
    } = { insert: null, icon: null, cite: null, ai: null, prompt: null, paste: null };
    return result;
});
vi.mock('../../IconPicker', () => ({ IconPicker: (props: IconPickerProps) => { observed.icon = props; return <div data-modal="icon" />; } }));
vi.mock('../../../content/InsertContentModal', () => ({ InsertContentModal: (props: InsertContentModalProps) => { observed.insert = props; return <div data-modal="insert" />; } }));
vi.mock('../../../../literature/records/CitePicker', () => ({ CitePicker: (props: ComponentProps<typeof CitePicker>) => { observed.cite = props; return <div data-modal="cite" />; } }));
vi.mock('../../AIGenerateModal', () => ({ default: (props: ComponentProps<typeof AIGenerateModal>) => { observed.ai = props; return <div data-modal="ai" />; } }));
vi.mock('../../../../../shared/ui/dialogs/PromptModal', () => ({ default: (props: PromptModalProps) => { observed.prompt = props; return <div data-modal="prompt" />; } }));
vi.mock('../../ContextualLinkPasteMenu', () => ({ default: (props: ContextualLinkPasteMenuProps) => { observed.paste = props; return <div data-modal="paste" />; } }));
beforeAll(async () => { await translationsReady; });

describe('editor modal wiring without duplicated state', () => {
    it('preserves modal order, insertion defaults and upload File identity', () => {
        const inputs = viewInputs();
        const { container, render } = mountTestComponent(<EditorModals {...inputs} />);
        expect([...container.querySelectorAll('[data-modal]')].map(node => node.getAttribute('data-modal'))).toEqual(['icon', 'insert', 'cite', 'ai', 'prompt']);
        expect(observed.insert?.open).toBe(false);
        expect(observed.insert?.initialTab).toBe('vault');
        const initialFile = new File(['fixture'], 'photo.png', { type: 'image/png' });
        render(<EditorModals {...inputs} pendingInsert={{ initialTab: 'upload', initialFile }} />);
        expect(observed.insert?.initialFile).toBe(initialFile);
        expect(observed.insert?.initialTab).toBe('upload');
        expect(observed.insert?.tableId).toBe('books');
        expect(inputs.getPendingInsert).not.toHaveBeenCalled();
    });

    it('reads the latest pending resolver only when inserting, clears state first and preserves the exact result', () => {
        const inputs = viewInputs(); const order: string[] = [];
        const resolve = vi.fn<(result: InsertContentResult) => void>().mockImplementation(() => { order.push('resolve'); });
        const reject = vi.fn(); inputs.getPendingInsert.mockReturnValue({ resolve, reject });
        inputs.setPendingInsert.mockImplementation(() => { order.push('clear'); });
        mountTestComponent(<EditorModals {...inputs} pendingInsert={{}} />);
        const result: InsertContentResult = { url: '/media/a.png', mode: 'block', kind: 'image', imageMeta: { alt: 'A' } };
        act(() => { observed.insert?.onInsert?.(result); });
        expect(order).toEqual(['clear', 'resolve']); expect(resolve).toHaveBeenCalledWith(result);
        expect(reject).not.toHaveBeenCalled();
    });

    it('rejects cancellation and returns focus to the editor even if the callback fails', () => {
        const inputs = viewInputs(); const reject = vi.fn().mockImplementation(() => { throw new Error('ignored resolver'); });
        const focus = vi.spyOn(inputs.editor, 'focus');
        inputs.getPendingInsert.mockReturnValue({ resolve: vi.fn(), reject });
        mountTestComponent(<EditorModals {...inputs} pendingInsert={{}} />);
        act(() => { observed.insert?.onClose(); });
        expect(inputs.setPendingInsert).toHaveBeenCalledWith(null);
        expect(reject).toHaveBeenCalledWith(new Error('cancelled'));
        expect(focus).toHaveBeenCalledOnce();
    });

    it('forwards icon, citation, AI, link-card and contextual-paste handlers with their original payloads', () => {
        const inputs = viewInputs(); const anchor = { left: 10, top: 20, bottom: 30 };
        const request = { mode: 'continue' as const, anchor: { id: 'fixture-anchor' } };
        mountTestComponent(<EditorModals {...inputs} inlineIconPickerAnchor={anchor} aiRequest={request}
            linkCardCtx={{ editor: inputs.editor }} linkPasteCtx={{ position: { left: 30, top: 40 } }} />);
        expect(observed.icon?.anchorRect).toBe(anchor); expect(observed.icon?.currentIcon).toBe('');
        observed.icon?.onSelectIcon('lucide:Book'); expect(inputs.insertInlineIcon).toHaveBeenCalledWith('lucide:Book');
        observed.cite?.onClose(); expect(inputs.setIsCitePickerOpen).toHaveBeenCalledWith(false);
        observed.cite?.onSelect?.({ citation_key: 'Merce2026', id: 'reference', title: 'Title', author: 'Mercè', year: '2026', folder: null });
        expect(inputs.insertCitation).toHaveBeenCalledWith('Merce2026');
        observed.cite?.onSelect?.({ citation_key: null, id: null, title: null, author: null, year: null, folder: null });
        expect(inputs.insertCitation).toHaveBeenCalledOnce();
        expect(observed.ai?.request).toBe(request);
        observed.ai?.onInsert('Generated', request.anchor);
        expect(inputs.insertGeneratedMarkdown).toHaveBeenCalledWith('Generated', request.anchor);
        observed.ai?.onClose(); expect(inputs.setAiRequest).toHaveBeenCalledWith(null);
        expect(observed.prompt?.inputType).toBe('url'); expect(observed.prompt?.defaultValue).toBe('https://');
        observed.prompt?.onSubmit('https://example.test'); expect(inputs.doLinkCard).toHaveBeenCalledWith('https://example.test');
        observed.paste?.onChoose?.('bookmark'); expect(inputs.applyContextualLinkPaste).toHaveBeenCalledWith('bookmark');
    });
});
