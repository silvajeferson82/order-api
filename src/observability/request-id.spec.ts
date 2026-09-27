import { resolveRequestId } from './request-id';

describe('resolveRequestId', () => {
  it('preserva um X-Request-Id válido', () => {
    expect(resolveRequestId('123e4567-e89b-12d3-a456-426614174000')).toBe(
      '123e4567-e89b-12d3-a456-426614174000',
    );
  });

  it.each([
    '',
    'bad value',
    'x'.repeat(129),
    'id\nforged',
    'eyJhbGciOiJIUzI1NiJ9.payload.signature',
  ])('gera UUID quando o valor recebido não é válido', (value) => {
    const requestId = resolveRequestId(value);
    expect(requestId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
  });
});
