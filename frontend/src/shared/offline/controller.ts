import { isOfflineEtagConflict, type OfflineNoteChoice, type OfflineRemote } from '../api/offline-sync';
import { decryptCollection, deriveKey, encryptCollection, newSalt, type EncryptedCollection } from './crypto';
import { cachedNote, compareNote, MAX_NOTES, MAX_NOTE_LENGTH, OfflineError, requireScope, sameScope,
    type OfflineCollection, type OfflineErrorCode, type OfflineNote, type OfflineScope } from './model';
import type { OfflineStore } from './storage';

export interface OfflineState {
    readonly initialized: boolean;
    readonly exists: boolean;
    readonly busy: boolean;
    readonly collection: OfflineCollection | null;
    readonly drafts: Readonly<Record<string, string>>;
    readonly mergeDrafts: Readonly<Record<string, string>>;
    readonly choices: readonly OfflineNoteChoice[];
    readonly error: OfflineErrorCode | null;
    readonly notice: 'saved' | 'synced' | 'conflict' | 'added' | null;
}

export class OfflineController {
    private state: OfflineState = { initialized: false, exists: false, busy: false, collection: null,
        drafts: {}, mergeDrafts: {}, choices: [], error: null, notice: null };
    private listeners = new Set<() => void>();
    private generation = 0;
    private request: AbortController | null = null;
    private key: CryptoKey | null = null;
    private envelope: EncryptedCollection | null = null;

    constructor(private store: OfflineStore, private remote: OfflineRemote, private currentScope: () => OfflineScope) {}

    getSnapshot = (): OfflineState => this.state;
    subscribe = (listener: () => void): (() => void) => {
        this.listeners.add(listener);
        return () => { this.listeners.delete(listener); };
    };
    private update(patch: Partial<OfflineState>) {
        this.state = { ...this.state, ...patch };
        for (const listener of this.listeners) listener();
    }
    private check(generation: number, scope?: OfflineScope) {
        if (generation !== this.generation) throw new OfflineError('locked');
        if (scope && !sameScope(scope, this.currentScope())) throw new OfflineError('scope');
    }
    private ready(): OfflineCollection {
        if (!this.state.collection || !this.key || !this.envelope) throw new OfflineError('locked');
        this.check(this.generation, this.state.collection.scope);
        return this.state.collection;
    }

    async initialize(): Promise<void> {
        const generation = this.generation;
        try {
            const stored = await this.store.read();
            this.check(generation);
            this.update({ initialized: true, exists: Boolean(stored) });
        } catch (error) {
            if (generation === this.generation) this.update({ initialized: true, error: error instanceof OfflineError ? error.code : 'storage' });
        }
    }

    /** Invalidate every in-flight capability before removing all decrypted view state. */
    lock(error: OfflineErrorCode | null = null): void {
        this.generation += 1;
        this.request?.abort();
        this.request = null;
        this.key = null;
        this.envelope = null;
        this.update({ collection: null, drafts: {}, mergeDrafts: {}, choices: [], busy: false, error, notice: null });
        void this.initialize();
    }

    checkScope(): void {
        if (this.state.collection && !sameScope(this.state.collection.scope, this.currentScope())) this.lock('scope');
    }

    private async perform(work: (generation: number, signal: AbortSignal) => Promise<void>): Promise<void> {
        if (this.state.busy) return;
        const generation = this.generation;
        const request = new AbortController();
        this.request = request;
        this.update({ busy: true, error: null, notice: null });
        try {
            await work(generation, request.signal);
            this.check(generation);
        } catch (error) {
            if (generation !== this.generation) return;
            const code = error instanceof OfflineError ? error.code : 'network';
            if (code === 'scope' || code === 'session' || code === 'changed') this.lock(code);
            else this.update({ error: code });
        } finally {
            if (generation === this.generation) {
                this.request = null;
                this.update({ busy: false });
            }
        }
    }

