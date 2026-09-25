export function validateConfiguration(config: Record<string, unknown>) {
  const enabled =
    config.RABBITMQ_ENABLED === true || config.RABBITMQ_ENABLED === 'true';
  const rabbitUrl =
    typeof config.RABBITMQ_URL === 'string' ? config.RABBITMQ_URL.trim() : '';
  if (enabled && !rabbitUrl.startsWith('amqp')) {
    throw new Error(
      'RABBITMQ_URL deve ser uma URL amqp válida quando RABBITMQ_ENABLED=true',
    );
  }
  return {
    ...config,
    RABBITMQ_ENABLED: enabled,
    ...(rabbitUrl ? { RABBITMQ_URL: rabbitUrl } : {}),
  };
}
