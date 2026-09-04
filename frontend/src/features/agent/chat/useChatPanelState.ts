import { useCallback, useReducer, type SetStateAction } from 'react';

interface PanelState {
  readonly embedded: boolean;
  readonly isOpen: boolean;
  readonly isMinimized: boolean;
}
type PanelAction = { readonly type: 'embedding'; readonly value: boolean }
  | { readonly type: 'open' | 'minimized'; readonly value: SetStateAction<boolean> };

export function chatPanelReducer(state: PanelState, action: PanelAction): PanelState {
  if (action.type === 'embedding') {
    return { embedded: action.value, isOpen: action.value || state.isOpen, isMinimized: action.value ? false : state.isMinimized };
  }
  const field = action.type === 'open' ? 'isOpen' : 'isMinimized';
  const value = typeof action.value === 'function' ? action.value(state[field]) : action.value;
  return value === state[field] ? state : { ...state, [field]: value };
}

export function useChatPanelState(embedded: boolean, initiallyOpen = false) {
  const [state, dispatch] = useReducer(chatPanelReducer, { embedded, isOpen: embedded || initiallyOpen, isMinimized: false });
  // Adjust before committing a changed mode; there is no effect-driven second paint.
  if (state.embedded !== embedded) dispatch({ type: 'embedding', value: embedded });
  const setIsOpen = useCallback((value: SetStateAction<boolean>) => { dispatch({ type: 'open', value }); }, []);
  const setIsMinimized = useCallback((value: SetStateAction<boolean>) => { dispatch({ type: 'minimized', value }); }, []);
  return { isOpen: state.isOpen, isMinimized: state.isMinimized, setIsOpen, setIsMinimized };
}
