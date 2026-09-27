import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { validateConfiguration } from './configuration';

describe('validateConfiguration', () => {
  it('normalizes configuration with RabbitMQ enabled', () => {
    expect(
      validateConfiguration({
        RABBITMQ_ENABLED: 'true',
        RABBITMQ_URL: ' amqps://rabbit.example.test:5671/vhost ',
        AUTH_ENABLED: 'false',
      }),
    ).toEqual({
      RABBITMQ_ENABLED: true,
      RABBITMQ_URL: 'amqps://rabbit.example.test:5671/vhost',
      AUTH_ENABLED: false,
      JWKS_CACHE_TTL_MS: 600_000,
      JWKS_TIMEOUT_MS: 3_000,
      JWKS_RATE_LIMIT: 10,
    });
  });

  it('accepts values documented in .env.example', () => {
    const sample = readFileSync(join(process.cwd(), '.env.example'), 'utf8');
    const config = Object.fromEntries(
      sample
        .split(/\r?\n/)
        .filter((line) => line.trim() && !line.trim().startsWith('#'))
        .map((line) => {
          const separator = line.indexOf('=');
          return [line.slice(0, separator), line.slice(separator + 1)];
        }),
    );

    expect(validateConfiguration(config)).toMatchObject({
      RABBITMQ_ENABLED: false,
      RABBITMQ_URL: 'amqp://localhost:5672',
      AUTH_ENABLED: false,
    });
  });

  it.each([undefined, true, false, 'true', 'false'])(
    'accepts valid RABBITMQ_ENABLED value: %s',
    (value) => {
      expect(
        validateConfiguration({
          RABBITMQ_ENABLED: value,
          RABBITMQ_URL: 'amqp://localhost:5672',
          AUTH_ENABLED: false,
        }).RABBITMQ_ENABLED,
      ).toBe(value === true || value === 'true');
    },
  );

  it('rejects a typo in RABBITMQ_ENABLED', () => {
    expect(() =>
      validateConfiguration({
        RABBITMQ_ENABLED: 'tru',
        RABBITMQ_URL: 'amqp://localhost:5672',
        AUTH_ENABLED: false,
      }),
    ).toThrow('RABBITMQ_ENABLED deve ser true ou false quando definido');
  });

  it.each(['https://rabbit.example.test', 'amqp://', 'not-a-url'])(
    'rejects invalid URL when RabbitMQ is enabled: %s',
    (url) => {
      expect(() =>
        validateConfiguration({
          RABBITMQ_ENABLED: 'true',
          RABBITMQ_URL: url,
          AUTH_ENABLED: false,
        }),
      ).toThrow('RABBITMQ_URL deve ser uma URL amqp válida');
    },
  );

  it('rejects a missing URL when RabbitMQ is enabled', () => {
    expect(() =>
      validateConfiguration({
        RABBITMQ_ENABLED: true,
        AUTH_ENABLED: false,
      }),
    ).toThrow('RABBITMQ_URL deve ser uma URL amqp válida');
  });

  it('exige configuração Keycloak quando autenticação está ativa', () => {
    expect(() => validateConfiguration({ AUTH_ENABLED: true })).toThrow(
      'KEYCLOAK_ISSUER é obrigatório',
    );
  });

  it('não permite iniciar produção sem autenticação', () => {
    expect(() =>
      validateConfiguration({
        NODE_ENV: 'production',
        AUTH_ENABLED: false,
      }),
    ).toThrow('AUTH_ENABLED=false não é permitido em produção');
  });

  it('não permite desabilitar autenticação em ambiente não local', () => {
    expect(() =>
      validateConfiguration({
        NODE_ENV: 'staging',
        AUTH_ENABLED: false,
      }),
    ).toThrow(
      'AUTH_ENABLED=false só é permitido em NODE_ENV=development ou test',
    );
  });

  it('valida HTTPS de issuer/JWKS e normaliza limites JWKS', () => {
    expect(
      validateConfiguration({
        NODE_ENV: 'production',
        AUTH_ENABLED: true,
        KEYCLOAK_ISSUER: 'https://id.example.test/realms/orders',
        KEYCLOAK_AUDIENCE: 'order-api',
        KEYCLOAK_JWKS_URI:
          'https://id.example.test/realms/orders/protocol/openid-connect/certs',
        JWKS_TIMEOUT_MS: '5000',
      }),
    ).toMatchObject({
      AUTH_ENABLED: true,
      JWKS_TIMEOUT_MS: 5000,
      KEYCLOAK_AUDIENCE: 'order-api',
    });
  });

  it('não aceita configuração inválida de cache JWKS', () => {
    expect(() =>
      validateConfiguration({
        AUTH_ENABLED: false,
        JWKS_CACHE_TTL_MS: 0,
      }),
    ).toThrow('JWKS_CACHE_TTL_MS deve ser um inteiro');
  });
});
