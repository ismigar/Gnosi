import { TableWebsiteSettings } from '../../src/features/websites';
// eslint-disable-next-line gnosi/feature-boundaries -- This browser regression composes the actual private dialog without application services.
import AIGenerateModal from '../../src/features/vault/editor/AIGenerateModal';
import { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { createInstance } from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { BlockNoteSchema, defaultBlockSpecs } from '@blocknote/core';
import { createReactBlockSpec, useCreateBlockNote } from '@blocknote/react';
import { BlockNoteView } from '@blocknote/mantine';
import '@blocknote/mantine/style.css';
import '../../src/app/styles/index.css';
import ca from '../../src/shared/i18n/locales/ca/translation.json';
import { ModalPortal } from '../../src/shared/ui/ModalPortal';
import { PaneVisibilityContext } from '../../src/shared/ui/PaneVisibility';
import { createPanePortal } from '../../src/shared/ui/createPanePortal';
import { useModalKeyboard } from '../../src/shared/hooks/useModalKeyboard';
import { ConfirmModal } from '../../src/shared/ui/dialogs/ConfirmModal';
import { PromptModal } from '../../src/shared/ui/dialogs/PromptModal';
// eslint-disable-next-line gnosi/feature-boundaries -- This browser regression composes actual private dialogs without application services.
import { TranslateLanguagesModal } from '../../src/features/vault/editor/TranslateLanguagesModal';
// eslint-disable-next-line gnosi/feature-boundaries -- This browser regression composes actual private dialogs without application services.
import { AIUsageHistoryModal } from '../../src/features/settings/AIUsageHistoryModal';
// eslint-disable-next-line gnosi/feature-boundaries -- This browser regression composes actual private dialogs without application services.
import { FeedManagerModal } from '../../src/features/reader/feed-manager/FeedManagerModal';

function NestedDialog({ onClose }: { readonly onClose: () => void }) {
    const ref = useRef<HTMLDivElement>(null);
    const [history, setHistory] = useState(false);
    const [menu, setMenu] = useState(false);
    const [choice, setChoice] = useState('');
    useModalKeyboard({ isOpen: true, onClose, containerRef: ref, trapFocus: true });
    return <ModalPortal><div style={{ position: 'fixed', inset: 0, background: '#0008', display: 'grid', placeItems: 'center' }}>
        <div ref={ref} role="dialog" aria-modal="true" aria-label="Parent settings" style={{ padding: 32, background: 'var(--bg-primary)', border: '1px solid var(--border-primary)' }}>
            <button onClick={() => { setHistory(true); }}>Open history</button>
            <button onClick={() => { setMenu(true); }}>Open menu</button>
            <button onClick={onClose}>Close parent</button>
            <output data-testid="menu-choice">{choice}</output>
            {menu && createPanePortal(<div style={{ position: 'fixed', left: '40%', top: '48%', zIndex: 'var(--z-popover)', padding: 20, background: 'var(--bg-secondary)' }}>
                <button onClick={() => { setChoice('selected'); setMenu(false); }}>Choose option</button>
            </div>, document.body)}
            <AIUsageHistoryModal isOpen={history} onClose={() => { setHistory(false); }} />
        </div>
    </div></ModalPortal>;
}

function TableActions() {
    const [dialog, setDialog] = useState('');
    const [confirmed, setConfirmed] = useState(0);
    const [draft, setDraft] = useState('');
    const close = () => { setDialog(''); };
    return <div contentEditable={false} data-testid="table-actions" style={{ minHeight: 800, padding: 24, background: 'var(--bg-secondary)' }}>
        <div style={{ position: 'sticky', top: 0, zIndex: 'var(--z-popover)', display: 'flex', flexWrap: 'wrap', gap: 12 }}>
            {['translation', 'confirm', 'prompt', 'nested', 'feeds', 'table-website', 'edit-article'].map(kind => <button key={kind} onClick={() => { setDialog(kind); }}>{kind}</button>)}
        </div>
        <p>Embedded table controls inside a real BlockNote node view.</p>
        <output data-testid="confirmed">{confirmed}</output><output data-testid="saved-draft">{draft}</output>
        <table><tbody>{Array.from({ length: 36 }, (_, index) => <tr key={index}><td>Record {index + 1}</td><td>Translation field</td></tr>)}</tbody></table>
        <TranslateLanguagesModal isOpen={dialog === 'translation'} noteId="synthetic-row" recordMetadata={{ lang: 'ca' }} onClose={close} />
        <ConfirmModal isOpen={dialog === 'confirm'} title="Confirmation contract" confirmText="Confirm fixture" onClose={close} onConfirm={() => { setConfirmed(value => value + 1); close(); }} />
        <PromptModal isOpen={dialog === 'prompt'} title="Prompt contract" label="Draft" confirmText="Save fixture" onClose={close} onSubmit={value => { setDraft(value); close(); }} />
        {dialog === 'nested' && <NestedDialog onClose={close} />}
        {dialog === 'table-website' && <TableWebsiteSettings tableId="articles" tableName="Articles" fields={[{ id: 'title', name: 'Títol', type: 'title' }]} />}
        <AIGenerateModal request={dialog === 'edit-article' ? { replacePage: true, mode: 'free', context: 'Text original', anchor: 'article' } : null} onClose={close} onInsert={value => { setDraft(value); }} t={(_key, options) => options.defaultValue} />
        <FeedManagerModal isOpen={dialog === 'feeds'} onClose={close} />
    </div>;
}

const spec = createReactBlockSpec({ type: 'fixture_table', propSchema: {}, content: 'none' }, { render: () => <TableActions /> });
const schema = BlockNoteSchema.create({ blockSpecs: { ...defaultBlockSpecs, fixture_table: { ...spec(), group: 'bnBlock' } } });
function Editor() {
    const editor = useCreateBlockNote({ schema, initialContent: [{ type: 'fixture_table' }] });
    return <BlockNoteView editor={editor} slashMenu={false} sideMenu={false} theme="dark" />;
}

export function Fixture() {
    const [visible, setVisible] = useState(true);
    const [background, setBackground] = useState(0);
    useEffect(() => {
        const change = (event: KeyboardEvent) => { if (event.key === 'F8') setVisible(value => !value); };
        window.addEventListener('keydown', change);
        return () => { window.removeEventListener('keydown', change); };
    }, []);
    return <main style={{ padding: 24, minHeight: '150vh', pointerEvents: 'auto' }}>
        <h1>Modal interaction contract</h1><p>F8 switches the owning document pane.</p>
        <button onClick={() => { setBackground(value => value + 1); }}>Background action</button><output data-testid="background-count">{background}</output>
        <div data-testid="competing-toolbar" style={{ position: 'fixed', top: '48%', left: 0, right: 0, height: 48, background: 'var(--bg-primary)', zIndex: 'var(--z-popover)', border: '1px solid var(--border-primary)' }}>Competing sticky toolbar</div>
        <PaneVisibilityContext.Provider value={visible}>
            <div data-testid="clipped-editor" style={{ display: visible ? 'block' : 'none', transform: 'translateZ(0)', isolation: 'isolate', overflow: 'hidden', height: 360, maxWidth: 900, border: '1px solid var(--border-primary)' }}>
                <Editor />
            </div>
        </PaneVisibilityContext.Provider>
    </main>;
}

document.documentElement.classList.add('dark');
const locale = createInstance();
void locale.init({ lng: 'ca', resources: { ca: { translation: ca } }, interpolation: { escapeValue: false } }).then(() => {
    const root = document.getElementById('root');
    if (!root) throw new Error('Missing fixture root');
    createRoot(root).render(<I18nextProvider i18n={locale}><Fixture /></I18nextProvider>);
});
