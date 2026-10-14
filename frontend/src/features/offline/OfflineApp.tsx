import { useEffect, useState, useSyncExternalStore, type SyntheticEvent } from 'react';
import { useTranslation } from 'react-i18next';
import Markdown from 'react-markdown';
import { currentOfflineScope, offlineRemote } from '../../shared/api/offline-sync';
import { OfflineController, type OfflineState } from '../../shared/offline/controller';
import { MAX_NOTE_LENGTH, type OfflineErrorCode, type OfflineNote } from '../../shared/offline/model';
import { indexedDbOfflineStore } from '../../shared/offline/storage';
import { subscribeWindowEvent } from '../../shared/platform/browser-events';
import { storageEventIsFrom } from '../../shared/platform/browser-storage';
import { useTheme } from '../../shared/hooks/useTheme';
import { RefreshButton } from '../../shared/ui/actions/RefreshButton';
import { registerOfflineWorker } from './service-worker';
import './offline.css';

const errorKeys: Record<OfflineErrorCode, string> = {
    unsupported: 'offline.error.unsupported', passphrase: 'offline.error.passphrase', unlock: 'offline.error.unlock',
    scope: 'offline.error.scope', session: 'offline.error.session', storage: 'offline.error.storage',
    changed: 'offline.error.changed', locked: 'offline.error.locked', network: 'offline.error.network',
    format: 'offline.error.format', limit: 'offline.error.limit', etag: 'offline.error.etag', missing: 'offline.error.missing', unsaved: 'offline.error.unsaved',
};
const identityKeys = new Set(['gnosi_user_id', 'gnosi_user_email', 'gnosi_workspace_id', 'gnosi_active_vault']);

export function OfflineApp({ controller: provided }: { readonly controller?: OfflineController }) {
    const { t } = useTranslation();
    const [controller] = useState(() => provided ?? new OfflineController(indexedDbOfflineStore, offlineRemote, currentOfflineScope));
    const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
    const [worker, setWorker] = useState<'loading' | 'ready' | 'unavailable'>('loading');
    const [online, setOnline] = useState(navigator.onLine);
    const { isDark } = useTheme();
    useEffect(() => { document.documentElement.classList.toggle('dark', isDark); }, [isDark]);
    useEffect(() => {
        let alive = true;
        void controller.initialize();
        void registerOfflineWorker().then(ready => { if (alive) setWorker(ready ? 'ready' : 'unavailable'); });
        const scopeChanged = (event: StorageEvent) => {
            if (storageEventIsFrom(event, 'local') && (!event.key || identityKeys.has(event.key))) controller.lock('scope');
        };
        const focus = () => { controller.checkScope(); };
        const connection = () => { setOnline(navigator.onLine); controller.checkScope(); };
        const pagehide = () => { controller.lock(); };
        const beforeunload = (event: BeforeUnloadEvent) => {
            if (controller.hasDrafts()) { event.preventDefault(); }
        };
        const unsubscribe = [
            subscribeWindowEvent('storage', scopeChanged),
            subscribeWindowEvent('focus', focus),
            subscribeWindowEvent('online', connection),
            subscribeWindowEvent('offline', connection),
            subscribeWindowEvent('pagehide', pagehide),
            subscribeWindowEvent('beforeunload', beforeunload),
        ];
        return () => {
            alive = false;
            for (const stop of unsubscribe) stop();
            controller.lock();
        };
    }, [controller]);

    return <main className="gnosi-offline">
        <header className="offline-heading">
            <div><h1>{t('offline.title', 'Gnosi offline notes')}</h1>
                <p>{online ? t('offline.online', 'Network available') : t('offline.offline', 'Offline')}</p></div>
            <a className="gnosi-button" href="/" target="_blank" rel="noopener noreferrer">{t('offline.openGnosi', 'Open Gnosi / sign in')}</a>
        </header>
        <p className="offline-description">{t('offline.description', 'Choose Markdown notes to read and edit on this device. Local copies are encrypted with your passphrase. Sync uses your signed-in Gnosi server, which can read the notes; this is not end-to-end encrypted server storage.')}</p>
        <p className="offline-status" role="status">{worker === 'ready'
            ? t('offline.ready', 'Offline startup ready. Install from your browser menu or use Add to Home Screen.')
            : worker === 'loading' ? t('offline.preparing', 'Preparing offline startup…')
                : t('offline.workerUnavailable', 'Offline startup is unavailable here. Use the built web app over HTTPS or localhost, and open it online once.')}</p>
        {state.error && <p role="alert" className="offline-error">{t(errorKeys[state.error])}</p>}
        {state.notice && <p role="status">{t(`offline.notice.${state.notice}`)}</p>}
        {!state.initialized ? <p role="status">{t('common.loading', 'Loading…')}</p>
            : state.collection ? <UnlockedNotes controller={controller} state={state} />
                : <LockedCollection controller={controller} state={state} />}
    </main>;
}

