import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { OrderEntity } from './order.entity';

export type OrderProcessingRunSource = 'CREATE' | 'MANUAL';
export type OrderProcessingRunStatus = 'PENDING' | 'PROCESSED' | 'FAILED';

@Entity('order_processing_runs')
@Index(
  'UQ_order_processing_runs_order_generation_run',
  ['orderId', 'generation', 'processingRun'],
  { unique: true },
)
@Index('IDX_order_processing_runs_order_created', ['orderId', 'createdAt'])
@Index('UQ_order_processing_runs_event_id', ['eventId'], { unique: true })
@Check('CHK_order_processing_runs_source', "`source` IN ('CREATE', 'MANUAL')")
@Check(
  'CHK_order_processing_runs_status',
  "`status` IN ('PENDING', 'PROCESSED', 'FAILED')",
)
export class OrderProcessingRunEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'int' })
  orderId: number;

  @ManyToOne(() => OrderEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'orderId' })
  order: OrderEntity;

  @Column({ type: 'int' })
  generation: number;

  @Column({ type: 'int' })
  processingRun: number;

  @Column({ type: 'varchar', length: 20 })
  source: OrderProcessingRunSource;

  @Column({ type: 'varchar', length: 100, nullable: true })
  eventId: string | null;

  @Column({ type: 'varchar', length: 100 })
  eventType: string;

  @Column({ type: 'varchar', length: 20, default: 'PENDING' })
  status: OrderProcessingRunStatus;

  @Column({ type: 'text', nullable: true })
  failureReason: string | null;

  @Column({ type: 'datetime', nullable: true })
  startedAt: Date | null;

  @Column({ type: 'datetime', nullable: true })
  completedAt: Date | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  requestedBy: string | null;

  @CreateDateColumn()
  createdAt: Date;
}
