import { act, useLayoutEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useMeetingRecorder, type MeetingRecorderController } from './useMeetingRecorder';

const effects = vi.hoisted(() => ({
  upload: vi.fn(), status: vi.fn(), error: vi.fn(), navigate: vi.fn(), dock: vi.fn(),
}));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('react-router-dom', () => ({ useNavigate: () => effects.navigate }));
vi.mock('../../shared/api/meeting-specialized', () => ({ uploadMeetingRecording: effects.upload }));
vi.mock('../../shared/api/meetings', () => ({ fetchMeetingStatus: effects.status }));
vi.mock('../../lib/toast', () => ({ toast: { error: effects.error } }));
vi.mock('../../lib/vaultRouting', () => ({ vaultPath: (app: string, path: string) => `/fixture/${app}/${path}` }));
vi.mock('../../shared/hooks/useExclusiveFloatingPanel', () => ({ announceFloatingPanelOpen: vi.fn(), useExclusiveFloatingPanel: vi.fn() }));
vi.mock('../../hooks/useFloatingActionDock', () => ({ useFloatingActionDock: () => [false, effects.dock] }));

/** Structural test double: no browser capture or device permission is requested. */
class FakeRecorder {
  static instances: FakeRecorder[] = [];
  static isTypeSupported = vi.fn(() => true);
  state: RecordingState = 'inactive';
  ondataavailable: ((event: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  constructor(readonly stream: unknown, readonly options?: MediaRecorderOptions) {
    FakeRecorder.instances.push(this);
  }
  start = vi.fn(() => { this.state = 'recording'; });
  stop = vi.fn(() => { this.state = 'inactive'; this.onstop?.(); });
}

const stopTrack = vi.fn();
const microphone = { getTracks: () => [{ stop: stopTrack }], getAudioTracks: () => [{ stop: stopTrack }] };
const getUserMedia = vi.fn();
const getDisplayMedia = vi.fn();
let root: Root | null;
let container: HTMLDivElement | undefined;
let current: MeetingRecorderController | undefined;
function Probe() {
  const value = useMeetingRecorder();
  useLayoutEffect(() => { current = value; }, [value]);
  return null;
}
function controller(): MeetingRecorderController {
  if (!current) throw new Error('Recorder hook has not mounted');
  return current;
}
function recorder(): FakeRecorder {
  const result = FakeRecorder.instances.at(-1);
  if (!result) throw new Error('Recorder was not created');
  return result;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('MediaRecorder', FakeRecorder);
  vi.stubGlobal('navigator', { mediaDevices: { getUserMedia, getDisplayMedia } });
  getUserMedia.mockResolvedValue(microphone);
  effects.upload.mockResolvedValue({});
  effects.status.mockResolvedValue({ stage: 'done', page_id: 'minutes-fixture' });
  FakeRecorder.instances = [];
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  act(() => { root?.render(<Probe />); });
});

afterEach(() => {
  act(() => { root?.unmount(); });
  root = null;
  current = undefined;
  container?.remove();
  container = undefined;
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('meeting recorder lifecycle', () => {
  it('retries the same recording after upload failure and opens the completed minutes', async () => {
    effects.upload.mockRejectedValueOnce(new Error('offline'));
    act(() => { controller().setTitle('Reunió fictícia'); controller().openPanel(); });
    await act(async () => { await controller().startRecording(); });
    expect(getUserMedia).toHaveBeenCalledWith({ audio: true });
    expect(recorder().options).toEqual({ mimeType: 'audio/webm;codecs=opus' });
    expect(recorder().start).toHaveBeenCalledWith(1000);
    act(() => { vi.advanceTimersByTime(1000); controller().closePanel(); });
    expect(controller().seconds).toBe(1);
    expect(controller().open).toBe(true);
    expect(effects.error).toHaveBeenCalledWith('meeting.stop_before_close');
    await act(async () => {
      recorder().ondataavailable?.({ data: new Blob(['x'.repeat(1500)]) });
      controller().stopRecording();
      await Promise.resolve();
    });
    expect(controller().phase).toBe('error');
    expect(controller().errMsg).toBe('offline');
    const originalBlob: unknown = effects.upload.mock.calls[0]?.[0];
    expect(originalBlob).toBeInstanceOf(Blob);
    expect(stopTrack).toHaveBeenCalledOnce();
    await act(async () => { controller().retryUpload(); await Promise.resolve(); });
    expect(effects.upload).toHaveBeenLastCalledWith(originalBlob, 'Reunió fictícia', 'presencial');
    expect(controller().phase).toBe('processing');
    await act(async () => { vi.advanceTimersByTime(2000); await Promise.resolve(); });
    expect(controller().phase).toBe('done');
    expect(vi.getTimerCount()).toBe(0);
    act(() => { controller().openMinutes(); });
    expect(effects.navigate).toHaveBeenCalledWith('/fixture/knowledge/page/minutes-fixture');
    expect(controller().phase).toBe('idle');
  });

  it('rejects a short recording without uploading and releases the microphone', async () => {
    await act(async () => { await controller().startRecording(); });
    act(() => {
      recorder().ondataavailable?.({ data: new Blob(['short']) });
      controller().stopRecording();
    });
    expect(controller().phase).toBe('error');
    expect(controller().errMsg).toBe('meeting.too_short');
    expect(effects.upload).not.toHaveBeenCalled();
    expect(stopTrack).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('leaves the recorder idle when microphone permission is denied', async () => {
    getUserMedia.mockRejectedValueOnce(Object.assign(new Error('Denied'), { name: 'NotAllowedError' }));
    await act(async () => { await controller().startRecording(); });
    expect(effects.error).toHaveBeenCalledWith('meeting.mic_denied');
    expect(controller().phase).toBe('idle');
    expect(FakeRecorder.instances).toHaveLength(0);
    expect(effects.upload).not.toHaveBeenCalled();
  });

  it('releases display tracks if screen sharing has no audio', async () => {
    getDisplayMedia.mockResolvedValueOnce({ getTracks: () => [{ stop: stopTrack }], getAudioTracks: () => [] });
    act(() => { controller().setMode('online'); });
    await act(async () => { await controller().startRecording(); });
    expect(getDisplayMedia).toHaveBeenCalledWith({ audio: true, video: true });
    expect(effects.error).toHaveBeenCalledWith('meeting.no_audio_shared');
    expect(stopTrack).toHaveBeenCalledOnce();
    expect(getUserMedia).not.toHaveBeenCalled();
  });

  it('preserves the generic fallback for non-Error permission-shaped rejections', async () => {
    getUserMedia.mockRejectedValueOnce({ name: 'NotAllowedError', message: 'Denied' });
    await act(async () => { await controller().startRecording(); });
    expect(effects.error).toHaveBeenCalledWith('meeting.start_error');
    expect(controller().phase).toBe('idle');
    expect(effects.upload).not.toHaveBeenCalled();
  });
});
