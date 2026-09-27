import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity('outbox_events')
@Index('IDX_outbox_events_pending', ['publishedAt', 'id'])
export class OutboxEventEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'varchar', length: 100, unique: true })
  eventId: string;

  @Column({ type: 'varchar', length: 100 })
  eventType: string;

  @Column({ type: 'varchar', length: 128, nullable: true })
  requestId?: string | null;

  @Column({ type: 'varchar', length: 512, nullable: true })
  traceparent?: string | null;

  @Column({ type: 'varchar', length: 512, nullable: true })
  tracestate?: string | null;

  @Column({ type: 'simple-json' })
  payload: Record<string, unknown>;

  @Column({ type: 'int', default: 0 })
  attempts: number;

  @Column({ type: 'datetime', nullable: true })
  publishedAt: Date | null;

  @CreateDateColumn()
  createdAt: Date;
}
