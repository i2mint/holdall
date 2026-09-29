#!/usr/bin/env node
/**
 * Terminal access to share links, for debugging and for agents:
 *
 *   holdall encode <file.json|->        print a payload (`z1.…` or `j1.…`)
 *   holdall encode <file|-> --url <u>   print a share link and its length tier
 *   holdall decode <link|payload|file|->  print the JSON a link carries
 */
import { readFileSync } from 'node:fs';
import { decodePayload, encodePayload, linkTier, makeShareLink } from './link';

const USAGE = 'usage: holdall encode <file|-> [--url <base>] [--key <k>] | holdall decode <link|payload|file|->';

function read(arg: string): string {
  if (arg === '-') return readFileSync(0, 'utf8');
  try {
    return readFileSync(arg, 'utf8');
  } catch {
    return arg;
  }
}

function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

function payloadIn(text: string, key: string): string {
  const t = text.trim();
  if (!/^[a-z]+:\/\//.test(t)) return t;
  const url = new URL(t);
  for (const part of [url.hash.replace(/^#/, ''), url.search.replace(/^\?/, '')]) {
    const v = new URLSearchParams(part).get(key);
    if (v) return v;
  }
  throw new Error(`No "${key}" parameter in that link.`);
}

export function main(argv: string[]): number {
  const [cmd, arg, ...rest] = argv;
  const key = flag(rest, '--key') ?? 's';
  if (cmd === 'encode' && arg) {
    const value = JSON.parse(read(arg));
    const base = flag(rest, '--url');
    if (base) {
      const link = makeShareLink(value, base, { key });
      process.stdout.write(`${link.url}\n`);
      process.stderr.write(`${link.length} chars, tier: ${link.tier}\n`);
    } else {
      const payload = encodePayload(value);
      process.stdout.write(`${payload}\n`);
      process.stderr.write(`${payload.length} chars, tier: ${linkTier(payload)}\n`);
    }
    return 0;
  }
  if (cmd === 'decode' && arg) {
    process.stdout.write(`${JSON.stringify(decodePayload(payloadIn(read(arg), key)), null, 2)}\n`);
    return 0;
  }
  process.stderr.write(`${USAGE}\n`);
  return 2;
}

try {
  process.exitCode = main(process.argv.slice(2));
} catch (e) {
  process.stderr.write(`holdall: ${e instanceof Error ? e.message : String(e)}\n`);
  process.exitCode = 1;
}
