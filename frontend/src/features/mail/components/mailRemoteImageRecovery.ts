import { subscribeElementEvent } from '../../../shared/platform/browser-events';
import type { RemoteMailImageFailureReason } from '../../../shared/api/mail-specialized';


interface RemoteMailImageRecoveryOptions {
  readonly fallbackLabel: string;
  readonly fallbackDetail: string;
  readonly failureDetail?: (reason: RemoteMailImageFailureReason) => string;
  readonly openOriginalLabel: string;
  readonly onStateChange?: () => void;
  readonly openOriginalSource?: (token: string) => void;
  readonly recoveryPromptLabel: string;
  readonly recoveryActionLabel: string;
  readonly recoveringLabel: string;
  readonly retryLabel: string;
  readonly recoverSource?: (token: string) => Promise<RemoteImageRecoveryResult>;
  readonly releaseRecoveredSource?: (source: string) => void;
  readonly timeoutMs?: number;
  readonly maxRetries?: number;
}


export type RemoteImageRecoveryResult =
  | { readonly source: string }
  | { readonly error: RemoteMailImageFailureReason };


interface RemoteImagePresentation {
  readonly alt: string;
  readonly height: number | null;
  readonly width: number | null;
}


function boundedDimension(value: string | null, maximum: number): number | null {
  if (!value || !/^\d+(?:\.\d+)?$/.test(value.trim())) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, maximum) : null;
}


function readPresentation(image: HTMLImageElement): RemoteImagePresentation {
  return {
    alt: image.getAttribute('alt')?.trim() || '',
    height: boundedDimension(image.getAttribute('height'), 1200),
    width: boundedDimension(image.getAttribute('width'), 1600),
  };
}


