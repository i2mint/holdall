/**
 * Typed errors. Every failure a caller may need to branch on carries a `code`,
 * so a UI (or an agent) can pick the right message without parsing text.
 */

export type HoldallErrorCode =
  | 'not-an-envelope'
  | 'wrong-app'
  | 'wrong-kind'
  | 'too-new'
  | 'missing-migration'
  | 'invalid'
  | 'async-schema'
  | 'unknown-codec'
  | 'async-codec'
  | 'bad-payload';

// A registry symbol, so `isHoldallError` works across bundles and entry points (CJS copies the class).
const BRAND = Symbol.for('holdall.error');

export class HoldallError extends Error {
  readonly code: HoldallErrorCode;
  readonly detail?: unknown;
  readonly [BRAND] = true;

  constructor(code: HoldallErrorCode, message: string, detail?: unknown) {
    super(message);
    this.name = 'HoldallError';
    this.code = code;
    this.detail = detail;
  }
}

export const isHoldallError = (e: unknown, code?: HoldallErrorCode): e is HoldallError =>
  typeof e === 'object' && e !== null && (e as Record<symbol, unknown>)[BRAND] === true && (code === undefined || (e as HoldallError).code === code);
