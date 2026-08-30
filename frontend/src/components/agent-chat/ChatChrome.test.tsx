import { act, type ComponentProps, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { createInstance } from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChatDock } from './ChatDock';
import { ChatHeader } from './ChatHeader';
import { ChatIcon } from './ChatIcon';
import { ChatSessionList } from './ChatSessionList';
import { createChatSession } from './sessionModel';

const effects = vi.hoisted(() => ({ announce: vi.fn<(panel: string) => void>(), emit: vi.fn<(event: string, payload: string) => void>() }));
vi.mock('../../hooks/useExclusiveFloatingPanel', () => ({ announceFloatingPanelOpen: effects.announce }));
vi.mock('../../shared/platform/app-events', () => ({ emitAppEvent: effects.emit }));
vi.mock('lucide-react/dynamic', () => ({
  iconNames: ['brain', 'chevron-down'],
  DynamicIcon: ({ name, size, color }: { name: string; size: number; color: string }) => <svg data-icon={name} width={size} color={color} />,
}));

const locale = createInstance();
let container: HTMLDivElement;
let root: Root;
beforeAll(async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  await locale.init({ lng: 'en', fallbackLng: 'en', resources: {}, interpolation: { escapeValue: false } });
});
beforeEach(() => { vi.resetAllMocks(); container = document.createElement('div'); document.body.append(container); root = createRoot(container); });
afterEach(async () => { await act(async () => { root.unmount(); await Promise.resolve(); }); container.remove(); });
async function render(node: ReactNode): Promise<void> {
  await act(async () => { root.render(<I18nextProvider i18n={locale}>{node}</I18nextProvider>); await Promise.resolve(); });
}
async function click(selector: string): Promise<void> {
  const target = container.querySelector<HTMLElement>(selector);
  if (!target) throw new Error(`Missing element ${selector}`);
  await act(async () => { target.click(); await Promise.resolve(); });
}
function header(overrides: Partial<ComponentProps<typeof ChatHeader>> = {}) {
  return {
    embedded: false, isMinimized: false, isLoading: false, runtimeLimited: false, agentHasModel: true,
    agentIcon: 'G', agentName: 'Fixture Copilot', selectedAgentId: 'one', runtimeStatusLabel: 'Connected',
    agentModel: 'fixture-model', runtimeStatusHelp: '', agentList: [{ id: 'one', name: 'One' }, { id: 'two' }],
    archiveCurrentSession: vi.fn<() => void>(), setIsMinimized: vi.fn<(value: boolean) => void>(),
    setSelectedAgentId: vi.fn<(value: string) => void>(), setShowSessionsView: vi.fn<(value: boolean) => void>(),
    setIsOpen: vi.fn<(value: boolean) => void>(), ...overrides,
  } satisfies ComponentProps<typeof ChatHeader>;
}

describe('chat icon and floating dock', () => {
  it('keeps arbitrary text icons, PascalCase names and Brain default color', async () => {
    await render(<ChatIcon icon="🧠" size={18} />);
    expect(container.textContent).toBe('🧠'); expect(container.querySelector('span')?.style.fontSize).toBe('18px');
    await render(<ChatIcon icon="lucide:Brain" />);
    expect(container.querySelector('svg')?.getAttribute('data-icon')).toBe('brain');
    expect(container.querySelector('svg')?.getAttribute('color')).toBe('white');
    await render(<ChatIcon icon="lucide:ChevronDown:gray" />);
    expect(container.querySelector('svg')?.getAttribute('data-icon')).toBe('chevron-down');
    expect(container.querySelector('svg')?.getAttribute('color')).toBe('gray');
    await render(<ChatIcon icon="lucide:not-an-icon" />);
    expect(container.querySelector('svg')).not.toBeNull(); expect(container.querySelector('[data-icon]')).toBeNull();
  });
  it('announces before closing the dock and opening chat, without duplicate effects', async () => {
    const order: string[] = [];
    effects.announce.mockImplementation(() => { order.push('announce'); });
    const dock = vi.fn<(value: boolean) => void>((value) => { order.push(`dock:${String(value)}`); });
    const open = vi.fn<(value: boolean) => void>((value) => { order.push(`chat:${String(value)}`); });
    await render(<ChatDock isDockOpen agentIcon="G" setIsDockOpen={dock} setIsOpen={open} />);
    expect(container.querySelector('[aria-expanded]')?.getAttribute('aria-expanded')).toBe('true');
    await click('button[aria-label="Open chat"]');
    expect(order).toEqual(['announce', 'dock:false', 'chat:true']); expect(effects.announce).toHaveBeenCalledExactlyOnceWith('chat');
  });
  it('toggles only the dock when its toggle is clicked', async () => {
    const dock = vi.fn<(value: boolean) => void>(); const open = vi.fn<(value: boolean) => void>();
    await render(<ChatDock isDockOpen={false} agentIcon="G" setIsDockOpen={dock} setIsOpen={open} />);
    await click('button[aria-expanded]'); expect(dock).toHaveBeenCalledExactlyOnceWith(true);
    expect(open).not.toHaveBeenCalled(); expect(effects.announce).not.toHaveBeenCalled();
  });
});

