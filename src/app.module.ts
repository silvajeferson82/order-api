import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DataSourceOptions } from 'typeorm';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { Order } from './orders/order.entity';
import { OrderItem } from './orders/order-item.entity';
import { OrdersModule } from './orders/orders.module';
import { Product } from './products/product.entity';
import { OrderQueueModule } from './queue/order-queue.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
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
          entities: [Order, OrderItem, Product],
          synchronize: configService.get<string>('NODE_ENV') !== 'production',
          autoLoadEntities: true,
          dropSchema: configService.get<string>('NODE_ENV') === 'test',
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
    OrderQueueModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
