import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddOutboxRequestId1750000000000 implements MigrationInterface {
  name = 'AddOutboxRequestId1750000000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE `outbox_events` ADD `requestId` varchar(128) NULL',
    );
    await queryRunner.query(
      'CREATE INDEX `IDX_outbox_events_request_id` ON `outbox_events` (`requestId`)',
    );
    await queryRunner.query(
      'ALTER TABLE `outbox_events` ADD `traceparent` varchar(512) NULL, ADD `tracestate` varchar(512) NULL',
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'DROP INDEX `IDX_outbox_events_request_id` ON `outbox_events`',
    );
    await queryRunner.query(
      'ALTER TABLE `outbox_events` DROP COLUMN `tracestate`, DROP COLUMN `traceparent`, DROP COLUMN `requestId`',
    );
  }
}
