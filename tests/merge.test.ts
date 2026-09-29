import { describe, expect, it } from 'vitest';
import { canonicalEquals, planImport, resolveImport } from '../src';

const held = { a: { v: 1, w: 2 }, b: { v: 2 }, 'imported-b': { v: 99 } };
const incoming = new Map<string, object>([
  ['a', { w: 2, v: 1 }], // same content, other key order
  ['b', { v: 3 }], // conflict
  ['c', { v: 4 }], // new
]);

describe('import planning', () => {
  it('compares canonically', () => {
    expect(canonicalEquals({ a: 1, b: [1, 2] }, { b: [1, 2], a: 1 })).toBe(true);
    expect(canonicalEquals({ a: 1 }, { a: 2 })).toBe(false);
  });

  it('splits incoming into added, identical and conflicts', () => {
    const plan = planImport(held, incoming);
    expect(plan.added).toEqual([['c', { v: 4 }]]);
    expect(plan.identical).toEqual(['a']);
    expect(plan.conflicts).toEqual([{ key: 'b', existing: { v: 2 }, incoming: { v: 3 } }]);
  });

  it('renames conflicts with a prefix by default, avoiding taken keys', () => {
    const res = resolveImport(planImport(held, incoming));
    expect(res.writes).toEqual([
      { key: 'c', value: { v: 4 }, action: 'add' },
      { key: 'imported-2-b', value: { v: 3 }, action: 'rename', from: 'b' },
    ]);
    expect(res.identical).toEqual(['a']);
  });

  it('honours a policy, per-key decisions and rekey', () => {
    const plan = planImport({ x: { id: 'x', n: 1 }, y: { id: 'y', n: 1 } }, { x: { id: 'x', n: 2 }, y: { id: 'y', n: 2 } });
    const res = resolveImport(plan, {
      policy: 'skip',
      decisions: { y: 'rename' },
      prefix: 'copy-',
      rekey: (v, id) => ({ ...v, id }),
    });
    expect(res.skipped).toEqual(['x']);
    expect(res.writes).toEqual([{ key: 'copy-y', value: { id: 'copy-y', n: 2 }, action: 'rename', from: 'y' }]);
    expect(resolveImport(plan, { policy: 'overwrite' }).writes.map((w) => w.action)).toEqual(['overwrite', 'overwrite']);
  });
});
