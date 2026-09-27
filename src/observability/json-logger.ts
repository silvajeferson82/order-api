import type { LoggerService } from '@nestjs/common';
import { requestContext } from './request-context';

type Level = 'log' | 'info' | 'error' | 'warn' | 'debug' | 'verbose' | 'fatal';

export class JsonLogger implements LoggerService {
  log(message: unknown, context?: string): void {
    this.write('info', message, context);
  }
  error(message: unknown, trace?: string, context?: string): void {
    this.write('error', message, context, trace);
  }
  warn(message: unknown, context?: string): void {
    this.write('warn', message, context);
  }
  debug(message: unknown, context?: string): void {
    this.write('debug', message, context);
  }
  verbose(message: unknown, context?: string): void {
    this.write('debug', message, context);
  }
  fatal(message: unknown, context?: string): void {
    this.write('fatal', message, context);
  }

  private write(
    level: Level,
    message: unknown,
    context?: string,
    stack?: string,
  ): void {
    const fields = requestContext.current();
    const record = {
      timestamp: new Date().toISOString(),
      level: level === 'log' ? 'info' : level,
      message: typeof message === 'string' ? message : 'Application log event',
      ...(context ? { context } : {}),
      ...(level === 'error' && stack ? { stack } : {}),
      ...(fields ?? {}),
    };
    const line = JSON.stringify(record);
    if (level === 'error' || level === 'fatal')
      process.stderr.write(`${line}\n`);
    else process.stdout.write(`${line}\n`);
  }
}

export function logEvent(
  level: 'info' | 'warn' | 'error',
  event: string,
  fields: Record<string, string | number | boolean | null | undefined> = {},
): void {
  const record = {
    timestamp: new Date().toISOString(),
    level,
    message: event,
    ...(requestContext.current() ?? {}),
    ...fields,
  };
  const line = JSON.stringify(record);
  if (level === 'error') process.stderr.write(`${line}\n`);
  else process.stdout.write(`${line}\n`);
}
