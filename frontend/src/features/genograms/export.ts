import regularFont from './assets/LiberationSans-Regular.ttf?inline';
import boldFont from './assets/LiberationSans-Bold.ttf?inline';
import { boxNumbers } from './model';
import { downloadBlob } from '../../shared/platform/download';
export interface ExportOptions { format: 'svg' | 'png' | 'pdf'; paper: 'a4' | 'a3'; orientation: 'landscape' | 'portrait'; mosaic: boolean }

export function cleanSVG(source: SVGSVGElement): SVGSVGElement {
  const svg = source.cloneNode(true) as SVGSVGElement;
  const bounds = boxNumbers(source.getAttribute('data-bounds') ?? '0 0 800 600');
  svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  svg.setAttribute('viewBox', bounds.join(' '));
  svg.setAttribute('width', String(bounds[2])); svg.setAttribute('height', String(bounds[3]));
  svg.removeAttribute('style'); svg.style.background = 'white';
  svg.querySelectorAll('[data-selection]').forEach(element => { element.remove(); });
  for (const element of [svg, ...svg.querySelectorAll('*')]) {
    for (const attr of [...element.attributes]) if (attr.name.startsWith('data-') || attr.name.startsWith('aria-') || attr.name === 'tabindex' || attr.name === 'role') element.removeAttribute(attr.name);
  }
  return svg;
}
export async function exportGenogram(source: SVGSVGElement, name: string, options: ExportOptions): Promise<void> {
  const svg = cleanSVG(source);
  const box = boxNumbers(svg.getAttribute('viewBox') ?? '0 0 800 600');
  const xml = new XMLSerializer().serializeToString(svg);
  const filename = name.replace(/[^\p{L}\p{N} _-]/gu, '').slice(0, 100) || 'genogram';
  if (options.format === 'svg') { downloadBlob(new Blob([xml], { type: 'image/svg+xml;charset=utf-8' }), `${filename}.svg`); return; }
  if (options.format === 'png') {
    // Bound memory use without clipping large diagrams.
    const scale = Math.min(2, Math.sqrt(32000000 / (box[2] * box[3])), 16000 / Math.max(box[2], box[3]));
    const canvas = document.createElement('canvas'); canvas.width = Math.ceil(box[2] * scale); canvas.height = Math.ceil(box[3] * scale);
    const context = canvas.getContext('2d'); if (!context) throw new Error('Canvas unavailable');
    const url = URL.createObjectURL(new Blob([xml], { type: 'image/svg+xml;charset=utf-8' }));
    try {
      const picture = new Image(); picture.src = url; await picture.decode();
      context.fillStyle = 'white'; context.fillRect(0, 0, canvas.width, canvas.height); context.drawImage(picture, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise<Blob>((resolve, reject) => { canvas.toBlob(value => { if (value) resolve(value); else reject(new Error('PNG encoding failed')); }, 'image/png'); });
      downloadBlob(blob, `${filename}.png`);
    } finally { URL.revokeObjectURL(url); }
    return;
  }
  const [{ jsPDF }] = await Promise.all([import('jspdf'), import('svg2pdf.js')]);
  const pdf = new jsPDF({ orientation: options.orientation, unit: 'pt', format: options.paper });
  for (const [data, style] of [[regularFont, 'normal'], [boldFont, 'bold']] as const) {
    const payload = data.split(',')[1];
    if (!payload) throw new Error('Missing export font');
    const filename = `GnosiSans-${style}.ttf`;
    pdf.addFileToVFS(filename, payload); pdf.addFont(filename, 'Arial', style);
  }
  const pageWidth = pdf.internal.pageSize.getWidth(), pageHeight = pdf.internal.pageSize.getHeight();
  const width = pageWidth - 48, height = pageHeight - 48;
  if (!options.mosaic) {
    const scale = Math.min(width / box[2], height / box[3]);
    await pdf.svg(svg, { x: 24, y: 24, width: box[2] * scale, height: box[3] * scale });
  } else {
    const columns = Math.ceil(box[2] / width), rows = Math.ceil(box[3] / height);
    for (let row = 0; row < rows; row++) for (let column = 0; column < columns; column++) {
      if (row || column) pdf.addPage(options.paper, options.orientation);
      svg.setAttribute('viewBox', `${String(box[0] + column * width)} ${String(box[1] + row * height)} ${String(width)} ${String(height)}`);
      svg.setAttribute('width', String(width)); svg.setAttribute('height', String(height));
      await pdf.svg(svg, { x: 24, y: 24, width, height });
      pdf.setFontSize(9); pdf.text(`${String(row + 1)}/${String(rows)} · ${String(column + 1)}/${String(columns)}`, 24, pageHeight - 10);
    }
  }
  downloadBlob(pdf.output('blob'), `${filename}.pdf`);
}