function LockedCollection({ controller, state }: { readonly controller: OfflineController; readonly state: OfflineState }) {
    const { t } = useTranslation();
    const [passphrase, setPassphrase] = useState('');
    const [confirm, setConfirm] = useState('');
    const [deleting, setDeleting] = useState(false);
    function submit(event: SyntheticEvent<HTMLFormElement>) {
        event.preventDefault();
        if (!state.exists && passphrase !== confirm) return;
        const input = passphrase;
        setPassphrase('');
        setConfirm('');
        void (state.exists ? controller.unlock(input) : controller.create(input));
    }
    return <section className="gnosi-panel offline-card">
        <h2>{state.exists ? t('offline.unlockTitle', 'Unlock this device’s notes') : t('offline.setupTitle', 'Set up offline notes')}</h2>
        <p>{t('offline.setupHelp', 'First sign in to Gnosi on this server and choose a Vault. One offline collection belongs to that account, workspace and Vault. Switch back to the same selection to unlock it.')}</p>
        <p>{t('offline.passphraseHelp', 'Use a separate passphrase of at least 12 characters. It stays in memory only and cannot be recovered. Clearing browser data removes these local copies; sync changes before clearing them.')}</p>
        <form onSubmit={submit} className="offline-form">
            <label>{t('offline.passphrase', 'Offline passphrase')}
                <input type="password" name="offline-passphrase" autoComplete="off" minLength={12} maxLength={1024}
                    required value={passphrase} disabled={state.busy} onChange={event => { setPassphrase(event.target.value); }} /></label>
            {!state.exists && <label>{t('offline.confirmPassphrase', 'Repeat passphrase')}
                <input type="password" name="offline-confirm-passphrase" autoComplete="off" minLength={12} maxLength={1024}
                    required value={confirm} disabled={state.busy} onChange={event => { setConfirm(event.target.value); }} /></label>}
            <button className="gnosi-button gnosi-button--primary" disabled={state.busy || passphrase.length < 12 || (!state.exists && passphrase !== confirm)}>
                {state.exists ? t('offline.unlock', 'Unlock') : t('offline.create', 'Create encrypted collection')}</button>
        </form>
        {state.exists && <div className="offline-remove">
            {!deleting ? <button className="gnosi-button" disabled={state.busy} onClick={() => { setDeleting(true); }}>{t('offline.erase', 'Remove this device’s collection')}</button>
                : <><p>{t('offline.eraseConfirm', 'Remove every offline copy and any unsynced edit on this device? Server notes stay unchanged.')}</p>
                    <button className="gnosi-button" disabled={state.busy} onClick={() => { setDeleting(false); void controller.erase(); }}>{t('offline.eraseYes', 'Remove local collection')}</button>
                    <button className="gnosi-button" onClick={() => { setDeleting(false); }}>{t('common.cancel', 'Cancel')}</button></>}
        </div>}
    </section>;
}