    create(passphrase: string): Promise<void> {
        return this.perform(async (generation, signal) => {
            const scope = this.currentScope();
            requireScope(scope);
            if (await this.store.read()) throw new OfflineError('changed');
            await this.remote.verify(scope, signal);
            this.check(generation, scope);
            const salt = newSalt();
            const key = await deriveKey(passphrase, salt);
            this.check(generation, scope);
            const collection: OfflineCollection = { version: 1, scope, notes: [] };
            const envelope = await encryptCollection(collection, key, salt, 1);
            this.check(generation, scope);
            await this.store.write(envelope, 0);
            this.check(generation, scope);
            this.key = key;
            this.envelope = envelope;
            this.update({ collection, exists: true, drafts: {}, mergeDrafts: {}, choices: [] });
        });
    }

    unlock(passphrase: string): Promise<void> {
        return this.perform(async (generation) => {
            const envelope = await this.store.read();
            if (!envelope) throw new OfflineError('missing');
            const key = await deriveKey(passphrase, envelope.salt);
            const collection = await decryptCollection(envelope, key);
            this.check(generation, collection.scope);
            this.key = key;
            this.envelope = envelope;
            this.update({ collection, exists: true, drafts: {}, mergeDrafts: {}, choices: [] });
        });
    }

    /** Deletion is only called after an explicit destructive confirmation in the locked view. */
    erase(): Promise<void> {
        if (this.state.collection) return Promise.reject(new OfflineError('locked'));
        return this.perform(async (generation) => {
            const current = await this.store.read();
            this.check(generation);
            if (current) await this.store.remove(current.revision);
            this.check(generation);
            this.update({ exists: false });
        });
    }

    private async persist(collection: OfflineCollection, generation: number): Promise<void> {
        this.check(generation, collection.scope);
        const key = this.key;
        const old = this.envelope;
        if (!key || !old) throw new OfflineError('locked');
        const next = await encryptCollection(collection, key, old.salt, old.revision + 1);
        this.check(generation, collection.scope);
        await this.store.write(next, old.revision);
        this.check(generation, collection.scope);
        this.envelope = next;
        this.update({ collection });
    }
    private async persistNote(note: OfflineNote, generation: number): Promise<void> {
        const collection = this.ready();
        await this.persist({ ...collection, notes: collection.notes.map(existing => existing.id === note.id ? note : existing) }, generation);
    }

    edit(id: string, content: string): void {
        if (this.state.busy) return;
        this.checkScope();
        if (!this.state.collection?.notes.some(note => note.id === id)) return;
        if (content.length > MAX_NOTE_LENGTH) { this.update({ error: 'limit' }); return; }
        this.update({ drafts: { ...this.state.drafts, [id]: content }, notice: null });
    }
    hasDrafts(): boolean {
        return this.state.collection?.notes.some(note => (this.state.drafts[note.id] !== undefined
            && this.state.drafts[note.id] !== note.localContent) || (this.state.mergeDrafts[note.id] !== undefined
            && this.state.mergeDrafts[note.id] !== note.localContent)) ?? false;
    }
    editMerge(id: string, content: string): void {
        if (this.state.busy) return;
        this.checkScope();
        if (!this.state.collection?.notes.some(note => note.id === id && note.conflict)) return;
        if (content.length > MAX_NOTE_LENGTH) { this.update({ error: 'limit' }); return; }
        this.update({ mergeDrafts: { ...this.state.mergeDrafts, [id]: content }, notice: null });
    }
    saveLocal(id: string): Promise<void> {
        return this.perform(async generation => {
            const note = this.ready().notes.find(item => item.id === id);
            if (!note) throw new OfflineError('missing');
            const content = this.state.drafts[id] ?? note.localContent;
            await this.persistNote({ ...note, localContent: content, savedAt: new Date().toISOString() }, generation);
            const { [id]: removed, ...drafts } = this.state.drafts;
            void removed;
            this.update({ drafts, notice: 'saved' });
        });
    }

