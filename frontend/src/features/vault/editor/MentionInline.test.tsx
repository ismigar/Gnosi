import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { subscribeWindowEvent } from '../../../shared/platform/browser-events';
import { mountTestComponent } from '../../../../tests/mount-react';
import MentionInline from './MentionInline';

const initialUrl = window.location.href;
afterEach(() => { window.history.replaceState(null, '', initialUrl); });

describe('contact mention navigation', () => {
  it('preserves the encoded route, native navigation event and click isolation', () => {
    const parentClick = vi.fn(); const navigation = vi.fn();
    const stop = subscribeWindowEvent('popstate', navigation);
    try {
      const mounted = mountTestComponent(<div onClick={parentClick}><MentionInline inlineContent={{ props: { id: 'contact/à&1', name: ' Mercè ' } }} /></div>);
      const mention = mounted.container.querySelector('span');
      if (!mention) throw new Error('Expected contact mention');
      const click = new MouseEvent('click', { bubbles: true, cancelable: true });
      act(() => { mention.dispatchEvent(click); });
      expect(mention.textContent).toBe('@Mercè');
      expect(window.location.pathname + window.location.search).toBe('/contacts?id=contact%2F%C3%A0%261');
      expect(navigation).toHaveBeenCalledOnce();
      expect(navigation.mock.calls[0]?.[0]).toBeInstanceOf(PopStateEvent);
      expect(click.defaultPrevented).toBe(true); expect(parentClick).not.toHaveBeenCalled();
    } finally { stop(); }
  });

  it('does not navigate a mention without a contact id', () => {
    const navigation = vi.fn(); const stop = subscribeWindowEvent('popstate', navigation);
    try {
      const mounted = mountTestComponent(<MentionInline />);
      const mention = mounted.container.querySelector('span');
      if (!mention) throw new Error('Expected contact mention');
      act(() => { mention.click(); });
      expect(mention.textContent).toBe('@Algú');
      expect(window.location.href).toBe(initialUrl); expect(navigation).not.toHaveBeenCalled();
    } finally { stop(); }
  });
});
