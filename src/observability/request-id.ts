import { randomUUID } from 'node:crypto';

const REQUEST_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function resolveRequestId(value: string | undefined): string {
  return value && REQUEST_ID_PATTERN.test(value) ? value : randomUUID();
}

export function isValidRequestId(value: unknown): value is string {
  return typeof value === 'string' && REQUEST_ID_PATTERN.test(value);
}