describe('chat header', () => {
  it('preserves agent selection and disables it while a response is loading', async () => {
    const props = header(); await render(<ChatHeader {...props} />);
    const select = container.querySelector('select'); if (!select) throw new Error('Missing selector');
    await act(async () => { select.value = 'two'; select.dispatchEvent(new Event('change', { bubbles: true })); await Promise.resolve(); });
    expect(props.setSelectedAgentId).toHaveBeenCalledExactlyOnceWith('two');
    await render(<ChatHeader {...props} isLoading />); expect(container.querySelector('select')?.disabled).toBe(true);
  });
  it('keeps archive, session-view close and chat close ordered, with no header bubbling', async () => {
    const order: string[] = [];
    const props = header({ isMinimized: true, archiveCurrentSession: () => { order.push('archive'); }, setShowSessionsView: (value) => { order.push(`sessions:${String(value)}`); }, setIsOpen: (value) => { order.push(`chat:${String(value)}`); } });
    await render(<ChatHeader {...props} />); await click('button[aria-label="Close chat"]');
    expect(order).toEqual(['archive', 'sessions:false', 'chat:false']); expect(props.setIsMinimized).not.toHaveBeenCalled();
    await click('button[aria-label="Expand chat"]'); expect(props.setIsMinimized).toHaveBeenCalledExactlyOnceWith(false);
  });
  it('expands a minimized header and hides controls for embedded notebooks', async () => {
    const props = header({ isMinimized: true }); await render(<ChatHeader {...props} />); await click('div');
    expect(props.setIsMinimized).toHaveBeenCalledExactlyOnceWith(false);
    await render(<ChatHeader {...props} embedded isMinimized={false} />);
    expect(container.textContent).toContain('Fixture Copilot'); expect(container.querySelector('select')).toBeNull(); expect(container.querySelector('button')).toBeNull();
  });
  it('shows runtime limitations and dispatches the typed settings event', async () => {
    const props = header({ runtimeLimited: true, runtimeStatusHelp: 'Choose a tool-capable model' }); await render(<ChatHeader {...props} />);
    expect(container.querySelector('[role="status"]')?.textContent).toContain('Choose a tool-capable model');
    await click('[role="status"] button'); expect(effects.emit).toHaveBeenCalledExactlyOnceWith('open-settings', 'ai');
    await render(<ChatHeader {...props} isMinimized />); expect(container.querySelector('[role="status"]')).toBeNull();
  });
});

describe('session list presentation', () => {
  it('renders archived sessions and routes open, delete and back once', async () => {
    const session = { ...createChatSession('Research', 'one', { randomId: () => 'session' }), archived: true, messages: [{ role: 'user', content: 'Hello' }] };
    const select = vi.fn<(id: string) => void>(); const remove = vi.fn<(id: string) => void>(); const back = vi.fn<(value: boolean) => void>();
    await render(<ChatSessionList sortedSessions={[session]} selectSession={select} deleteSessionById={remove} setShowSessionsView={back} />);
    expect(container.textContent).toContain('1 message · archived');
    const open = [...container.querySelectorAll('button')].find((button) => button.textContent === 'Open');
    if (!open) throw new Error('Missing Open'); await act(async () => { open.click(); await Promise.resolve(); });
    await click('button[aria-label="Delete session Research"]'); await click('button');
    expect(select).toHaveBeenCalledExactlyOnceWith('session'); expect(remove).toHaveBeenCalledExactlyOnceWith('session'); expect(back).toHaveBeenCalledExactlyOnceWith(false);
  });
  it('keeps the empty-list message without inventing a session', async () => {
    await render(<ChatSessionList sortedSessions={[]} selectSession={() => {}} deleteSessionById={() => {}} setShowSessionsView={() => {}} />);
    expect(container.textContent).toContain('There are no sessions.'); expect(container.querySelectorAll('button')).toHaveLength(1);
  });
});
