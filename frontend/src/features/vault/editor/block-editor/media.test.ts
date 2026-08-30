import { describe, expect, it, vi } from 'vitest';
import { countMediaBlocks, getPdfSourceUri, isRequestCancelled, isVisualMediaFile, nativeBlockTypeFor, normalizeVaultAssetUrl } from './media';
vi.mock('../../../../shared/resources/fileResource', () => ({ withActiveVault: (value: string) => `${value}${value.includes('?') ? '&' : '?'}vault_id=fixture` }));

describe('editor media boundaries', () => {
    it.each([
        [{ name: 'photo.JPG' }, 'image'], [{ type: 'image/heic' }, 'image'],
        [{ name: 'movie.MOV' }, 'video'], [{ type: 'audio/mpeg' }, 'audio'],
        [{ name: 'sound.FLAC' }, 'audio'], [{ name: 'document.pdf' }, 'file'],
        [null, 'file'],
    ])('preserves native block classification for %j', (file, expected) => {
        expect(nativeBlockTypeFor(file)).toBe(expected);
    });
    it('routes generic documents through insertion choice and visual media directly', () => {
        expect(isVisualMediaFile({ name: 'notes.pdf' })).toBe(false);
        expect(isVisualMediaFile({ name: 'photo.png' })).toBe(true);
    });
    it('scopes all local asset URL forms without rewriting external URLs or nonstrings', () => {
        expect(normalizeVaultAssetUrl('Assets/photo.png')).toBe('/api/vault/assets/photo.png?vault_id=fixture');
        expect(normalizeVaultAssetUrl('/api/vault/assets/a.png?x=1')).toBe('/api/vault/assets/a.png?x=1&vault_id=fixture');
        expect(normalizeVaultAssetUrl('https://old.invalid/api/vault/assets/a.png')).toBe('/api/vault/assets/a.png?vault_id=fixture');
        expect(normalizeVaultAssetUrl('https://external.invalid/a.png')).toBe('https://external.invalid/a.png');
        const object = { image: 'keep' }; expect(normalizeVaultAssetUrl(object)).toBe(object);
    });
    it('preserves canonical attachments and accepts only local PDF legacy URLs', () => {
        expect(getPdfSourceUri({ attachment_path: '/tmp/A B.pdf', URL: 'file:///other.pdf' })).toBe('file:///tmp/A%20B.pdf');
        expect(getPdfSourceUri({ attachment_path: 'file:///tmp/a.pdf' })).toBe('file:///tmp/a.pdf');
        expect(getPdfSourceUri({ URL: 'file:///tmp/A.PDF' })).toBe('file:///tmp/A.PDF');
        expect(getPdfSourceUri({ URL: 'https://external.invalid/a.pdf' })).toBeNull();
        expect(getPdfSourceUri({ URL: 'file:///tmp/a.doc' })).toBeNull();
        expect(getPdfSourceUri(null)).toBeNull();
    });
    it('counts media recursively through columns, ignoring non-block entries', () => {
        expect(countMediaBlocks([{ type: 'columnList', children: [{ type: 'column', children: [
            { type: 'image' }, { type: 'paragraph' }, { type: 'file', children: [{ type: 'audio' }] },
        ] }] }, { type: 'video' }, null, 'bad'])).toBe(4);
        expect(countMediaBlocks(null)).toBe(0);
    });
    it('recognizes both AbortError and an explicitly aborted signal', () => {
        const controller = new AbortController();
        expect(isRequestCancelled({ name: 'AbortError' })).toBe(true);
        expect(isRequestCancelled(new Error('Other'), controller.signal)).toBe(false);
        controller.abort(); expect(isRequestCancelled(null, controller.signal)).toBe(true);
    });
});
