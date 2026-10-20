import { act, useLayoutEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { GnosiApiError } from '../../../../shared/api/errors';
import { useTldrawHandwriting, type TldrawHandwriting } from './useTldrawHandwriting';
import type { CanvasEditor } from './tldrawEditorTypes';

const calls = vi.hoisted(() => ({ recognize: vi.fn(), warmup: vi.fn(), status: vi.fn(), cancel: vi.fn(), error: vi.fn(), success: vi.fn() }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key, i18n: { resolvedLanguage: 'ca-ES' } }) }));
vi.mock('@tldraw/tlschema', () => ({ createShapeId: () => 'shape:result', toRichText: (text: string) => text }));
vi.mock('../../../../shared/api/drawings', () => ({ recognizeHandwriting: calls.recognize, warmupHandwriting: calls.warmup, fetchHandwritingStatus: calls.status, cancelHandwritingDownload: calls.cancel }));
vi.mock('../../../../shared/notifications/toast', () => ({ toast: { error: calls.error, success: calls.success } }));
vi.mock('../../../../shared/notifications/notifyError', () => ({ logError: vi.fn() }));

const image = new Blob(['synthetic image']);
const editor = {
  getSelectedShapeIds: () => ['shape:stroke'], getCurrentPageShapeIds: () => ['shape:stroke'],
  toImage: vi.fn(async () => ({ blob: image })),
  getSelectionPageBounds: () => ({ x: 1, y: 1, maxY: 5 }),
  getViewportPageBounds: () => ({ center: { x: 1, y: 1 } }),
  createShape: vi.fn(), select: vi.fn(),
};
let current: TldrawHandwriting | undefined;
let root: Root;
let container: HTMLDivElement;
function Probe() {
  const value = useTldrawHandwriting({ editorRef: { current: editor as unknown as CanvasEditor } });
  useLayoutEffect(() => { current = value; }, [value]);
  return null;
}
beforeEach(async () => {
  vi.clearAllMocks();
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  calls.warmup.mockResolvedValue({ warming: false, loaded: true });
  calls.status.mockResolvedValue({ available: true, loaded: false, model: 'fixture', downloaded: false, state: 'not_downloaded', downloaded_bytes: 0, total_bytes: null, error: '', cancelling: false });
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  await act(async () => { root.render(<Probe />); });
});
afterEach(() => {
  act(() => { root.unmount(); });
  container.remove();
  current = undefined;
  vi.unstubAllGlobals();
});
it('opening the canvas does not download or load the OCR model', () => {
  expect(calls.warmup).not.toHaveBeenCalled();
  expect(calls.recognize).not.toHaveBeenCalled();
  expect(current?.status?.state).toBe('not_downloaded');
});
it('shows byte progress and requests cancellation without inserting partial text', async () => {
  const downloading = { available: true, loaded: false, model: 'fixture', downloaded: false, state: 'downloading', downloaded_bytes: 32, total_bytes: 100, error: '', cancelling: false };
  calls.status.mockResolvedValue(downloading);
  calls.cancel.mockResolvedValue(true);
  let reject: (error: Error) => void = () => undefined;
  calls.recognize.mockImplementation(() => new Promise((_resolve, rejectPromise) => { reject = rejectPromise; }));
  let work: Promise<void> | undefined;
  await act(async () => { work = current?.recognize(); });
  expect(current?.status?.downloaded_bytes).toBe(32);
  await act(async () => { await current?.cancelDownload(); });
  expect(calls.cancel).toHaveBeenCalledOnce();
  expect(current?.status?.cancelling).toBe(true);
  calls.status.mockResolvedValue({ ...downloading, state: 'cancelled' });
  await act(async () => {
    reject(new GnosiApiError(new Response(null, { status: 409 }), { detail: 'handwriting_download_cancelled' }));
    await work;
  });
  expect(editor.createShape).not.toHaveBeenCalled();
  expect(calls.error).not.toHaveBeenCalled();
  expect(current?.recognizing).toBe(false);
});
it('reports a failed cancellation request and keeps the download status', async () => {
  calls.cancel.mockRejectedValue(new Error('synthetic offline request'));
  await act(async () => { await current?.cancelDownload(); });
  expect(calls.error).toHaveBeenCalledWith('tldraw.ocr_cancel_error');
  expect(current?.status?.cancelling).toBe(false);
});
it('passes the UI language and inserts the recognized result', async () => {
  calls.recognize.mockResolvedValue({ text: 'Original text', corrected: false });
  await act(async () => { await current?.recognize(); });
  expect(calls.recognize).toHaveBeenCalledWith(image, { language: 'ca' });
  expect(editor.createShape).toHaveBeenCalledWith(expect.objectContaining({ props: expect.objectContaining({ richText: 'Original text' }) }));
  expect(calls.success).toHaveBeenCalledWith('tldraw.recognized');
});
it('shows the actionable localized input error without inserting partial text', async () => {
  const detail = 'La nota supera les 40 línies. Divideix-la en fragments més curts.';
  calls.recognize.mockRejectedValue(new GnosiApiError(new Response(null, { status: 422 }), { detail }));
  await act(async () => { await current?.recognize(); });
  expect(calls.error).toHaveBeenCalledWith(detail);
  expect(editor.createShape).not.toHaveBeenCalled();
  expect(current?.recognizing).toBe(false);
});
it('keeps the localized unavailable-engine message', async () => {
  calls.recognize.mockRejectedValue(new GnosiApiError(new Response(null, { status: 503 }), { detail: 'Unavailable' }));
  await act(async () => { await current?.recognize(); });
  expect(calls.error).toHaveBeenCalledWith('tldraw.engine_unavailable');
  expect(editor.createShape).not.toHaveBeenCalled();
});
