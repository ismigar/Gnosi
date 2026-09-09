export function downloadBlob(blob: Blob, filename: string): void {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    try {
        anchor.href = url;
        anchor.download = filename;
        document.body.appendChild(anchor);
        anchor.click();
    } finally {
        anchor.remove();
        // WebKit may start reading the URL after the click handler returns.
        // Keep it alive briefly so browser-side SVG, PNG and PDF exports finish.
        setTimeout(() => { URL.revokeObjectURL(url); }, 10000);
    }
}
