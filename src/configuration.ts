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
  return {
    ...config,
    RABBITMQ_ENABLED: enabled,
    ...(rabbitUrl ? { RABBITMQ_URL: rabbitUrl } : {}),
  };
}
