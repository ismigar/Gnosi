import { act } from 'react';
import { expect, test, vi } from 'vitest';
import { mountTestComponent } from '../../../tests/mount-react';
import { ConnectionAuthentication } from './ConnectionAuthentication';
import type { TargetConnection } from '../../shared/api/sites';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
const connection: TargetConnection = { host: 'ssh.example.org', username: 'publisher', port: 22, authentication: 'password', password_configured: true, local_port: 4321, remote_root: '', remote_private_root: '', document_root: '', ssh_key_reference: '', identity_file: '', transfer_protocol: 'ssh' };
function required<T>(value: T | null | undefined): T { if (value == null) throw new Error('Missing credential control'); return value; }
function editPassword(container: HTMLElement, value: string) {
  const input = required(container.querySelector<HTMLInputElement>('input[type=password]'));
  act(() => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, value); input.dispatchEvent(new Event('input', { bubbles: true })); });
  return input;
}
function button(container: HTMLElement, key: string) { return required([...container.querySelectorAll<HTMLButtonElement>('button')].find(item => item.textContent === key)); }
async function settle() { await act(async () => { await Promise.resolve(); await Promise.resolve(); }); }

test('password input starts blank and saving is explicit, not triggered while typing', async () => {
  const save = vi.fn().mockResolvedValue(true);
  const view = mountTestComponent(<ConnectionAuthentication value={connection} disabled={false} canSave={true} update={vi.fn()} savePassword={save} />);
  expect(view.container.querySelector<HTMLInputElement>('input[type=password]')?.value).toBe('');
  const input = editPassword(view.container, 'synthetic-password'); expect(save).not.toHaveBeenCalled();
  act(() => { button(view.container, 'websites.saveConnectionPassword').click(); }); await settle();
  expect(save).toHaveBeenCalledWith('synthetic-password'); expect(input.value).toBe('');
  view.unmount();
});

test('failed credential storage preserves the typed password for a deliberate retry', async () => {
  const save = vi.fn().mockResolvedValue(false);
  const view = mountTestComponent(<ConnectionAuthentication value={connection} disabled={false} canSave={true} update={vi.fn()} savePassword={save} />);
  const input = editPassword(view.container, 'synthetic-password');
  act(() => { button(view.container, 'websites.saveConnectionPassword').click(); }); await settle();
  expect(input.value).toBe('synthetic-password'); view.unmount();
});

test('pending connection edits block saving credentials against the old remote account', async () => {
  const save = vi.fn(); const view = mountTestComponent(<ConnectionAuthentication value={connection} disabled={false} canSave={false} update={vi.fn()} savePassword={save} />);
  editPassword(view.container, 'synthetic-password');
  expect(button(view.container, 'websites.saveConnectionPassword').disabled).toBe(true);
  act(() => { button(view.container, 'websites.saveConnectionPassword').click(); }); await settle();
  expect(save).not.toHaveBeenCalled(); view.unmount();
});
