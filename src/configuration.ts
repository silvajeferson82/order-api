export function validateConfiguration(config: Record<string, unknown>) {
  const rabbitEnabled = config.RABBITMQ_ENABLED;
  if (
    rabbitEnabled !== undefined &&
    rabbitEnabled !== true &&
    rabbitEnabled !== false &&
    rabbitEnabled !== 'true' &&
    rabbitEnabled !== 'false'
  ) {
    throw new Error('RABBITMQ_ENABLED deve ser true ou false quando definido');
  }

  const enabled = rabbitEnabled === true || rabbitEnabled === 'true';
  const rabbitUrl =
    typeof config.RABBITMQ_URL === 'string' ? config.RABBITMQ_URL.trim() : '';
  if (enabled) {
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(rabbitUrl);
    } catch {
      throw new Error(
        'RABBITMQ_URL deve ser uma URL amqp válida quando RABBITMQ_ENABLED=true',
      );
    }
    if (
      !['amqp:', 'amqps:'].includes(parsedUrl.protocol) ||
      !parsedUrl.hostname
    ) {
      throw new Error(
        'RABBITMQ_URL deve ser uma URL amqp válida quando RABBITMQ_ENABLED=true',
      );
    }
  }
  const nodeEnv = config.NODE_ENV ?? 'development';
  const authRaw = config.AUTH_ENABLED;
  if (
    authRaw !== undefined &&
    authRaw !== true &&
    authRaw !== false &&
    authRaw !== 'true' &&
    authRaw !== 'false'
  ) {
    throw new Error('AUTH_ENABLED deve ser true ou false quando definido');
  }

  const production = nodeEnv === 'production';
  const metricsToken =
    typeof config.METRICS_TOKEN === 'string' ? config.METRICS_TOKEN : '';
  const requireHttps = nodeEnv !== 'development' && nodeEnv !== 'test';
  const authEnabled =
    authRaw === undefined ? true : authRaw === true || authRaw === 'true';
  if (production && !authEnabled) {
    throw new Error('AUTH_ENABLED=false não é permitido em produção');
  }
  if (!authEnabled && nodeEnv !== 'development' && nodeEnv !== 'test') {
    throw new Error(
      'AUTH_ENABLED=false só é permitido em NODE_ENV=development ou test',
    );
  }

  const jwksCacheTtl = positiveInteger(
    config.JWKS_CACHE_TTL_MS,
    600_000,
    'JWKS_CACHE_TTL_MS',
    1_000,
    86_400_000,
  );
  const jwksTimeout = positiveInteger(
    config.JWKS_TIMEOUT_MS,
    3_000,
    'JWKS_TIMEOUT_MS',
    100,
    30_000,
  );
  const jwksRateLimit = positiveInteger(
    config.JWKS_RATE_LIMIT,
    10,
    'JWKS_RATE_LIMIT',
    1,
    100,
  );

  const result = {
    ...config,
    RABBITMQ_ENABLED: enabled,
    AUTH_ENABLED: authEnabled,
    ...(metricsToken ? { METRICS_TOKEN: metricsToken } : {}),
    JWKS_CACHE_TTL_MS: jwksCacheTtl,
    JWKS_TIMEOUT_MS: jwksTimeout,
    JWKS_RATE_LIMIT: jwksRateLimit,
    ...(rabbitUrl ? { RABBITMQ_URL: rabbitUrl } : {}),
  };

  if (!authEnabled) {
    if (production) {
      throw new Error('Autenticação JWT é obrigatória em produção');
    }
    return result;
  }

  if (production && metricsToken.length < 32) {
    throw new Error(
      'METRICS_TOKEN com pelo menos 32 caracteres é obrigatório em produção',
    );
  }

  const issuer = readRequiredString(config.KEYCLOAK_ISSUER, 'KEYCLOAK_ISSUER');
  const audience = readRequiredString(
    config.KEYCLOAK_AUDIENCE,
    'KEYCLOAK_AUDIENCE',
  );
  const jwksUri = readRequiredString(
    config.KEYCLOAK_JWKS_URI,
    'KEYCLOAK_JWKS_URI',
  );
  validateHttpUrl(issuer, 'KEYCLOAK_ISSUER', requireHttps);
  validateHttpUrl(jwksUri, 'KEYCLOAK_JWKS_URI', requireHttps);

  return {
    ...result,
    KEYCLOAK_ISSUER: issuer,
    KEYCLOAK_AUDIENCE: audience,
    KEYCLOAK_JWKS_URI: jwksUri,
  };
}

function readRequiredString(value: unknown, name: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${name} é obrigatório quando AUTH_ENABLED=true`);
  }
  return value.trim();
}

function validateHttpUrl(
  value: string,
  name: string,
  requireHttps: boolean,
): void {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${name} deve ser uma URL HTTP(S) válida`);
  }
  if (
    !['https:', 'http:'].includes(url.protocol) ||
    !url.hostname ||
    (requireHttps && url.protocol !== 'https:')
  ) {
    throw new Error(
      `${name} deve usar HTTPS fora de development/test e uma URL HTTP(S) válida`,
    );
  }
}

function positiveInteger(
  value: unknown,
  defaultValue: number,
  name: string,
  minimum: number,
  maximum: number,
): number {
  if (value === undefined || value === '') return defaultValue;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(
      `${name} deve ser um inteiro entre ${minimum} e ${maximum}`,
    );
  }
  return parsed;
}
