import { NotFoundException } from '@nestjs/common';
import { InsufficientStockError } from '../domain/products/insufficient-stock.error';
import {
  classifyProcessingFailure,
  InvalidOrderEventError,
  RETRY_DELAYS_MS,
  retryQueueFor,
} from './retry-policy';

describe('política de retry do consumer', () => {
  it('classifica estoque insuficiente e evento inválido como permanentes', () => {
    expect(
      classifyProcessingFailure(new InsufficientStockError('Keyboard')),
    ).toBe('PERMANENT');
    expect(classifyProcessingFailure(new NotFoundException())).toBe(
      'PERMANENT',
    );
    expect(classifyProcessingFailure(new InvalidOrderEventError())).toBe(
      'PERMANENT',
    );
  });

  it('classifica falhas não reconhecidas como transitórias', () => {
    expect(
      classifyProcessingFailure(new Error('conexão MySQL interrompida')),
    ).toBe('TRANSIENT');
  });

  it('usa filas de retry com TTL crescente e encerra após três tentativas', () => {
    expect(RETRY_DELAYS_MS).toEqual([1000, 5000, 15000]);
    expect(retryQueueFor(0)).toBe('order.created.retry.1');
    expect(retryQueueFor(1)).toBe('order.created.retry.2');
    expect(retryQueueFor(2)).toBe('order.created.retry.3');
    expect(retryQueueFor(3)).toBeNull();
  });
});
