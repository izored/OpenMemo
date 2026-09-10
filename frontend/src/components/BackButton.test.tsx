import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { BrowserRouter, useLocation, useNavigate, type NavigateFunction } from 'react-router-dom';
import { BackButton } from './BackButton';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// The real button inside a real BrowserRouter, driving the real jsdom history.
// Nothing here asserts on source text: if the fallback or the pop were removed,
// the recorded pathname below would be wrong and these fail.
let root: Root | null = null;

function mount(startPath: string) {
  // A fresh entry with no in-app push behind it, the way a deep link or a
  // reload arrives.
  window.history.replaceState({ idx: 0, key: 'start', usr: null }, '', startPath);

  const container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);

  let path = '';
  let nav: NavigateFunction | null = null;
  const Probe = () => {
    path = useLocation().pathname;
    nav = useNavigate();
    return null;
  };

  act(() => {
    root!.render(
      <BrowserRouter>
        <BackButton />
        <Probe />
      </BrowserRouter>,
    );
  });

  return {
    get path() { return path; },
    button: () => container.querySelector('button'),
    go: (to: string) => act(() => { nav!(to); }),
    click: () => act(() => {
      container.querySelector('button')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    }),
    // jsdom queues history.go() as a task and fires popstate later, so a click
    // that pops has to be awaited or the assertion reads the old path.
    clickBack: async () => {
      const popped = new Promise<void>((resolve) => {
        window.addEventListener('popstate', () => resolve(), { once: true });
      });
      await act(async () => {
        container.querySelector('button')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        await popped;
      });
    },
  };
}

describe('BackButton', () => {
  beforeEach(() => {
    window.history.replaceState({ idx: 0, key: 'start', usr: null }, '', '/');
  });
  afterEach(() => {
    act(() => { root?.unmount(); });
    root = null;
    document.body.innerHTML = '';
  });

  it('renders nothing on the dashboard with no history behind it', () => {
    const app = mount('/');
    expect(app.button()).toBe(null);
  });

  it('offers a way out of a deep-linked memo, and it is the library', () => {
    const app = mount('/memo/abc');
    expect(app.button()).not.toBe(null);
    app.click();
    expect(app.path).toBe('/');
  });

  it('offers a way out of a deep-linked playlist, and it is Music', () => {
    const app = mount('/music/pl-1');
    app.click();
    expect(app.path).toBe('/music');
  });

  it('returns to the page it was opened from, not to the fallback', async () => {
    const app = mount('/');
    app.go('/music');
    app.go('/memo/abc');
    expect(app.path).toBe('/memo/abc');
    await app.clickBack();
    // The fallback for a memo is '/', so landing on /music proves the pop ran.
    expect(app.path).toBe('/music');
  });

  it('honours an explicit destination over the history', () => {
    const app = mount('/');
    app.go('/music');
    app.go('/memo/abc');
    act(() => { root!.render(<BrowserRouter><BackButton to="/collections" /></BrowserRouter>); });
    act(() => {
      document.body.querySelector('button')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(window.location.pathname).toBe('/collections');
  });
});
