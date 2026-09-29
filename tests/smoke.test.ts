import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// The one-command test: encode a real file to a link and decode it back, through the built CLI.
describe.runIf(existsSync('dist/cli.js'))('cli smoke', () => {
  it('round-trips examples/design.json through a share link', () => {
    const link = execFileSync('node', ['dist/cli.js', 'encode', 'examples/design.json', '--url', 'https://x.test/app/'], { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim();
    const decoded = execFileSync('node', ['dist/cli.js', 'decode', link]).toString();
    expect(JSON.parse(decoded)).toEqual(JSON.parse(readFileSync('examples/design.json', 'utf8')));
  });
});
