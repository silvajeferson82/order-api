import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { Server } from 'node:http';
import request from 'supertest';
import { AppModule } from '../src/app.module';

describe('Orders API (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('/orders (POST)', async () => {
    const response = await request(app.getHttpServer() as Server)
      .post('/orders')
      .send({
        customerName: 'Alice',
        items: [{ productName: 'Keyboard', quantity: 2, price: 100 }],
      })
      .expect(201);

    const body = response.body as { id: number; status: string };
    expect(body).toHaveProperty('id');
    expect(body.status).toBe('PENDING');
  });
});
