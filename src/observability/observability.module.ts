import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { OutboxEventEntity } from '../infrastructure/database/entities/outbox-event.entity';
import { MetricsController } from './metrics.controller';
import { MetricsService } from './metrics.service';
import { METRICS_SERVICE } from './metrics.token';

@Module({
  imports: [TypeOrmModule.forFeature([OutboxEventEntity])],
  controllers: [MetricsController],
  providers: [
    MetricsService,
    { provide: METRICS_SERVICE, useExisting: MetricsService },
  ],
  exports: [MetricsService, METRICS_SERVICE],
})
@Global()
export class ObservabilityModule {}
