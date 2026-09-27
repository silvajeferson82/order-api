import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddOrderProcessingGeneration1730000000000 implements MigrationInterface {
  name = 'AddOrderProcessingGeneration1730000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE orders
        ADD COLUMN generation int NOT NULL DEFAULT 1,
        ADD COLUMN processingRun int NOT NULL DEFAULT 1`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE orders
        DROP COLUMN processingRun,
        DROP COLUMN generation`,
    );
  }
}
