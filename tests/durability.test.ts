import { describe, expect, it, vi } from 'vitest';
import { captureInstallPrompt, detectInstallEnv, detectPlatform, ensurePersistence, installAdvice } from '../src';

const UA = {
  iphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
  ipadAsMac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15',
  macSafari: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15',
  macChrome: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
  android: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36',
  winFirefox: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:143.0) Gecko/20100101 Firefox/143.0',
  linuxFirefox: 'Mozilla/5.0 (X11; Linux x86_64; rv:143.0) Gecko/20100101 Firefox/143.0',
  instagram: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 300.0',
};
const env = (userAgent: string, extra: Partial<Parameters<typeof installAdvice>[0]> = {}) => ({
  userAgent,
  maxTouchPoints: 0,
  standalone: false,
  canPrompt: false,
  ...extra,
});

describe('platform and install advice', () => {
  it('detects platforms, including iPadOS posing as a Mac', () => {
    expect(detectPlatform(env(UA.iphone))).toBe('ios');
    expect(detectPlatform(env(UA.ipadAsMac, { maxTouchPoints: 5 }))).toBe('ios');
    expect(detectPlatform(env(UA.macSafari))).toBe('macos-safari');
    expect(detectPlatform(env(UA.macChrome))).toBe('chromium-desktop');
    expect(detectPlatform(env(UA.android))).toBe('android');
    expect(detectPlatform(env(UA.winFirefox))).toBe('firefox-windows');
    expect(detectPlatform(env(UA.instagram))).toBe('in-app');
  });

  it('advises per platform', () => {
    const kind = (e: ReturnType<typeof env>) => installAdvice(e).kind;
    expect(kind(env(UA.macChrome, { standalone: true }))).toBe('installed');
    expect(kind(env(UA.macChrome, { canPrompt: true }))).toBe('prompt');
    expect(kind(env(UA.macChrome))).toBe('menu');
    expect(kind(env(UA.iphone))).toBe('ios-share-sheet');
    expect(kind(env(UA.macSafari))).toBe('macos-add-to-dock');
    expect(kind(env(UA.winFirefox))).toBe('firefox-taskbar');
    expect(kind(env(UA.linuxFirefox))).toBe('unsupported');
    expect(kind(env(UA.instagram))).toBe('open-in-browser');
    const ios = installAdvice(env(UA.iphone), { appName: 'Demo' });
    expect(ios.steps).toHaveLength(3);
    expect(ios.copy.title).toContain('Demo');
    expect(ios.copy.warning).toMatch(/starts empty/);
    expect(ios.storageEffect).toBe('escapes-7-day-cap');
  });

  it('detects standalone from matchMedia or navigator.standalone', () => {
    const win = { navigator: { userAgent: UA.iphone, standalone: true }, matchMedia: () => ({ matches: false }) };
    expect(detectInstallEnv(win).standalone).toBe(true);
    const win2 = { navigator: { userAgent: UA.macChrome }, matchMedia: (q: string) => ({ matches: q.includes('standalone') }) };
    expect(detectInstallEnv(win2, { canPrompt: true })).toMatchObject({ standalone: true, canPrompt: true });
  });
});

describe('install prompt', () => {
  it('captures the event, prompts once, and clears on install', async () => {
    const target = new EventTarget();
    const ip = captureInstallPrompt(target);
    const seen: boolean[] = [];
    ip.subscribe((a) => seen.push(a));
    expect(await ip.prompt()).toBe('unavailable');
    const e = Object.assign(new Event('beforeinstallprompt', { cancelable: true }), {
      prompt: vi.fn(async () => {}),
      userChoice: Promise.resolve({ outcome: 'accepted' as const }),
    });
    target.dispatchEvent(e);
    expect(e.defaultPrevented).toBe(true);
    expect(ip.available()).toBe(true);
    expect(await ip.prompt()).toBe('accepted');
    expect(ip.available()).toBe(false);
    expect(seen).toEqual([true, false]);
    ip.dispose();
  });
});

describe('persistence', () => {
  it('asks only when requested, and never throws', async () => {
    const persist = vi.fn(async () => true);
    const storage = { persist, persisted: async () => false, estimate: async () => ({ usage: 10, quota: 100 }) };
    expect(await ensurePersistence({ storage })).toEqual({ supported: true, persisted: false, usage: 10, quota: 100 });
    expect(persist).not.toHaveBeenCalled();
    expect((await ensurePersistence({ storage, request: true })).persisted).toBe(true);
    const broken = { persisted: async () => { throw new Error('blocked'); } };
    expect(await ensurePersistence({ storage: broken })).toEqual({ supported: false, persisted: false });
    expect(await ensurePersistence({ storage: undefined })).toEqual({ supported: false, persisted: false });
  });
});
