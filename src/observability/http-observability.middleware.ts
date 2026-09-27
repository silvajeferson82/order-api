import {
  context,
  propagation,
  SpanStatusCode,
  trace,
} from '@opentelemetry/api';
import type { NextFunction, Request, Response } from 'express';
import type { MetricsService } from './metrics.service';
import { requestContext } from './request-context';
import { resolveRequestId } from './request-id';

export function createHttpObservabilityMiddleware(metrics: MetricsService) {
  const tracer = trace.getTracer('order-api.http');
  return (request: Request, response: Response, next: NextFunction): void => {
    const requestId = resolveRequestId(request.header('x-request-id'));
    response.setHeader('x-request-id', requestId);
    const carrier = request.headers as Record<
      string,
      string | string[] | undefined
    >;
    const parent = propagation.extract(context.active(), carrier);
    context.with(parent, () => {
      tracer.startActiveSpan(
        `HTTP ${request.method}`,
        { attributes: { 'http.request.method': request.method } },
        (span) => {
          const startedAt = process.hrtime.bigint();
          span.setAttribute('request.id', requestId);
          requestContext.run({ requestId }, () => {
            response.on('finish', () => {
              const duration =
                Number(process.hrtime.bigint() - startedAt) / 1e9;
              const routePath = (
                request.route as unknown as { path?: string } | undefined
              )?.path;
              const route = routePath
                ? `${request.baseUrl}${routePath}`
                : 'unmatched';
              const labels = {
                method: request.method,
                route,
                status_code: String(response.statusCode),
              };
              metrics.httpRequests.inc(labels);
              metrics.httpDuration.observe(labels, duration);
              span.setAttribute('http.route', route);
              span.setAttribute(
                'http.response.status_code',
                response.statusCode,
              );
              if (response.statusCode >= 500)
                span.setStatus({ code: SpanStatusCode.ERROR });
              span.end();
            });
            next();
          });
        },
      );
    });
  };
}