export function installRemoteMailImageRecovery(
  document: Document,
  options: RemoteMailImageRecoveryOptions,
): () => void {
  const timeoutMs = options.timeoutMs ?? 8000;
  const maxRetries = options.maxRetries ?? 3;
  const cleanups: Array<() => void> = [];

  const monitor = (image: HTMLImageElement): void => {
    if (image.dataset.gnosiRecoveryInstalled === 'true') return;
    image.dataset.gnosiRecoveryInstalled = 'true';
    let active = true;
    let phase: 'pending' | 'offered' | 'recovering' | 'recovered' | 'failed' | 'loaded'
      = 'pending';
    let recoveredSource: string | null = null;
    let activeFallback: HTMLElement | null = null;
    let timeoutTimer: ReturnType<typeof setTimeout> | undefined;
    let recoveryAttempts = 0;
    let failureReason: RemoteMailImageFailureReason = 'unavailable';
    const presentation = readPresentation(image);
    const localImage = image.dataset.gnosiLocalImage === 'pending';

    const clearTimers = (): void => {
      if (timeoutTimer !== undefined) {
        clearTimeout(timeoutTimer);
        timeoutTimer = undefined;
      }
    };
    const releaseRecoveredSource = (): void => {
      if (!recoveredSource) return;
      options.releaseRecoveredSource?.(recoveredSource);
      recoveredSource = null;
    };
    const applyPresentation = (fallback: HTMLElement): void => {
      if (presentation.width !== null) {
        fallback.style.inlineSize = `${String(presentation.width)}px`;
        fallback.style.minInlineSize = `${String(presentation.width)}px`;
      }
      if (presentation.height !== null) {
        fallback.style.blockSize = `${String(presentation.height)}px`;
        fallback.style.minBlockSize = `${String(presentation.height)}px`;
      }
      if (presentation.width !== null && presentation.height !== null) {
        fallback.style.aspectRatio = `${String(presentation.width)} / ${String(presentation.height)}`;
      }
    };
    const renderCopy = (
      fallback: HTMLElement,
      labelText: string,
      detailText?: string,
    ): void => {
      applyPresentation(fallback);
      fallback.setAttribute(
        'aria-label',
        presentation.alt ? `${presentation.alt} — ${labelText}` : labelText,
      );
      fallback.replaceChildren();
      const label = document.createElement('span');
      label.textContent = `▧ ${labelText}`;
      fallback.append(label);
      if (presentation.alt) {
        const alt = document.createElement('span');
        alt.className = 'gnosi-remote-image-alt';
        alt.textContent = presentation.alt;
        fallback.append(alt);
      }
      if (detailText) {
        const detail = document.createElement('span');
        detail.className = 'gnosi-remote-image-detail';
        detail.textContent = detailText;
        fallback.append(detail);
      }
    };
    const renderFinalCopy = (fallback: HTMLElement): void => {
      fallback.dataset.gnosiRemoteImage = 'unavailable';
      fallback.dataset.gnosiRemoteImageReason = failureReason;
      renderCopy(
        fallback,
        options.fallbackLabel,
        options.failureDetail?.(failureReason) ?? options.fallbackDetail,
      );
    };
    const startRecovery = (fallback: HTMLElement, token: string): void => {
      if (!active || !options.recoverSource
        || recoveryAttempts >= maxRetries
        || (phase !== 'offered' && phase !== 'failed')) return;
      recoveryAttempts += 1;
      phase = 'recovering';
      fallback.dataset.gnosiRemoteImage = 'recovering';
      fallback.setAttribute('aria-live', 'polite');
      const button = fallback.querySelector<HTMLButtonElement>('button');
      if (button) {
        button.disabled = true;
        button.textContent = options.recoveringLabel;
      }
      void options.recoverSource(token).then((result) => {
        if (!active || phase !== 'recovering' || !fallback.isConnected) {
          if ('source' in result) options.releaseRecoveredSource?.(result.source);
          return;
        }
        if ('error' in result) {
          failureReason = result.error;
          renderFailure(fallback, token);
          return;
        }
        recoveredSource = result.source;
        phase = 'recovered';
        image.dataset.gnosiRemoteImage = 'recovered';
        timeoutTimer = setTimeout(showFailedImage, timeoutMs);
        image.src = result.source;
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
      action: () => void,
      className: string,
    ): void => {
      const button = document.createElement('button');
      button.className = className;
      button.type = 'button';
      button.textContent = label;
      const unsubscribeClick = subscribeElementEvent(button, 'click', action);
      cleanups.push(unsubscribeClick);
      fallback.append(button);
    };
    const appendActions = (fallback: HTMLElement, token: string, label: string): void => {
      const actions = document.createElement('span');
      actions.className = 'gnosi-remote-image-actions';
      if (options.recoverSource && recoveryAttempts < maxRetries) {
        appendAction(
          actions,
          token,
          label,
          () => { startRecovery(fallback, token); },
          'gnosi-remote-image-action gnosi-remote-image-recover',
        );
      }
      if (options.openOriginalSource) {
        appendAction(
          actions,
          token,
          options.openOriginalLabel,
          () => { options.openOriginalSource?.(token); },
          'gnosi-remote-image-action gnosi-remote-image-open-original',
        );
      }
      fallback.append(actions);
    };
    const renderFailure = (fallback: HTMLElement, token: string): void => {
      clearTimers();
      releaseRecoveredSource();
      phase = 'failed';
      activeFallback = fallback;
      fallback.setAttribute('role', 'group');
      renderFinalCopy(fallback);
      appendActions(fallback, token, options.retryLabel);
      options.onStateChange?.();
    };
    const showFailedImage = (): void => {
      if (!active || phase === 'loaded') return;
      const token = image.dataset.gnosiRemoteToken?.trim() || '';
      const fallback = activeFallback?.isConnected
        ? activeFallback
        : document.createElement('span');
      fallback.className = 'gnosi-remote-image-fallback';
      if (token) renderFailure(fallback, token);
      else {
        phase = 'failed';
        activeFallback = fallback;
        fallback.setAttribute('role', 'img');
        renderFinalCopy(fallback);
      }
      if (image.isConnected) image.replaceWith(fallback);
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
      activeFallback = fallback;
      fallback.className = 'gnosi-remote-image-fallback';
      fallback.dataset.gnosiRemoteImage = 'recovery-offered';
      fallback.setAttribute('role', 'group');
      renderCopy(fallback, options.recoveryPromptLabel);
      appendActions(fallback, token, options.recoveryActionLabel);
      image.replaceWith(fallback);
      options.onStateChange?.();
    };
    const markLoaded = (): void => {
      if (localImage && phase === 'pending') {
        phase = 'loaded';
        clearTimers();
        image.dataset.gnosiLocalImage = 'loaded';
        options.onStateChange?.();
        return;
      }
      if (phase !== 'recovered' || !activeFallback?.isConnected) return;
      phase = 'loaded';
      clearTimers();
      image.dataset.gnosiRemoteImage = 'loaded';
      activeFallback.replaceWith(image);
      activeFallback = null;
      options.onStateChange?.();
    };
    const unsubscribeLoad = subscribeElementEvent(image, 'load', markLoaded);
    const unsubscribeError = subscribeElementEvent(image, 'error', () => {
      if (phase === 'recovered' || (localImage && phase === 'pending')) {
        showFailedImage();
      }
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
    if (localImage) {
      if (image.complete) {
        if (image.naturalWidth > 0) markLoaded();
        else showFailedImage();
        return;
      }
      timeoutTimer = setTimeout(showFailedImage, timeoutMs);
      return;
    }
    offerRecovery();
  };

  document
    .querySelectorAll<HTMLImageElement>(
      'img[data-gnosi-remote-image], img[data-gnosi-local-image]',
    )
    .forEach((image) => {
      monitor(image);
    });
  return () => { cleanups.forEach((cleanup) => { cleanup(); }); };
}
