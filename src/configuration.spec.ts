import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { validateConfiguration } from './configuration';

describe('validateConfiguration', () => {
  it('normalizes configuration with RabbitMQ enabled', () => {
    expect(
      validateConfiguration({
        RABBITMQ_ENABLED: 'true',
        RABBITMQ_URL: ' amqps://rabbit.example.test:5671/vhost ',
      }),
    ).toEqual({
      RABBITMQ_ENABLED: true,
      RABBITMQ_URL: 'amqps://rabbit.example.test:5671/vhost',
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
    });
  });

  it.each([undefined, true, false, 'true', 'false'])(
    'accepts valid RABBITMQ_ENABLED value: %s',
    (value) => {
      expect(
        validateConfiguration({
          RABBITMQ_ENABLED: value,
          RABBITMQ_URL: 'amqp://localhost:5672',
        }).RABBITMQ_ENABLED,
      ).toBe(value === true || value === 'true');
    },
  );

  it('rejects a typo in RABBITMQ_ENABLED', () => {
    expect(() =>
      validateConfiguration({
        RABBITMQ_ENABLED: 'tru',
        RABBITMQ_URL: 'amqp://localhost:5672',
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
        }),
      ).toThrow('RABBITMQ_URL deve ser uma URL amqp válida');
    },
  );

  it('rejects a missing URL when RabbitMQ is enabled', () => {
    expect(() => validateConfiguration({ RABBITMQ_ENABLED: true })).toThrow(
      'RABBITMQ_URL deve ser uma URL amqp válida',
    );
  });
});
