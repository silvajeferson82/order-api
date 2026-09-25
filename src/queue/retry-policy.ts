import { NotFoundException } from '@nestjs/common';
import { InsufficientStockError } from '../domain/products/insufficient-stock.error';

export const RETRY_DELAYS_MS = [1000, 5000, 15000] as const;

export type FailureClassification = 'PERMANENT' | 'TRANSIENT';

export function classifyProcessingFailure(
  error: unknown,
): FailureClassification {
  if (
    error instanceof InsufficientStockError ||
    error instanceof NotFoundException ||
    error instanceof InvalidOrderEventError
  ) {
    return 'PERMANENT';
  }
  return 'TRANSIENT';
}

export function retryQueueFor(retryCount: number): string | null {
  if (!Number.isInteger(retryCount) || retryCount < 0) return null;
  return retryCount < RETRY_DELAYS_MS.length
    ? `order.created.retry.${retryCount + 1}`
    : null;
}

export class InvalidOrderEventError extends Error {
  constructor() {
    super('Evento order.created inválido');
    this.name = 'InvalidOrderEventError';
  }
}
