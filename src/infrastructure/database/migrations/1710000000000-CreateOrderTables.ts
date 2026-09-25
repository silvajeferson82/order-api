import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateOrderTables1710000000000 implements MigrationInterface {
  name = 'CreateOrderTables1710000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TABLE products (
      id int NOT NULL AUTO_INCREMENT,
      name varchar(255) NOT NULL,
      stock int NOT NULL DEFAULT 5,
      createdAt datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE INDEX IDX_products_name (name),
      PRIMARY KEY (id)
    ) ENGINE=InnoDB`);
    await queryRunner.query(`CREATE TABLE orders (
      id int NOT NULL AUTO_INCREMENT,
      customerName varchar(255) NOT NULL,
      total decimal(10,2) NOT NULL DEFAULT 0,
      status varchar(20) NOT NULL DEFAULT 'PENDING',
      failureReason text NULL,
      createdAt datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
      updatedAt datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
      PRIMARY KEY (id)
    ) ENGINE=InnoDB`);
    await queryRunner.query(`CREATE TABLE order_items (
      id int NOT NULL AUTO_INCREMENT,
      productName varchar(255) NOT NULL,
      quantity int NOT NULL,
      price decimal(10,2) NOT NULL DEFAULT 0,
      orderId int NULL,
      PRIMARY KEY (id),
      CONSTRAINT FK_order_items_order FOREIGN KEY (orderId) REFERENCES orders(id) ON DELETE CASCADE
    ) ENGINE=InnoDB`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE order_items');
    await queryRunner.query('DROP TABLE orders');
    await queryRunner.query('DROP TABLE products');
  }
}
