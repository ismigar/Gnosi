import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPdfCover } from './pdfCover';

const { getDocument } = vi.hoisted(() => ({ getDocument: vi.fn() }));
vi.mock('pdfjs-dist', () => ({ getDocument, GlobalWorkerOptions: {} }));

let canvas: HTMLCanvasElement;
beforeEach(() => {
    vi.resetAllMocks();
    canvas = document.createElement('canvas');
    vi.spyOn(document, 'createElement').mockReturnValue(canvas);
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(callback => {
        callback(new Blob(['jpeg'], { type: 'image/jpeg' }));
    });
});
afterEach(() => { vi.restoreAllMocks(); });

function pdfFile(): File {
    const file = new File(['pdf'], 'paper.pdf', { type: 'application/pdf' });
    Object.defineProperty(file, 'arrayBuffer', { value: () => Promise.resolve(new ArrayBuffer(3)) });
    return file;
}

describe('PDF cover rendering', () => {
    it.each([[600, 800], [800, 600]])('keeps a %sx%s page proportionate and bounds image size', async (width, height) => {
        const render = vi.fn(() => {
            expect(Math.max(canvas.width, canvas.height)).toBe(1400);
            expect(canvas.width / canvas.height).toBeCloseTo(width / height);
            return { promise: Promise.resolve() };
        });
        const getPage = vi.fn(() => Promise.resolve({
            getViewport: ({ scale }: { scale: number }) => ({ width: width * scale, height: height * scale }),
            render,
        }));
        const destroy = vi.fn(() => Promise.resolve());
        getDocument.mockReturnValue({ promise: Promise.resolve({ getPage }), destroy });
        const file = await createPdfCover(pdfFile());
        expect(getPage).toHaveBeenCalledWith(1);
        expect(file.type).toBe('image/jpeg');
        expect(file.size).toBeGreaterThan(0);
        expect(destroy).toHaveBeenCalledOnce();
        expect(canvas.width).toBe(0);
        expect(canvas.height).toBe(0);
    });

    it('releases the renderer when an unreadable PDF fails to load', async () => {
        const destroy = vi.fn(() => Promise.resolve());
        getDocument.mockReturnValue({ promise: Promise.reject(new Error('Invalid PDF')), destroy });
        await expect(createPdfCover(pdfFile())).rejects.toThrow('Invalid PDF');
        expect(destroy).toHaveBeenCalledOnce();
    });
});