    browse(): Promise<void> {
        return this.perform(async (generation, signal) => {
            const { scope } = this.ready();
            await this.remote.verify(scope, signal);
            const choices = await this.remote.list(scope, signal);
            this.check(generation, scope);
            this.update({ choices });
        });
    }
    add(id: string): Promise<void> {
        return this.perform(async (generation, signal) => {
            const collection = this.ready();
            if (collection.notes.some(note => note.id === id)) return;
            if (collection.notes.length >= MAX_NOTES) throw new OfflineError('limit');
            await this.remote.verify(collection.scope, signal);
            const remote = await this.remote.read(collection.scope, id, signal);
            this.check(generation, collection.scope);
            await this.persist({ ...collection, notes: [...collection.notes, cachedNote(remote)] }, generation);
            this.update({ notice: 'added' });
        });
    }
    remove(id: string): Promise<void> {
        return this.perform(async generation => {
            const collection = this.ready();
            await this.persist({ ...collection, notes: collection.notes.filter(note => note.id !== id) }, generation);
            this.clearDraft(id);
        });
    }

    private clearDraft(id: string): void {
        const { [id]: removed, ...drafts } = this.state.drafts;
        const { [id]: removedMerge, ...mergeDrafts } = this.state.mergeDrafts;
        void removed;
        void removedMerge;
        this.update({ drafts, mergeDrafts });
    }

    sync(id: string, resolution?: 'server' | 'local' | { readonly merged: string }): Promise<void> {
        return this.perform(async (generation, signal) => {
            const collection = this.ready();
            let note = collection.notes.find(item => item.id === id);
            if (!note) throw new OfflineError('missing');
            // Explicit local save is a durable checkpoint before any network write.
            if ((this.state.drafts[id] ?? note.localContent) !== note.localContent) throw new OfflineError('unsaved');
            if (!resolution && (this.state.mergeDrafts[id] ?? note.localContent) !== note.localContent) throw new OfflineError('unsaved');
            if (typeof resolution === 'object') {
                if (resolution.merged.length > MAX_NOTE_LENGTH) throw new OfflineError('limit');
                note = { ...note, localContent: resolution.merged, savedAt: new Date().toISOString() };
                await this.persistNote(note, generation);
                this.clearDraft(id);
            }
            await this.remote.verify(collection.scope, signal);
            const remote = await this.remote.read(collection.scope, id, signal);
            this.check(generation, collection.scope);
            const decision = compareNote(note, remote);
            if (resolution && (!note.conflict || remote.etag !== note.conflict.etag)) {
                await this.persistNote({ ...note, conflict: remote }, generation);
                this.update({ notice: 'conflict' });
                return;
            }
            if (!resolution && decision === 'conflict') {
                await this.persistNote({ ...note, conflict: remote }, generation);
                this.update({ notice: 'conflict' });
                return;
            }
            if (resolution === 'server' || (!resolution && (decision === 'download' || decision === 'same'))) {
                await this.persistNote(cachedNote(remote), generation);
            } else {
                const content = typeof resolution === 'object' ? resolution.merged : note.localContent;
                if (content.length > MAX_NOTE_LENGTH) throw new OfflineError('limit');
                try {
                    // Even an explicit local/merged choice is conditional on the previewed version.
                    this.check(generation, collection.scope);
                    const stored = await this.store.read();
                    this.check(generation, collection.scope);
                    if (stored?.revision !== this.envelope?.revision) throw new OfflineError('changed');
                    const saved = await this.remote.write(collection.scope, id, content, remote.etag, signal);
                    this.check(generation, collection.scope);
                    await this.persistNote(cachedNote(saved), generation);
                } catch (error) {
                    if (!isOfflineEtagConflict(error)) throw error;
                    const latest = await this.remote.read(collection.scope, id, signal);
                    this.check(generation, collection.scope);
                    // Preserve the proposed merge through retries and an offline reload.
                    await this.persistNote({ ...note, localContent: content, conflict: latest }, generation);
                    this.clearDraft(id);
                    this.update({ notice: 'conflict' });
                    return;
                }
            }
            this.clearDraft(id);
            this.update({ notice: 'synced' });
        });
    }
}
