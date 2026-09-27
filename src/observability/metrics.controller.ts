import {
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Req,
  Res,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';
import { timingSafeEqual } from 'node:crypto';
import { MetricsService } from './metrics.service';

@Controller()
export class MetricsController {
  constructor(
    private readonly metrics: MetricsService,
    private readonly config: ConfigService,
  ) {}

  @Get('metrics')
  async metricsEndpoint(
    @Req() request: Request,
    @Res() response: Response,
  ): Promise<void> {
    const expected = this.config.get<string>('METRICS_TOKEN');
    if (
      expected &&
      !safeEqual(request.header('x-metrics-token') ?? '', expected)
    ) {
      throw new HttpException('Forbidden', HttpStatus.FORBIDDEN);
    }
    response
      .status(200)
      .type(this.metrics.registry.contentType)
      .send(await this.metrics.registry.metrics());
  }
}

function safeEqual(actual: string, expected: string): boolean {
  const left = Buffer.from(actual);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}
