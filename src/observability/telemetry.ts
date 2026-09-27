import { NodeSDK } from '@opentelemetry/sdk-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';

const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
export const telemetry = new NodeSDK({
  serviceName: process.env.OTEL_SERVICE_NAME ?? 'order-api',
  ...(endpoint
    ? {
        traceExporter: new OTLPTraceExporter({
          url: `${endpoint.replace(/\/$/, '')}/v1/traces`,
        }),
      }
    : {}),
});

export function startTelemetry(): void {
  telemetry.start();
}
