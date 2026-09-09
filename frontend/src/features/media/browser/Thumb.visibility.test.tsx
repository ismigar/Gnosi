import {act, useRef} from 'react';
import {createRoot, type Root} from 'react-dom/client';
import {afterEach, beforeAll, beforeEach, expect, it, vi} from 'vitest';
import {Thumb} from './Thumb';
import {transportFetch} from '../../../shared/api/transports';

vi.mock('react-i18next', () => ({useTranslation: () => ({t: (key: string) => key})}));
vi.mock('../../../shared/api/transports', () => ({transportFetch: vi.fn()}));

const observers: ControlledObserver[] = [];
class ControlledObserver implements IntersectionObserver {
    readonly root: Element | Document | null;
    readonly rootMargin: string;
    readonly thresholds = [0];
    readonly observed = new Set<Element>();
    readonly disconnect = vi.fn(() => {this.observed.clear();});
    readonly observe = vi.fn((target: Element) => {this.observed.add(target);});
    readonly unobserve = vi.fn((target: Element) => {this.observed.delete(target);});
    readonly takeRecords = () => [];
    constructor(readonly callback: IntersectionObserverCallback, options?: IntersectionObserverInit) {
        this.root = options?.root ?? null;
        this.rootMargin = options?.rootMargin ?? '';
        observers.push(this);
    }
    show(targets: Element[], isIntersecting = true) {
        this.callback(targets.map(target => ({
            target, isIntersecting, time: 0, intersectionRatio: isIntersecting ? 1 : 0,
            rootBounds: null, boundingClientRect: new DOMRectReadOnly(), intersectionRect: new DOMRectReadOnly(),
        })), this);
    }
}

let container: HTMLDivElement;
let root: Root;
async function run(action: () => void | Promise<void>) {await act(async () => {await action();});}
beforeAll(() => {(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT: boolean}).IS_REACT_ACT_ENVIRONMENT = true;});
beforeEach(() => {
    observers.length = 0;
    vi.clearAllMocks();
    vi.stubGlobal('IntersectionObserver', ControlledObserver);
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
});
afterEach(async () => {
    await run(() => {root.unmount();});
    container.remove();
    vi.useRealTimers();
    vi.unstubAllGlobals();
});

function Gallery({prefix = 'fixture', count = 50}: {prefix?: string; count?: number}) {
    const scrollRoot = useRef<HTMLDivElement>(null);
    return <div ref={scrollRoot} data-scroll-root>
        {Array.from({length: count}, (_, index) => <Thumb key={index}
            src={`/api/vault/images/${prefix}-${String(index)}.png`} alt={`Image ${String(index)}`}
            viewMode="grid" kind="image" scrollRoot={scrollRoot}/>)}
    </div>;
}

it('shares one close viewport observer and loads real images as they enter the gallery viewport', async () => {
    await run(() => {root.render(<Gallery/>);});
    expect(observers).toHaveLength(1);
    const observer = observers[0];
    if (!observer) throw new Error('Expected the gallery observer');
    expect(observer.root).toBe(container.querySelector('[data-scroll-root]'));
    expect(observer.rootMargin).toBe('160px 0px');
    expect(observer.observed.size).toBe(50);
    expect(container.querySelectorAll('[data-scroll-root] > div')).toHaveLength(50);
    expect(container.querySelector('img')).toBeNull();
    const targets = [...observer.observed];
    await run(() => {observer.show(targets.slice(0, 19));});
    expect(container.querySelectorAll('img')).toHaveLength(19);
    expect([...container.querySelectorAll('img')].map(image => image.getAttribute('src')))
        .toEqual(Array.from({length: 19}, (_, index) => `/api/vault/images/fixture-${String(index)}.png`));
    expect(container.querySelector('img')?.getAttribute('decoding')).toBe('async');
    expect(observer.observed.size).toBe(31);
    expect(transportFetch).not.toHaveBeenCalled();
    await run(() => {observer.show(targets.slice(19, 24));});
    expect(container.querySelectorAll('img')).toHaveLength(24);
    expect(observer.observed.size).toBe(26);
    await run(() => {observer.show(targets.slice(0, 19), false);});
    expect(container.querySelectorAll('img')).toHaveLength(24);
});

it('replaces source registrations and disconnects unmounted galleries without loading distant files', async () => {
    await run(() => {root.render(<Gallery count={2}/>);});
    const previous = observers[0];
    if (!previous) throw new Error('Expected the first observer');
    const staleTargets = [...previous.observed];
    await run(() => {root.render(<Gallery prefix="new-vault" count={2}/>);});
    const current = observers.at(-1);
    if (!current) throw new Error('Expected the replacement observer');
    await run(() => {previous.show(staleTargets);});
    expect(container.querySelector('img')).toBeNull();
    await run(() => {current.show([...current.observed].slice(0, 1));});
    expect(container.querySelector('img')?.getAttribute('src')).toBe('/api/vault/images/new-vault-0.png');
    const unmountedTargets = [...current.observed];
    await run(() => {root.render(null);});
    expect(current.disconnect).toHaveBeenCalled();
    await run(() => {current.show(unmountedTargets);});
    expect(container.querySelector('img')).toBeNull();
    expect(transportFetch).not.toHaveBeenCalled();
});

it('keeps visible cloud recovery observable after scrolling instead of concealing pending images', async () => {
    vi.useFakeTimers();
    vi.mocked(transportFetch).mockResolvedValue(new Response(null, {status: 503, headers: {
        'Retry-After': '3', 'X-Gnosi-File-Availability': 'pending',
    }}));
    await run(() => {root.render(<Gallery count={1}/>);});
    const observer = observers[0];
    if (!observer) throw new Error('Expected the observer');
    const targets = [...observer.observed];
    await run(() => {observer.show(targets);});
    await run(() => {container.querySelector('img')?.dispatchEvent(new Event('error'));});
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
    await run(() => {observer.show(targets, false);});
    await run(async () => {await vi.advanceTimersByTimeAsync(3000);});
    expect(transportFetch).toHaveBeenCalledTimes(2);
    expect(container.textContent).toContain('media.loading');
    expect(container.textContent).not.toContain('media.not_downloaded');
});
