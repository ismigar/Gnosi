import { useEffect } from 'react';

const MODALITY_ATTRIBUTE = 'data-focus-modality';

/** Tracks whether focus was reached with a keyboard or a pointing device. */
export function useFocusModality() {
  useEffect(() => {
    const root = document.documentElement;
    const setKeyboardModality = (event) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      root.setAttribute(MODALITY_ATTRIBUTE, 'keyboard');
    };
    const setPointerModality = () => {
      root.setAttribute(MODALITY_ATTRIBUTE, 'pointer');
    };

    if (!root.hasAttribute(MODALITY_ATTRIBUTE)) {
      root.setAttribute(MODALITY_ATTRIBUTE, 'keyboard');
    }
    document.addEventListener('keydown', setKeyboardModality, true);
    document.addEventListener('pointerdown', setPointerModality, true);

    return () => {
      document.removeEventListener('keydown', setKeyboardModality, true);
      document.removeEventListener('pointerdown', setPointerModality, true);
      root.removeAttribute(MODALITY_ATTRIBUTE);
    };
  }, []);
}
