import { act } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { mountTestComponent } from '../../../tests/mount-react';
import type { SiteConfig } from '../../shared/api/sites';
import { CapturedMailViewer, capturedDisplayHtml } from './CapturedMailViewer';
import { decodeCapturedMail } from './serviceModels';
import type { PrivateCall } from './PrivatePanels';

vi.mock('react-i18next', () => { const t = (key: string) => key; return { useTranslation: () => ({ t }) }; });
const id = 'a'.repeat(32);
const site: SiteConfig = { id: 'site', name: 'Test', origin: 'https://example.invalid', schema_version: 1, revision: 1, legacy_pilot: false, languages: ['ca', 'es'], default_language: 'ca' };
const capture = { test_mode: true, id, to_email: 'reader@example.invalid', subject: 'Synthetic confirmation', body_text: 'Readable synthetic body', body_html: '<p>HTML preview</p>', subscriber: { language: 'ca', interests: ['original'] }, links: [{ index: 0, action: 'preferences', url: 'https://example.invalid/pilot/api/newsletter.php?action=preferences&token=' + 'b'.repeat(64) + '&language=ca', language: 'ca', list_id: 'main', state: 'ready' }] };
const settle = async () => { await act(async () => { await Promise.resolve(); await Promise.resolve(); }); };
function button(container: HTMLElement, key: string) { const value = [...container.querySelectorAll('button')].find(item => item.textContent === key); if (!value) throw new Error('Missing '+key); return value; }

describe('private synthetic captured mail', () => {
  it('reads only on demand and never applies an action by opening or previewing mail', async () => {
    const call = vi.fn<PrivateCall>().mockResolvedValue(capture);
    const view = mountTestComponent(<CapturedMailViewer id={id} site={site} call={call} onClose={vi.fn()} onChanged={vi.fn()} />); await settle();
    expect(call.mock.calls).toEqual([['captured_get', { id }]]);
    expect(view.container.textContent).toContain('Readable synthetic body');
    expect(document.activeElement).toBe(view.container.querySelector('[tabindex="-1"]'));
    act(() => { button(view.container, 'websites.captureHtml').click(); });
    const frame = view.container.querySelector('iframe');
    expect(frame?.getAttribute('sandbox')).toBe('');
    expect(frame?.getAttribute('srcdoc')).toContain("default-src 'none'");
    expect(frame?.getAttribute('srcdoc')).toContain('HTML preview');
    expect(call).toHaveBeenCalledTimes(1);
    const link = view.container.querySelector('a');
    expect(link?.target).toBe('_blank'); expect(link?.rel).toContain('noreferrer');
  });

  it('requires an explicit form submission and retains preference inputs after a recoverable error', async () => {
    const call = vi.fn<PrivateCall>().mockImplementation(action => action === 'captured_get' ? Promise.resolve(capture) : Promise.reject(new Error('Unavailable')));
    const view = mountTestComponent(<CapturedMailViewer id={id} site={site} call={call} onClose={vi.fn()} onChanged={vi.fn()} />); await settle();
    act(() => { button(view.container, 'websites.captureTestLink').click(); });
    expect(call).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(view.container.querySelector('select'));
    const input = view.container.querySelector('input'); const select = view.container.querySelector('select');
    act(() => {
      if (input) { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, 'first, second'); input.dispatchEvent(new Event('input', { bubbles: true })); }
      if (select) { select.value = 'es'; select.dispatchEvent(new Event('change', { bubbles: true })); }
    });
    act(() => { view.container.querySelector('form')?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); }); await settle();
    expect(call).toHaveBeenLastCalledWith('captured_apply', { id, link_index: 0, language: 'es', interests: ['first', 'second'] });
    expect(input?.value).toBe('first, second'); expect(select?.value).toBe('es');
    expect(view.container.querySelector('[role="alert"]')?.textContent).toBe('websites.captureActionFailed');
  });

  it('refreshes link availability after confirmation and prevents a second application', async () => {
    const mail = { ...capture, links: [{ ...capture.links[0], action: 'confirm' }] };
    const call = vi.fn<PrivateCall>().mockImplementation(action => Promise.resolve(action === 'captured_get' ? mail : { ...mail, action_applied: true, links: [{ ...mail.links[0], state: 'used' }] }));
    const onChanged = vi.fn();
    const view = mountTestComponent(<CapturedMailViewer id={id} site={site} call={call} onClose={vi.fn()} onChanged={onChanged} />); await settle();
    act(() => { button(view.container, 'websites.captureTestLink').click(); });
    act(() => { view.container.querySelector('form')?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); }); await settle();
    expect(call).toHaveBeenLastCalledWith('captured_apply', { id, link_index: 0 });
    expect(onChanged).toHaveBeenCalledOnce();
    expect(button(view.container, 'websites.captureTestLink').disabled).toBe(true);
    expect(view.container.querySelector('form')).toBeNull();
  });

  it('discards a late private response after switching the selected capture', async () => {
    let finish: (value: unknown) => void = () => undefined;
    const otherId = 'c'.repeat(32);
    const call = vi.fn<PrivateCall>().mockImplementation((_action, request) => request?.id === id ? new Promise(resolve => { finish = resolve; }) : Promise.resolve({ ...capture, id: otherId, subject: 'Current private mail' }));
    const props = { site, call, onClose: vi.fn(), onChanged: vi.fn() };
    const view = mountTestComponent(<CapturedMailViewer key={id} id={id} {...props} />); await settle();
    view.render(<CapturedMailViewer key={otherId} id={otherId} {...props} />); await settle();
    await act(async () => { finish(capture); await Promise.resolve(); });
    expect(view.container.textContent).toContain('Current private mail');
    expect(view.container.textContent).not.toContain('Synthetic confirmation');
  });

  it('does not accept live mail or executable links from a malformed response', () => {
    expect(decodeCapturedMail({ ...capture, test_mode: false })).toBeNull();
    expect(decodeCapturedMail({ ...capture, links: [{ ...capture.links[0], url: 'javascript:alert(1)' }] })?.links).toEqual([]);
  });

  it('removes navigation, forms, remote assets and executable markup from HTML mail', () => {
    const html = capturedDisplayHtml('<p onclick="alert(1)" style="color:red">Readable</p><a href="https://other.invalid" ping="https://other.invalid">Link</a><img src="https://other.invalid/pixel"><iframe src="https://other.invalid"></iframe><svg><script>alert(1)</script></svg><form action="https://other.invalid"><input name="secret"></form><meta http-equiv="refresh" content="0;url=https://other.invalid">');
    const document = new DOMParser().parseFromString(html, 'text/html');
    expect(document.body.textContent).toContain('Readable'); expect(document.body.textContent).toContain('Link');
    expect(document.querySelector('img,iframe,svg,script,form,input,meta,[href],[onclick],[ping]')).toBeNull();
    expect(document.querySelector('p')?.getAttribute('style')).toBe('color:red');
  });
});
