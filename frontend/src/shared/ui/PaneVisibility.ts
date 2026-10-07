import { createContext, useContext } from 'react';

// Mounted document tabs keep their state while hidden. Global keyboard
// listeners inside them must yield to the visible pane.
export const PaneVisibilityContext = createContext<boolean | undefined>(undefined);

export function usePaneVisibility(): boolean {
  return useContext(PaneVisibilityContext) ?? true;
}
