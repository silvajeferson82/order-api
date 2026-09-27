import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DataSourceOptions } from 'typeorm';
import { validateConfiguration } from './configuration';
import { OrderEntity } from './infrastructure/database/entities/order.entity';
import { OrderItemEntity } from './infrastructure/database/entities/order-item.entity';
import { ProductEntity } from './infrastructure/database/entities/product.entity';
import { OutboxEventEntity } from './infrastructure/database/entities/outbox-event.entity';
import { OrderProcessingRunEntity } from './infrastructure/database/entities/order-processing-run.entity';
import { OrdersModule } from './modules/orders.module';
import { ObservabilityModule } from './observability/observability.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate: validateConfiguration,
    }),
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService): DataSourceOptions => {
        const dbTypeRaw = configService.get<string>('DB_TYPE') ?? 'mysql';
        const dbType: 'better-sqlite3' | 'mysql' =
          dbTypeRaw === 'sqlite' || dbTypeRaw === 'better-sqlite3'
            ? 'better-sqlite3'
            : 'mysql';

        const commonOptions = {
          entities: [
            OrderEntity,
            OrderItemEntity,
            ProductEntity,
            OutboxEventEntity,
            OrderProcessingRunEntity,
          ],
          synchronize:
            dbType === 'better-sqlite3' &&
            configService.get<string>('NODE_ENV') !== 'production',
          autoLoadEntities: true,
          dropSchema:
            dbType === 'better-sqlite3' &&
            configService.get<string>('NODE_ENV') === 'test',
          logging: false,
        };

        if (dbType === 'better-sqlite3') {
          return {
            ...commonOptions,
            type: dbType,
            database: configService.get<string>('DB_NAME') ?? ':memory:',
          } satisfies DataSourceOptions;
        }

        return {
          ...commonOptions,
          type: dbType,
          host:
            dbType === 'mysql'
              ? (configService.get<string>('DB_HOST') ?? 'localhost')
              : undefined,
          port:
            dbType === 'mysql'
              ? Number(configService.get<number>('DB_PORT') ?? 3306)
              : undefined,
          username:
            dbType === 'mysql'
              ? (configService.get<string>('DB_USERNAME') ?? 'root')
              : undefined,
          password:
            dbType === 'mysql'
              ? (configService.get<string>('DB_PASSWORD') ?? 'root')
              : undefined,
          database: configService.get<string>('DB_NAME') ?? ':memory:',
        } satisfies DataSourceOptions;
      },
    }),
    OrdersModule,
    ObservabilityModule,
  ],
})
export class AppModule {}
