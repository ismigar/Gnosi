import { describe, expect, it, vi } from 'vitest';
import { exportGenogram } from './export';

const save = vi.hoisted(() => vi.fn<(blob: Blob, filename: string) => void>());
vi.mock('../../shared/platform/download', () => ({ downloadBlob: save }));

function bytes(blob: Blob): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => { if (reader.result instanceof ArrayBuffer) resolve(reader.result); else reject(new Error('Missing bytes')); };
    reader.onerror = () => { reject(new Error('Cannot read export')); };
    reader.readAsArrayBuffer(blob);
  });
}

describe('vector PDF export', () => {
  it('embeds fonts and produces a PDF locally from the SVG', async () => {
    // jsdom has no text geometry. Only that browser measurement is supplied;
    // conversion, font embedding and PDF bytes use the real libraries.
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => null);
    Object.defineProperty(SVGElement.prototype, 'getBBox', { configurable: true, value: () => new DOMRect(0, 0, 120, 12) });
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('data-bounds', '0 0 500 300');
    svg.innerHTML = '<g font-family="Arial"><text x="20" y="40">Mercè · ≈80</text><circle cx="50" cy="80" r="20" fill="none" stroke="black"/></g>';
    document.body.append(svg);
    try {
      await exportGenogram(svg, 'Genograma', { format: 'pdf', paper: 'a4', orientation: 'portrait', mosaic: false });
      const result = save.mock.lastCall;
      expect(result?.[1]).toBe('Genograma.pdf');
      if (!result) throw new Error('Missing download');
      const content = new TextDecoder('latin1').decode(await bytes(result[0]));
      expect(content.startsWith('%PDF-')).toBe(true);
      expect(content).toContain('/FontFile2');
      expect(content).toContain('/ToUnicode');
      svg.setAttribute('data-bounds', '0 0 1200 1600');
      await exportGenogram(svg, 'Mosaic', { format: 'pdf', paper: 'a4', orientation: 'portrait', mosaic: true });
      const tiled = save.mock.lastCall;
      if (!tiled) throw new Error('Missing tiled download');
      const tiledContent = new TextDecoder('latin1').decode(await bytes(tiled[0]));
      expect(tiledContent.match(/\/Type \/Page\b/gu)).toHaveLength(9);
    } finally { svg.remove(); Reflect.deleteProperty(SVGElement.prototype, 'getBBox'); }
  });
});