function UnlockedNotes({ controller, state }: { readonly controller: OfflineController; readonly state: OfflineState }) {
    const { t } = useTranslation();
    const [selected, setSelected] = useState('');
    const [query, setQuery] = useState('');
    const [discardToLock, setDiscardToLock] = useState(false);
    const collection = state.collection;
    if (!collection) return null;
    const note = collection.notes.find(item => item.id === selected) ?? collection.notes[0];
    const lock = () => { if (controller.hasDrafts()) setDiscardToLock(true); else controller.lock(); };
    return <>
        <section className="gnosi-panel offline-card">
            <div className="offline-heading">
                <div><h2>{t('offline.collection', 'This device’s collection')}</h2>
                    <p className="offline-scope">{collection.scope.origin}<br />{collection.scope.userEmail}<br />
                        {t('offline.scope', 'Workspace {{workspace}} · Vault {{vault}}', { workspace: collection.scope.workspaceId, vault: collection.scope.vaultId })}</p></div>
                <button className="gnosi-button" onClick={lock}>{t('offline.lock', 'Lock')}</button>
            </div>
            {discardToLock && <div role="alert"><p>{t('offline.lockUnsaved', 'Some edits have not been saved locally. Save them first, or discard those unsaved edits and lock.')}</p>
                <button className="gnosi-button" onClick={() => { controller.lock(); }}>{t('offline.discardLock', 'Discard unsaved edits and lock')}</button>
                <button className="gnosi-button" onClick={() => { setDiscardToLock(false); }}>{t('common.cancel', 'Cancel')}</button></div>}
            <div className="offline-heading"><h3>{t('offline.selectNotes', 'Choose notes for offline use')}</h3>
                <RefreshButton loading={state.busy} label={t('offline.browse', 'Load notes from server')} onClick={() => { void controller.browse(); }} /></div>
            <p>{t('offline.selectionHelp', 'Only notes you add are stored locally. Attachments, databases and embedded notes are not downloaded. Up to 100 notes, 1 million characters per note.')}</p>
            {state.choices.length > 0 && <>
                <label className="offline-search">{t('offline.filter', 'Filter server notes')}<input value={query} onChange={event => { setQuery(event.target.value); }} /></label>
                <ul className="offline-choices">{state.choices.filter(item => item.title.toLocaleLowerCase().includes(query.toLocaleLowerCase())).slice(0, 100).map(item =>
                    <li key={item.id}><span>{item.title}</span><button className="gnosi-button" disabled={state.busy || collection.notes.some(local => local.id === item.id)} onClick={() => { void controller.add(item.id); }}>
                        {collection.notes.some(local => local.id === item.id) ? t('offline.added', 'On this device') : t('offline.add', 'Add offline')}</button></li>)}</ul>
            </>}
        </section>
        <div className="offline-notes">
            <nav className="gnosi-panel offline-card" aria-label={t('offline.localNotes', 'Offline notes')}>
                <h2>{t('offline.localNotes', 'Offline notes')}</h2>
                {collection.notes.length === 0 && <p>{t('offline.empty', 'Load the server list above and add a note.')}</p>}
                {collection.notes.map(item => <button key={item.id} className="offline-note-button" aria-current={item.id === note?.id ? 'page' : undefined}
                    onClick={() => { setSelected(item.id); }}>{item.title}<small>{item.conflict ? t('offline.conflict', 'Needs review')
                        : (state.drafts[item.id] ?? item.localContent) !== item.localContent ? t('offline.unsaved', 'Unsaved edits')
                            : item.localContent !== item.baseContent ? t('offline.pending', 'Saved locally · waiting to sync') : t('offline.inSync', 'Synced')}</small></button>)}
            </nav>
            {note && <NoteEditor key={note.id} controller={controller} state={state} note={note} />}
        </div>
    </>;
}

