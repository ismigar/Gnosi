import { subscribeElementEvent } from '../../../shared/platform/browser-events';


interface RemoteMailImageRecoveryOptions {
  readonly fallbackLabel: string;
  readonly fallbackDetail: string;
  readonly onStateChange?: () => void;
  readonly recoveryPromptLabel: string;
  readonly recoveryActionLabel: string;
  readonly recoveringLabel: string;
  readonly retryLabel: string;
  readonly recoverSource?: (token: string) => Promise<string | null>;
  readonly releaseRecoveredSource?: (source: string) => void;
  readonly timeoutMs?: number;
}


export function installRemoteMailImageRecovery(
  document: Document,
  options: RemoteMailImageRecoveryOptions,
): () => void {
  const timeoutMs = options.timeoutMs ?? 8000;
  const cleanups: Array<() => void> = [];

  const monitor = (image: HTMLImageElement): void => {
    if (image.dataset.gnosiRecoveryInstalled === 'true') return;
    image.dataset.gnosiRecoveryInstalled = 'true';
    let active = true;
    let phase: 'pending' | 'offered' | 'recovering' | 'recovered' | 'failed' | 'loaded'
      = 'pending';
    let recoveredSource: string | null = null;
    let timeoutTimer: ReturnType<typeof setTimeout> | undefined;

    const clearTimers = (): void => {
      if (timeoutTimer !== undefined) clearTimeout(timeoutTimer);
    };
    const releaseRecoveredSource = (): void => {
      if (!recoveredSource) return;
      options.releaseRecoveredSource?.(recoveredSource);
      recoveredSource = null;
    };
    const renderFinalCopy = (fallback: HTMLElement): void => {
      fallback.dataset.gnosiRemoteImage = 'unavailable';
      fallback.setAttribute('aria-label', options.fallbackLabel);
      fallback.replaceChildren();
      const label = document.createElement('span');
      label.textContent = `▧ ${options.fallbackLabel}`;
      const detail = document.createElement('span');
      detail.className = 'gnosi-remote-image-detail';
      detail.textContent = options.fallbackDetail;
      fallback.append(label, detail);
    };
    const startRecovery = (fallback: HTMLElement, token: string): void => {
      if (!active || !options.recoverSource
        || (phase !== 'offered' && phase !== 'failed')) return;
      phase = 'recovering';
      fallback.dataset.gnosiRemoteImage = 'recovering';
      fallback.setAttribute('aria-live', 'polite');
      const button = fallback.querySelector<HTMLButtonElement>('button');
      if (button) {
        button.disabled = true;
        button.textContent = options.recoveringLabel;
      }
      void options.recoverSource(token).then((nextSource) => {
        if (!active || phase !== 'recovering' || !fallback.isConnected) {
          if (nextSource) options.releaseRecoveredSource?.(nextSource);
          return;
        }
        if (!nextSource) {
          renderFailure(fallback, token);
          return;
        }
        recoveredSource = nextSource;
        phase = 'recovered';
        image.dataset.gnosiRemoteImage = 'recovered';
        fallback.replaceWith(image);
        timeoutTimer = setTimeout(showFailedImage, timeoutMs);
        image.src = nextSource;
        options.onStateChange?.();
      }).catch(() => {
        if (!active || phase !== 'recovering') return;
        renderFailure(fallback, token);
      });
    };
    const appendAction = (
      fallback: HTMLElement,
      token: string,
      label: string,
    ): void => {
      const button = document.createElement('button');
      button.className = 'gnosi-remote-image-recover';
      button.type = 'button';
      button.textContent = label;
      const unsubscribeClick = subscribeElementEvent(button, 'click', () => {
        startRecovery(fallback, token);
      });
      cleanups.push(unsubscribeClick);
      fallback.append(button);
    };
    const renderFailure = (fallback: HTMLElement, token: string): void => {
      clearTimers();
      releaseRecoveredSource();
      phase = 'failed';
      fallback.setAttribute('role', 'group');
      renderFinalCopy(fallback);
      if (options.recoverSource) appendAction(fallback, token, options.retryLabel);
      options.onStateChange?.();
    };
    const showFailedImage = (): void => {
      if (!active || phase === 'loaded') return;
      const token = image.dataset.gnosiRemoteToken?.trim() || '';
      const fallback = document.createElement('span');
      fallback.className = 'gnosi-remote-image-fallback';
      if (token) renderFailure(fallback, token);
      else {
        phase = 'failed';
        fallback.setAttribute('role', 'img');
        renderFinalCopy(fallback);
      }
      image.replaceWith(fallback);
      options.onStateChange?.();
    };
    const offerRecovery = (): void => {
      if (!active || phase !== 'pending') return;
      const token = image.dataset.gnosiRemoteToken?.trim() || '';
      if (!token || !options.recoverSource) {
        showFailedImage();
        return;
      }
      phase = 'offered';
      const fallback = document.createElement('span');
      fallback.className = 'gnosi-remote-image-fallback';
      fallback.dataset.gnosiRemoteImage = 'recovery-offered';
      fallback.setAttribute('aria-label', options.fallbackLabel);
      fallback.setAttribute('role', 'group');
      const label = document.createElement('span');
      label.textContent = `▧ ${options.recoveryPromptLabel}`;
      fallback.append(label);
      appendAction(fallback, token, options.recoveryActionLabel);
      image.replaceWith(fallback);
      options.onStateChange?.();
    };
    const markLoaded = (): void => {
      if (phase !== 'recovered' || !image.isConnected) return;
      phase = 'loaded';
      clearTimers();
      image.dataset.gnosiRemoteImage = 'loaded';
      releaseRecoveredSource();
      options.onStateChange?.();
    };
    const unsubscribeLoad = subscribeElementEvent(image, 'load', markLoaded);
    const unsubscribeError = subscribeElementEvent(image, 'error', () => {
      if (phase === 'recovered') showFailedImage();
    });
    cleanups.push(() => {
      active = false;
      clearTimers();
      releaseRecoveredSource();
      unsubscribeLoad();
      unsubscribeError();
    });

    if (image.dataset.gnosiRemoteImage === 'blocked') {
      showFailedImage();
      return;
    }
    offerRecovery();
  };

  document
    .querySelectorAll<HTMLImageElement>('img[data-gnosi-remote-image]')
    .forEach((image) => {
      monitor(image);
    });
  return () => { cleanups.forEach((cleanup) => { cleanup(); }); };
}
