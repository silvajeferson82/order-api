import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateOrderProcessingRuns1740000000000 implements MigrationInterface {
  name = 'CreateOrderProcessingRuns1740000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE order_processing_runs (
        id int NOT NULL AUTO_INCREMENT,
        orderId int NOT NULL,
        generation int NOT NULL,
        processingRun int NOT NULL,
        source varchar(20) NOT NULL,
        eventId varchar(100) NULL,
        eventType varchar(100) NOT NULL,
        status varchar(20) NOT NULL DEFAULT 'PENDING',
        failureReason text NULL,
        startedAt datetime NULL,
        completedAt datetime NULL,
        requestedBy varchar(255) NULL,
        createdAt datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        PRIMARY KEY (id),
        UNIQUE KEY UQ_order_processing_runs_order_generation_run (orderId, generation, processingRun),
        UNIQUE KEY UQ_order_processing_runs_event_id (eventId),
        KEY IDX_order_processing_runs_order_created (orderId, createdAt),
        CONSTRAINT FK_order_processing_runs_order FOREIGN KEY (orderId)
          REFERENCES orders(id) ON DELETE CASCADE,
        CONSTRAINT CHK_order_processing_runs_source CHECK (source IN ('CREATE', 'MANUAL')),
        CONSTRAINT CHK_order_processing_runs_status CHECK (status IN ('PENDING', 'PROCESSED', 'FAILED'))
      ) ENGINE=InnoDB
    `);

    await queryRunner.query(`
      INSERT INTO order_processing_runs
        (orderId, generation, processingRun, source, eventType, status,
         failureReason, startedAt, completedAt, createdAt)
      SELECT
        o.id,
        o.generation,
        o.processingRun,
        IF(o.generation = 1 AND o.processingRun = 1, 'CREATE', 'MANUAL'),
        IF(o.generation = 1 AND o.processingRun = 1,
          'order.created', 'order.reprocess.requested'),
        o.status,
        o.failureReason,
        CASE WHEN o.status = 'PENDING' THEN NULL ELSE o.updatedAt END,
        CASE WHEN o.status IN ('PROCESSED', 'FAILED') THEN o.updatedAt ELSE NULL END,
        o.createdAt
      FROM orders o
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE order_processing_runs');
  }
}