function NoteEditor({ controller, state, note }: { readonly controller: OfflineController; readonly state: OfflineState; readonly note: OfflineNote }) {
    const { t } = useTranslation();
    const [preview, setPreview] = useState(false);
    const [removing, setRemoving] = useState(false);
    const content = state.drafts[note.id] ?? note.localContent;
    const dirty = content !== note.localContent;
    return <section className="gnosi-panel offline-card offline-editor">
        <h2>{note.title}</h2>
        <div className="offline-actions">
            <button className="gnosi-button gnosi-button--primary" disabled={state.busy || !dirty} onClick={() => { void controller.saveLocal(note.id); }}>{t('offline.saveLocal', 'Save locally')}</button>
            <button className="gnosi-button" disabled={state.busy || dirty} onClick={() => { void controller.sync(note.id); }}>{t('offline.sync', 'Sync this note')}</button>
            <button className="gnosi-button" aria-pressed={preview} onClick={() => { setPreview(!preview); }}>{t('offline.preview', 'Reading view')}</button>
        </div>
        <p>{dirty ? t('offline.unsavedHelp', 'These edits are not saved yet. Save locally before syncing or closing.')
            : t('offline.savedAt', 'Local copy saved {{date}}', { date: new Date(note.savedAt).toLocaleString() })}</p>
        {preview ? <div className="offline-preview"><Markdown skipHtml urlTransform={() => ''} components={{
            a: ({ children }) => <span>{children}</span>, img: ({ alt }) => <span>{alt}</span>,
        }}>{content}</Markdown></div>
            : <label className="offline-source">{t('offline.markdown', 'Markdown source')}
                <textarea spellCheck value={content} maxLength={MAX_NOTE_LENGTH} disabled={state.busy}
                    onChange={event => { controller.edit(note.id, event.target.value); }} /></label>}
        {note.conflict && <ConflictReview controller={controller} note={note} merged={state.mergeDrafts[note.id] ?? note.localContent} disabled={state.busy || dirty} />}
        <div className="offline-remove">
            {!removing ? <button className="gnosi-button" disabled={state.busy} onClick={() => { setRemoving(true); }}>{t('offline.removeNote', 'Remove offline copy')}</button>
                : <><p>{t('offline.removeNoteConfirm', 'Remove this offline copy, including any unsynced local edits?')}</p>
                    <button className="gnosi-button" disabled={state.busy} onClick={() => { void controller.remove(note.id); }}>{t('offline.removeNote', 'Remove offline copy')}</button>
                    <button className="gnosi-button" onClick={() => { setRemoving(false); }}>{t('common.cancel', 'Cancel')}</button></>}
        </div>
    </section>;
}

function ConflictReview({ controller, note, merged, disabled }: { readonly controller: OfflineController; readonly note: OfflineNote; readonly merged: string; readonly disabled: boolean }) {
    const { t } = useTranslation();
    return <section className="offline-conflict" aria-label={t('offline.review', 'Review changes')}>
        <h3>{t('offline.review', 'Review changes')}</h3>
        <p>{t('offline.conflictHelp', 'The server changed since this copy was saved. Compare both versions and choose one, or edit a merge. Each choice checks the server version again before saving.')}</p>
        <div className="offline-versions"><div><h4>{t('offline.localVersion', 'Saved local version')}</h4><pre>{note.localContent}</pre></div>
            <div><h4>{t('offline.serverVersion', 'Server version')}</h4><pre>{note.conflict?.content}</pre></div></div>
        <details><summary>{t('offline.baseVersion', 'Original shared version')}</summary><pre>{note.baseContent}</pre></details>
        <div className="offline-actions">
            <button className="gnosi-button" disabled={disabled} onClick={() => { void controller.sync(note.id, 'server'); }}>{t('offline.useServer', 'Use server version locally')}</button>
            <button className="gnosi-button" disabled={disabled} onClick={() => { void controller.sync(note.id, 'local'); }}>{t('offline.useLocal', 'Send local version')}</button>
        </div>
        <label className="offline-source">{t('offline.merge', 'Merge versions')}<textarea value={merged} maxLength={MAX_NOTE_LENGTH} disabled={disabled} onChange={event => { controller.editMerge(note.id, event.target.value); }} /></label>
        <button className="gnosi-button" disabled={disabled} onClick={() => { void controller.sync(note.id, { merged }); }}>{t('offline.sendMerge', 'Save merged version to server')}</button>
    </section>;
}
