import { act, type ComponentProps } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AccountProviderChoices } from './AccountProviderChoices';
import { DavAccountForm } from './DavAccountForm';
import { accountProviderForEmail } from './accountProviders';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

type ProviderContext = ComponentProps<typeof AccountProviderChoices>['context'];
type DavContext = ComponentProps<typeof DavAccountForm>['context'];
let root: Root;
let container: HTMLDivElement;
let context: ProviderContext & DavContext;

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  context = {
    activeTab: 'calendar', addAccountEmail: '', addAccountEmailBlurred: false,
    isManualGoogle: false, editingAccountId: null, integrations: {},
    manualPassword: '', manualServer: '', loadIntegrations: vi.fn(),
    setMailImapEnc: vi.fn(), setMailImapHost: vi.fn(), setMailImapPort: vi.fn(), setMailImapUser: vi.fn(),
    setMailSmtpEnc: vi.fn(), setMailSmtpHost: vi.fn(), setMailSmtpPort: vi.fn(), setMailSmtpUser: vi.fn(),
    setAddAccountEmail: vi.fn(), setAddAccountType: vi.fn(), setEditingAccountId: vi.fn(),
    setIsManualGoogle: vi.fn(), setManualPassword: vi.fn(), setManualServer: vi.fn(), setSavingStatus: vi.fn(),
    tn: (key, options) => key === 'accounts.continue_with' ? `Continue with ${String(options?.provider)}` : key,
  };
});

afterEach(() => {
  act(() => { root.unmount(); });
  container.remove();
  vi.unstubAllGlobals();
});

function render() {
  act(() => { root.render(<><AccountProviderChoices context={context} /><DavAccountForm context={context} /></>); });
}

function providerButtons() {
  return Array.from(container.querySelectorAll('button')).filter(button => button.querySelector(':scope > span')?.textContent.startsWith('Continue with '));
}

describe('account provider detection and choices', () => {
  it.each([
    ['gmail.com', 'Google'], ['googlemail.com', 'Google'],
    ['outlook.com', 'Microsoft'], ['hotmail.com', 'Microsoft'], ['live.com', 'Microsoft'], ['msn.com', 'Microsoft'],
    ['icloud.com', 'iCloud'], ['me.com', 'iCloud'], ['mac.com', 'iCloud'],
    ['yahoo.com', 'Yahoo'], ['ymail.com', 'Yahoo'], ['yahoo.es', 'Yahoo'], ['aol.com', 'AOL'],
  ])('recognizes %s before blur without asking the provider again', (domain, provider) => {
    context.addAccountEmail = ` User+calendar@${domain.toUpperCase()} `;
    render();
    expect(providerButtons().map(button => button.querySelector('span')?.textContent)).toEqual([`Continue with ${provider}`]);
    expect(container.textContent).not.toContain('accounts.select_provider');
    expect(container.textContent).not.toContain('accounts.is_google');
    expect(context.setIsManualGoogle).not.toHaveBeenCalled();
    expect(context.setMailImapHost).not.toHaveBeenCalled();
  });

  it.each(['', 'user@', 'user@gmail', 'user@@gmail.com', 'user name@gmail.com'])('does not offer providers for incomplete or malformed %s', email => {
    context.addAccountEmail = email;
    context.addAccountEmailBlurred = true;
    render();
    expect(providerButtons()).toHaveLength(0);
    expect(container.textContent).not.toContain('accounts.is_google');
  });

  it.each(['user@example.test', 'user@notgmail.com', 'user@gmail.com.example.test', 'user@sub.gmail.com'])('keeps unknown domain %s available for manual choice', email => {
    expect(accountProviderForEmail(email)).toBeNull();
    context.addAccountEmail = email;
    render();
    expect(providerButtons()).toHaveLength(0);
    context.addAccountEmailBlurred = true;
    render();
    expect(providerButtons()).toHaveLength(5);
    expect(container.textContent).toContain('accounts.select_provider');
    const googleChoice = Array.from(container.querySelectorAll('button')).find(button => button.textContent === 'accounts.is_google');
    expect(googleChoice?.type).toBe('button');
    act(() => { googleChoice?.click(); });
    expect(context.setIsManualGoogle).toHaveBeenCalledWith(true);
    expect(context.setSavingStatus).not.toHaveBeenCalled();
    context.isManualGoogle = true;
    render();
    expect(providerButtons().map(button => button.textContent)).toEqual(['Continue with Google']);
  });

  it('updates the detected provider when the email changes and never overrides a known domain with a stale manual choice', () => {
    context.addAccountEmail = 'user@gmail.com';
    render();
    expect(providerButtons()[0]?.textContent).toBe('Continue with Google');
    context.addAccountEmail = 'user@outlook.com';
    context.isManualGoogle = true;
    render();
    expect(providerButtons().map(button => button.textContent)).toEqual(['Continue with Microsoft']);
    context.addAccountEmail = 'user@example.test';
    context.isManualGoogle = false;
    render();
    expect(providerButtons()).toHaveLength(0);
  });

  it('centers each icon and label together as one group', () => {
    context.addAccountEmail = 'user@example.test';
    context.addAccountEmailBlurred = true;
    render();
    for (const button of providerButtons()) {
      expect(button.type).toBe('button');
      expect(button.style.display).toBe('flex');
      expect(button.style.justifyContent).toBe('center');
      expect(button.style.textAlign).toBe('center');
      expect(button.children[1]?.tagName).toBe('SPAN');
      expect(button.children[1]?.textContent).toContain('Continue with ');
    }
  });

  it('retains manual mail presets without changing them until Continue is clicked', () => {
    context.activeTab = 'mail';
    context.addAccountEmail = 'user@icloud.com';
    render();
    expect(context.setMailImapHost).not.toHaveBeenCalled();
    act(() => { providerButtons()[0]?.click(); });
    expect(context.setMailImapHost).toHaveBeenCalledWith('imap.mail.me.com');
    expect(context.setMailSmtpHost).toHaveBeenCalledWith('smtp.mail.me.com');
    expect(context.setMailImapUser).toHaveBeenCalledWith('user@icloud.com');
    expect(context.setMailSmtpUser).toHaveBeenCalledWith('user@icloud.com');
  });
});
