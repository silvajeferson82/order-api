import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, SecretOrKeyProvider, Strategy } from 'passport-jwt';
import jwksRsa from 'jwks-rsa';

export interface KeycloakJwtClaims {
  sub: string;
  exp: number;
  iss: string;
  aud: string | string[];
  nbf?: number;
  resource_access?: Record<string, { roles?: unknown } | undefined>;
  [claim: string]: unknown;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'keycloak-jwt') {
  constructor(config: ConfigService) {
    const strategyOptions = {
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      algorithms: ['RS256' as const],
      jsonWebTokenOptions: { ignoreExpiration: false },
    };

    if (config.get<boolean>('AUTH_ENABLED') !== true) {
      const rejectToken: SecretOrKeyProvider = (_request, _token, done) =>
        done(new UnauthorizedException('Autenticação JWT está desabilitada'));
      super({ ...strategyOptions, secretOrKeyProvider: rejectToken });
      return;
    }

    const jwksUri = config.getOrThrow<string>('KEYCLOAK_JWKS_URI');
    const secretOrKeyProvider = jwksRsa.passportJwtSecret({
      jwksUri,
      cache: true,
      cacheMaxAge: config.getOrThrow<number>('JWKS_CACHE_TTL_MS'),
      rateLimit: true,
      jwksRequestsPerMinute: config.getOrThrow<number>('JWKS_RATE_LIMIT'),
      timeout: config.getOrThrow<number>('JWKS_TIMEOUT_MS'),
    });

    super({
      ...strategyOptions,
      secretOrKeyProvider,
      issuer: config.getOrThrow<string>('KEYCLOAK_ISSUER'),
      audience: config.getOrThrow<string>('KEYCLOAK_AUDIENCE'),
    });
  }

  validate(payload: KeycloakJwtClaims): KeycloakJwtClaims {
    if (
      typeof payload.sub !== 'string' ||
      !payload.sub ||
      typeof payload.exp !== 'number' ||
      !Number.isFinite(payload.exp)
    ) {
      throw new UnauthorizedException('Claims JWT obrigatórias ausentes');
    }
    return payload;
  }
}
