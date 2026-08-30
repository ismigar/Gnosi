import type { ReactNode } from 'react';

export interface PickerOptions {
  readonly options?: readonly string[];
  readonly idToTitle?: Readonly<Record<string, string>>;
  readonly optionColors?: Readonly<Record<string, string>>;
  readonly onCreate?: (value: string) => void;
  readonly onDeleteOption?: (value: string) => void;
}

export interface InlineSelectPickerProps extends PickerOptions {
  readonly value?: string;
  readonly onSave: (value: string) => void;
}

export interface InlinePillsPickerProps extends PickerOptions {
  readonly value?: readonly string[];
  readonly onSave: (values: readonly string[]) => void;
  readonly relationItems?: boolean;
  readonly onOpenRelation?: (id: string) => void;
  readonly onRemoveRelation?: (id: string) => boolean | undefined | Promise<boolean | undefined>;
}

export interface InfiniteLoadSentinelProps {
  readonly visibleCount: number;
  readonly total: number;
  readonly batchSize: number;
  readonly onLoadMore: () => void;
  readonly label: ReactNode;
}

/** Portaled choices remain inside the picker despite their separate DOM parent. */
export function isOutsidePicker(container: HTMLElement | null, target: EventTarget | null): boolean {
  if (!container) return false;
  const view = container.ownerDocument.defaultView;
  if (!view || !(target instanceof view.Node)) return true;
  return !container.contains(target)
    && !(target instanceof view.Element && target.closest('[data-cell-dropdown]'));
}
