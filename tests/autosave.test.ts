import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAutosave } from '../src';

afterEach(() => vi.useRealTimers());

describe('autosave', () => {
  it('debounces, and flushes on pagehide', async () => {
    vi.useFakeTimers();
    const saved: number[] = [];
    const win = new EventTarget();
    const a = createAutosave<number>({ save: (v) => void saved.push(v), delay: 100, win, doc: new EventTarget() });
    a.schedule(1);
    a.schedule(2);
    vi.advanceTimersByTime(99);
    expect(saved).toEqual([]);
    vi.advanceTimersByTime(1);
    await a.flush(); // let the debounced save settle
    expect(saved).toEqual([2]);
    a.schedule(3);
    win.dispatchEvent(new Event('pagehide'));
    expect(saved).toEqual([2, 3]); // written synchronously inside the pagehide handler
    a.dispose();
  });

  it('flushes when the document becomes hidden', async () => {
    const saved: string[] = [];
    const doc = Object.assign(new EventTarget(), { visibilityState: 'visible' });
    const a = createAutosave<string>({ save: (v) => void saved.push(v), delay: 10_000, win: new EventTarget(), doc });
    a.schedule('x');
    doc.visibilityState = 'hidden';
    doc.dispatchEvent(new Event('visibilitychange'));
    await Promise.resolve();
    expect(saved).toEqual(['x']);
    a.dispose();
  });

  it('keeps a failed value pending for the next flush', async () => {
    let fail = true;
    const saved: number[] = [];
    const onError = vi.fn();
    const a = createAutosave<number>({
      save: (v) => {
        if (fail) throw new Error('quota');
        saved.push(v);
      },
      onError,
      win: new EventTarget(),
      doc: new EventTarget(),
    });
    a.schedule(7);
    await a.flush();
    expect(onError).toHaveBeenCalledOnce();
    expect(a.pending()).toBe(true);
    fail = false;
    await a.flush();
    expect(saved).toEqual([7]);
    expect(a.pending()).toBe(false);
    a.dispose();
  });
});

describe('autosave ordering', () => {
  it('never lets an older, slower save land after a newer one', async () => {
    const stored: string[] = [];
    const delays: Record<string, number> = { A: 30, B: 1 };
    const a = createAutosave<string>({
      save: (v) => new Promise((r) => setTimeout(() => (stored.push(v), r()), delays[v])),
      win: new EventTarget(),
      doc: new EventTarget(),
    });
    a.schedule('A');
    const first = a.flush();
    a.schedule('B');
    await Promise.all([first, a.flush()]);
    expect(stored).toEqual(['A', 'B']);
    a.dispose();
  });

  it('does not re-pend a failed value once a newer one was saved', async () => {
    const stored: string[] = [];
    const a = createAutosave<string>({
      save: async (v) => {
        if (v === 'A') throw new Error('quota');
        stored.push(v);
      },
      win: new EventTarget(),
      doc: new EventTarget(),
    });
    a.schedule('A');
    const first = a.flush();
    a.schedule('B');
    await Promise.all([first, a.flush()]);
    await a.flush();
    expect(stored).toEqual(['B']);
    a.dispose();
  });
});
