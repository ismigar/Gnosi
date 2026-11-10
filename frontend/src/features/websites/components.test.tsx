import { act } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { mountTestComponent } from '../../../tests/mount-react';
import { Card } from './components';

describe('website cards', () => {
  it('exposes editing controls and actions without an outer disclosure by default', () => {
    const save = vi.fn();
    const view = mountTestComponent(
      <Card title="Website settings" actions={<button onClick={save}>Save</button>}>
        <label>Website name<input defaultValue="Draft website" /></label>
      </Card>,
    );
    const input = view.container.querySelector('input');
    expect(input?.closest('details')).toBeNull();
    expect(input?.value).toBe('Draft website');
    expect(view.container.querySelector('h2')?.textContent).toBe('Website settings');
    const button = view.container.querySelector('button');
    expect(button).not.toBeNull();
    act(() => { button?.click(); });
    expect(save).toHaveBeenCalledOnce();
  });

  it('keeps explicitly foldable cards and preserves their drafts across folding', () => {
    const view = mountTestComponent(
      <Card title="Optional group" collapsible>
        <input aria-label="Draft" defaultValue="Original" />
      </Card>,
    );
    const details = view.container.querySelector('details');
    const input = view.container.querySelector('input');
    if (!details || !input) throw new Error('Missing foldable card or draft');
    expect(details.open).toBe(false);
    input.value = 'Unsaved draft';
    for (const open of [true, false, true]) {
      act(() => {
        details.open = open;
        details.dispatchEvent(new Event('toggle'));
      });
      expect(details.open).toBe(open);
      expect(view.container.querySelector('input')).toBe(input);
      expect(input.value).toBe('Unsaved draft');
    }
  });
});
