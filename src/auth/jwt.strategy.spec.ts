import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { JwtStrategy } from './jwt.strategy';

jest.mock('@nestjs/config', () => ({
  ConfigService: class ConfigService {},
}));

describe('JwtStrategy with authentication disabled', () => {
  const cases: Array<Record<string, unknown>> = [
    { AUTH_ENABLED: false },
    {
      AUTH_ENABLED: false,
      KEYCLOAK_ISSUER: '',
      KEYCLOAK_AUDIENCE: '',
      KEYCLOAK_JWKS_URI: '',
    },
  ];

  it.each(cases)(
    'bootstraps the strategy without Keycloak settings (%s)',
    async (configuration) => {
      const configService = {
        get: (key: string) => configuration[key],
        getOrThrow: (key: string) => configuration[key],
      } as unknown as ConfigService;

      const module = await Test.createTestingModule({
        providers: [
          JwtStrategy,
          { provide: ConfigService, useValue: configService },
        ],
      }).compile();

      await module.close();
    },
  );
});
