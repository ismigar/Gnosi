import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

/** Render the actual first page, including scanned covers, as a portable image. */
export async function createPdfCover(file: File): Promise<File> {
    const task = getDocument({
        data: new Uint8Array(await file.arrayBuffer()),
        isEvalSupported: false,
    });
    const canvas = document.createElement('canvas');
    try {
        const pdf = await task.promise;
        const page = await pdf.getPage(1);
        const original = page.getViewport({ scale: 1 });
        const scale = 1400 / Math.max(original.width, original.height);
        const viewport = page.getViewport({ scale });
        canvas.width = Math.ceil(viewport.width);
        canvas.height = Math.ceil(viewport.height);
        await page.render({ canvas, viewport, background: '#ffffff' }).promise;
        const image = await new Promise<Blob>((resolve, reject) => {
            canvas.toBlob((blob) => {
                if (blob) resolve(blob);
                else reject(new Error('Could not render the PDF cover'));
            }, 'image/jpeg', 0.9);
        });
        return new File([image], 'cover.jpg', { type: 'image/jpeg' });
    } finally {
        canvas.width = 0;
        canvas.height = 0;
        await task.destroy();
    }
}
