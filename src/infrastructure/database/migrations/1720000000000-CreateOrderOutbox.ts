import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateOrderOutbox1720000000000 implements MigrationInterface {
  name = 'CreateOrderOutbox1720000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TABLE outbox_events (
      id int NOT NULL AUTO_INCREMENT,
      eventId varchar(100) NOT NULL,
      eventType varchar(100) NOT NULL,
      payload json NOT NULL,
      attempts int NOT NULL DEFAULT 0,
      publishedAt datetime NULL,
      createdAt datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
      UNIQUE INDEX IDX_outbox_events_eventId (eventId),
      INDEX IDX_outbox_events_pending (publishedAt, id),
      PRIMARY KEY (id)
    ) ENGINE=InnoDB`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE outbox_events');
  }
}
