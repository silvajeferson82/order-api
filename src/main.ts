import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { startTelemetry, telemetry } from './observability/telemetry';
import { JsonLogger } from './observability/json-logger';
import { MetricsService } from './observability/metrics.service';
import { createHttpObservabilityMiddleware } from './observability/http-observability.middleware';

async function bootstrap() {
  startTelemetry();
  const logger = new JsonLogger();
  const app = await NestFactory.create(AppModule, { logger });
  app.useLogger(logger);
  app.use(createHttpObservabilityMiddleware(app.get(MetricsService)));
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );

  const config = new DocumentBuilder()
    .setTitle('Order API')
    .setDescription('API de pedidos com processamento assíncrono')
    .setVersion('1.0')
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description: 'Access token Keycloak assinado com RS256',
      },
      'bearer',
    )
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('docs', app, document);

  await app.listen(process.env.PORT ?? 3000);
  process.once('SIGTERM', () => void telemetry.shutdown());
  process.once('SIGINT', () => void telemetry.shutdown());
}
void bootstrap();
