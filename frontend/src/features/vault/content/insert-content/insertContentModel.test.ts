import { describe, expect, it } from 'vitest';

import {
    allowedTabsFor,
    canInsertContent,
    createInitialState,
    defaultModeFor,
    detectPathKind,
    detectUrlKind,
    filenameFromUrl,
    initialTabFor,
    insertContentReducer,
    modeAvailableFor,
    uploadErrorMessage,
} from './insertContentModel';


const ORIGIN = 'http://localhost:5173';


describe('insertContentModel', () => {
    it('classifies every supported URL and path family', () => {
        expect(detectUrlKind('https://example.com/paper.pdf?download=1', ORIGIN)).toBe('pdf');
        expect(detectUrlKind('cover.avif', ORIGIN)).toBe('image');
        expect(detectUrlKind('clip.mkv', ORIGIN)).toBe('video');
        expect(detectUrlKind('recording.flac', ORIGIN)).toBe('audio');
        expect(detectUrlKind('notes.rtf', ORIGIN)).toBe('doc');
        expect(detectUrlKind('https://youtu.be/evidence', ORIGIN)).toBe('youtube');
        expect(detectUrlKind('https://player.vimeo.com/video/42', ORIGIN)).toBe('vimeo');
        expect(detectUrlKind('https://example.com/page', ORIGIN)).toBe('web');
        expect(detectUrlKind('mailto:team@example.com', ORIGIN)).toBe('file');
        expect(detectUrlKind('', ORIGIN)).toBeNull();
        expect(detectPathKind('/Vault/Images/cover.svg', ORIGIN)).toBe('image');
        expect(filenameFromUrl('https://example.com/My%20Paper.pdf', ORIGIN)).toBe('My Paper.pdf');
    });


    it('preserves mode defaults and compatibility', () => {
        expect(defaultModeFor('pdf')).toBe('frame');
        expect(defaultModeFor('youtube')).toBe('frame');
        expect(defaultModeFor('image')).toBe('block');
        expect(defaultModeFor('folder')).toBe('link');
        expect(modeAvailableFor('image', 'block')).toBe(true);
        expect(modeAvailableFor('youtube', 'block')).toBe(false);
        expect(modeAvailableFor('web', 'frame')).toBe(true);
        expect(modeAvailableFor('folder', 'frame')).toBe(false);
        expect(modeAvailableFor('folder', 'link')).toBe(true);
    });


    it('derives the exact source tabs from field configuration', () => {
        expect(allowedTabsFor(null)).toEqual(['vault', 'local', 'upload', 'url']);
        expect(allowedTabsFor({ fileMode: 'link' })).toEqual(['local']);
        expect(allowedTabsFor({ fileMode: 'upload' })).toEqual(['upload', 'local']);
        expect(initialTabFor(null, 'url')).toBe('url');
        expect(initialTabFor({ fileMode: 'link' }, 'vault')).toBe('local');
        expect(initialTabFor({ fileMode: 'upload' }, 'vault')).toBe('upload');
    });


    it('keeps tab, URL, upload and mode transitions deterministic', () => {
        const file = new File(['content'], 'report.pdf');
        const initial = createInitialState({
            imageMeta: {},
            initialFile: file,
            initialTab: 'vault',
            origin: ORIGIN,
        });
        expect(initial.tab).toBe('upload');
        expect(initial.selected).toMatchObject({ kind: 'pdf', source: 'upload-pending' });

        const local = insertContentReducer(initial, {
            origin: ORIGIN,
            tab: 'local',
            type: 'set-tab',
        });
        expect(local.selected).toBeNull();
        const upload = insertContentReducer(local, {
            origin: ORIGIN,
            tab: 'upload',
            type: 'set-tab',
        });
        expect(upload.selected).toMatchObject({ source: 'upload-pending' });

        const url = insertContentReducer(upload, {
            origin: ORIGIN,
            type: 'set-url',
            value: 'https://youtu.be/evidence',
        });
        expect(url.selected).toMatchObject({ kind: 'youtube', name: 'evidence' });
        expect(url.mode).toBe('link');
        const incompatible = insertContentReducer(url, {
            mode: 'block',
            type: 'set-mode',
        });
        expect(canInsertContent(incompatible, false, '')).toBe(false);
    });


    it('allows metadata-only saves for an existing image', () => {
        const state = createInitialState({
            imageMeta: { alt: 'Evidence' },
            initialFile: null,
            initialTab: 'vault',
            origin: ORIGIN,
        });
        expect(canInsertContent(state, true, 'Images/evidence.jpg')).toBe(true);
        expect(canInsertContent(state, false, 'Images/evidence.jpg')).toBe(false);
    });


    it('maps upload failures to the historical localized messages', () => {
        const translate = (_key: string, fallback: string): string => fallback;
        expect(uploadErrorMessage(new Error('unreadable-file'), translate)).toContain(
            "Couldn't read the file",
        );
        expect(uploadErrorMessage({ code: 'ETIMEDOUT' }, translate)).toContain(
            'upload took too long',
        );
        expect(uploadErrorMessage({
            response: { data: { detail: 'Backend detail' } },
        }, translate)).toBe('Backend detail');
        expect(uploadErrorMessage(new Error('Network down'), translate)).toBe('Network down');
    });
});
