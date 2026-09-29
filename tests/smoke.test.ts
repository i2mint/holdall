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

describe.runIf(existsSync('dist/index.cjs'))('CommonJS build', () => {
  it('plans imports and shares error identity across entry points', () => {
    const script = [
      "const h = require('./dist/index.cjs'); const z = require('./dist/zodal.cjs');",
      'if (h.planImport({a:{x:1}},{a:{x:1}}).identical[0] !== "a") throw new Error("planImport");',
      "const p = z.createPersistence({provider:{getList:async()=>({data:[],total:0})}, app:'d', kind:'k', version:1});",
      "p.planImport({}).then(()=>{throw new Error('should reject')}, e => { if (!h.isHoldallError(e,'not-an-envelope')) throw e; });",
    ].join('\n');
    execFileSync('node', ['-e', script]);
  });
});
