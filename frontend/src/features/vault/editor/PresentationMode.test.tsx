import { act } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { dispatchWindowEvent } from '../../../shared/platform/browser-events';
import { mountTestComponent } from '../../../../tests/mount-react';
import PresentationMode from './PresentationMode';

vi.mock('../../../shared/editor/VaultMarkdown', () => ({ VaultMarkdown: ({ md }: { md: string }) => <article>{md}</article> }));

function key(name: string) {
  const event = new KeyboardEvent('keydown', { key: name, cancelable: true, bubbles: true });
  act(() => { dispatchWindowEvent(event); });
  return event;
}

describe('presentation session', () => {
  it('preserves separators, navigation keys, bounds and Escape without retaining listeners', () => {
    const onClose = vi.fn();
    const mounted = mountTestComponent(<PresentationMode isOpen onClose={onClose} markdown={'---\ntitle: Hidden\n---\n# One\n\n---\n\n# Two'} />);
    expect(mounted.container.querySelector('article')?.textContent).toBe('# One');
    expect(key('ArrowRight').defaultPrevented).toBe(true);
    expect(mounted.container.querySelector('article')?.textContent).toBe('# Two');
    key('PageDown'); expect(mounted.container.querySelector('span')?.textContent).toBe('2 / 2');
    key('ArrowLeft'); expect(mounted.container.querySelector('span')?.textContent).toBe('1 / 2');
    key(' '); key('PageUp'); key('PageUp');
    expect(mounted.container.querySelector('span')?.textContent).toBe('1 / 2');
    key('Escape'); expect(onClose).toHaveBeenCalledOnce();
    mounted.unmount(); expect(key('Escape').defaultPrevented).toBe(false);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('starts each new opening at the first slide and uses the current close callback', () => {
    const onClose = vi.fn(); const nextClose = vi.fn(); const markdown = '# One\nBody\n## Two\nBody';
    const mounted = mountTestComponent(<PresentationMode isOpen onClose={onClose} markdown={markdown} />);
    key('ArrowRight'); expect(mounted.container.querySelector('span')?.textContent).toBe('2 / 2');
    mounted.render(<PresentationMode isOpen={false} onClose={onClose} markdown={markdown} />);
    expect(mounted.container.children).toHaveLength(0); key('Escape'); expect(onClose).not.toHaveBeenCalled();
    mounted.render(<PresentationMode isOpen onClose={nextClose} markdown={markdown} />);
    expect(mounted.container.querySelector('span')?.textContent).toBe('1 / 2');
    key('Escape'); expect(nextClose).toHaveBeenCalledOnce(); expect(onClose).not.toHaveBeenCalled();
  });
});
