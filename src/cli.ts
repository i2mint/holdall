#!/usr/bin/env node
/**
 * Terminal access to share links, for debugging and for agents:
 *
 *   holdall encode <file.json|->        print a payload (`z1.…` or `j1.…`)
 *   holdall encode <file|-> --url <u>   print a share link and its length tier
 *   holdall decode <link|payload|file|->  print the JSON a link carries
 */
import { existsSync, readFileSync } from 'node:fs';
import { decodePayload, encodePayload, getUrlParam, linkTier, makeShareLink } from './link';

const USAGE = 'usage: holdall encode <file|-> [--url <base>] [--key <k>] | holdall decode <link|payload|file|->';

/** `-` is stdin; an existing path is read; anything else is taken literally (a link or a payload). */
function read(arg: string, { mustBeFile = false } = {}): string {
  if (arg === '-') return readFileSync(0, 'utf8');
  if (existsSync(arg)) return readFileSync(arg, 'utf8');
  if (mustBeFile) throw new Error(`No such file: ${arg}`);
  return arg;
}

function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

function payloadIn(text: string, key: string): string {
  const t = text.trim();
  if (!/^[a-z]+:\/\//.test(t)) return t;
  const v = getUrlParam(t, key, { part: 'hash' }) ?? getUrlParam(t, key, { part: 'search' });
  if (v) return v;
  throw new Error(`No "${key}" parameter in that link.`);
}

export function main(argv: string[]): number {
  const [cmd, arg, ...rest] = argv;
  const key = flag(rest, '--key') ?? 's';
  if (cmd === 'encode' && arg) {
    const value = JSON.parse(read(arg, { mustBeFile: true }));
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
