import type { CSSProperties } from 'react';

export function configurableGap(gap: string): CSSProperties & { '--settings-configurable-gap': string } {
  return { '--settings-configurable-gap': gap };
}
