import { Virtualizer, elementScroll, observeElementOffset, observeElementRect } from '@tanstack/react-virtual';
import type { VirtualItem, VirtualizerOptions } from '@tanstack/react-virtual';
import { flushSync } from 'react-dom';

type TableVirtualizer = Virtualizer<HTMLDivElement, HTMLTableRowElement>;
type CoreOptions = VirtualizerOptions<HTMLDivElement, HTMLTableRowElement>;
export type TableVirtualizerOptions = Pick<CoreOptions, 'count' | 'getScrollElement' | 'estimateSize'>
  & Partial<CoreOptions>;
export interface TableVirtualSnapshot {
  readonly virtualRows: readonly VirtualItem[];
  readonly totalSize: number;
}

function sameItems(left: readonly VirtualItem[], right: readonly VirtualItem[]) {
  return left.length === right.length && left.every((item, index) => {
    const other = right[index];
    return other !== undefined && item.key === other.key && item.index === other.index
      && item.start === other.start && item.end === other.end
      && item.size === other.size && item.lane === other.lane;
  });
}

/** The mutable TanStack engine stays outside React's render reads. React sees
 * cached value snapshots and stable commands, including on same-instance scroll
 * and measurement updates. No hook alias or compiler opt-out is involved. */
export function createTableVirtualizerStore(initialOptions: TableVirtualizerOptions) {
  const listeners = new Set<() => void>();
  let snapshot: TableVirtualSnapshot = { virtualRows: [], totalSize: 0 };
  const publish = (instance: TableVirtualizer, sync: boolean) => {
    const items = instance.getVirtualItems();
    const totalSize = instance.getTotalSize();
    if (snapshot.totalSize === totalSize && sameItems(snapshot.virtualRows, items)) return;
    snapshot = { virtualRows: items.map(item => ({ ...item })), totalSize };
    const notify = () => { for (const listener of listeners) listener(); };
    if (sync) flushSync(notify);
    else notify();
  };
  const optionsFor = (options: TableVirtualizerOptions): CoreOptions => ({
    observeElementRect,
    observeElementOffset,
    scrollToFn: elementScroll,
    measureElement: element => element.getBoundingClientRect().height || 56,
    overscan: 8,
    scrollPaddingStart: 44,
    scrollPaddingEnd: 56,
    ...options,
    onChange: (instance, sync) => {
      publish(instance, sync);
      options.onChange?.(instance, sync);
    },
  });
  const instance = new Virtualizer(optionsFor(initialOptions));
  publish(instance, false);
  return {
    getSnapshot: () => snapshot,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    mount: () => instance._didMount(),
    update: (options: TableVirtualizerOptions) => {
      instance.setOptions(optionsFor(options));
      instance._willUpdate();
      publish(instance, false);
    },
    commands: {
      scrollToIndex: instance.scrollToIndex,
      measureElement: instance.measureElement,
    },
  };
}
