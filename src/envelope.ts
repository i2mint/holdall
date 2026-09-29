/**
 * Envelopes: every value that leaves the app (a file, a share link, a backup)
 * says which app wrote it, what kind of thing it is, and which schema version.
 *
 * Reading runs a forward-only migration chain and refuses data newer than the
 * running code, so an old link keeps working and a new file never gets
 * silently truncated by an old app.
 */
import { HoldallError } from './errors';

/** Minimal Standard Schema v1 shape (https://standardschema.dev). Zod 4, Valibot and ArkType implement it. */
export interface StandardSchemaV1<Input = unknown, Output = Input> {
  readonly '~standard': {
    readonly version: 1;
    readonly vendor: string;
    readonly validate: (
      value: unknown,
    ) =>
      | StandardResult<Output>
      | Promise<StandardResult<Output>>;
    readonly types?: { readonly input: Input; readonly output: Output };
  };
}
type StandardResult<Output> =
  | { readonly value: Output; readonly issues?: undefined }
  | { readonly issues: ReadonlyArray<{ readonly message: string; readonly path?: ReadonlyArray<unknown> }> };

export interface Envelope<T = unknown> {
  app: string;
  kind: string;
  version: number;
  savedAt?: string;
  data: T;
}

/** `migrations[n]` turns version-n data into version-(n+1) data. */
export type Migrations = Record<number, (data: any) => unknown>;

export interface EnvelopeSpec<T = unknown> {
  app: string;
  kind: string;
  /** Current schema version written by this code. Integer, starts at 1. */
  version: number;
  /** Validates the (migrated) data. Any Standard Schema validator. */
  schema?: StandardSchemaV1<unknown, T>;
  migrations?: Migrations;
  /**
   * Accept bare data (no envelope) as this version. Use for files written
   * before the app adopted envelopes. Default: bare data is refused.
   */
  bareVersion?: number;
}

export function wrap<T>(
  data: T,
  spec: Pick<EnvelopeSpec, 'app' | 'kind' | 'version'>,
  { now = () => new Date() }: { now?: () => Date } = {},
): Envelope<T> {
  return { app: spec.app, kind: spec.kind, version: spec.version, savedAt: now().toISOString(), data };
}

export function isEnvelope(raw: unknown): raw is Envelope {
  if (!raw || typeof raw !== 'object') return false;
  const r = raw as Record<string, unknown>;
  return typeof r.app === 'string' && typeof r.kind === 'string' && Number.isInteger(r.version) && 'data' in r;
}

/** Run migrations from `from` up to `to`. Throws `missing-migration` on a gap. */
export function migrate(data: unknown, from: number, to: number, migrations: Migrations = {}): unknown {
  let out = data;
  for (let v = from; v < to; v++) {
    const step = migrations[v];
    if (!step) throw new HoldallError('missing-migration', `No migration from version ${v} to ${v + 1}.`, { from: v });
    out = step(out);
  }
  return out;
}

export function validate<T>(data: unknown, schema?: StandardSchemaV1<unknown, T>): T {
  if (!schema) return data as T;
  const result = schema['~standard'].validate(data);
  if (result instanceof Promise) {
    throw new HoldallError('async-schema', 'The schema validates asynchronously; holdall needs a synchronous schema.');
  }
  if (result.issues) {
    const summary = result.issues
      .slice(0, 5)
      .map((i) => (i.path?.length ? `${i.path.map(String).join('.')}: ` : '') + i.message)
      .join('; ');
    throw new HoldallError('invalid', `The data does not match the schema: ${summary}`, result.issues);
  }
  return result.value;
}

/** Check, migrate and validate. Returns the data at the current version. */
export function unwrap<T>(raw: unknown, spec: EnvelopeSpec<T>): T {
  let env: Envelope;
  if (isEnvelope(raw)) env = raw;
  else if (spec.bareVersion !== undefined) env = { app: spec.app, kind: spec.kind, version: spec.bareVersion, data: raw };
  else throw new HoldallError('not-an-envelope', 'This is not a holdall envelope ({app, kind, version, data}).');

  if (env.app !== spec.app) throw new HoldallError('wrong-app', `This was saved by "${env.app}", not "${spec.app}".`, env.app);
  if (env.kind !== spec.kind) throw new HoldallError('wrong-kind', `This holds "${env.kind}", not "${spec.kind}".`, env.kind);
  if (env.version > spec.version) {
    throw new HoldallError(
      'too-new',
      `This was saved by a newer version (schema ${env.version}; this app reads up to ${spec.version}). Reload to update the app.`,
      env.version,
    );
  }
  return validate(migrate(env.data, env.version, spec.version, spec.migrations), spec.schema);
}
