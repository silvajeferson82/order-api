import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { generateKeyPairSync, KeyObject } from 'node:crypto';
import { createServer, Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import request from 'supertest';
import jwt from 'jsonwebtoken';

type TestApplication = Omit<INestApplication, 'getHttpServer'> & {
  getHttpServer(): Server;
};

describe('Orders API auth (e2e)', () => {
  let app: TestApplication;
  let jwksServer: Server;
  let privateKey: KeyObject;
  let publicKeyMaterial: string;
  let currentPublicKey: JsonWebKey & { kid: string; alg: string; use: string };
  let unavailable = false;
  let issuer: string;

  beforeAll(async () => {
    const generated = generateKeyPairSync('rsa', { modulusLength: 2048 });
    privateKey = generated.privateKey;
    publicKeyMaterial = generated.publicKey
      .export({ type: 'spki', format: 'pem' })
      .toString();
    currentPublicKey = {
      ...(generated.publicKey.export({ format: 'jwk' }) as JsonWebKey),
      kid: 'test-key-1',
      alg: 'RS256',
      use: 'sig',
    };

    jwksServer = createServer((incoming, response) => {
      if (incoming.url !== '/certs' || unavailable) {
        response.writeHead(unavailable ? 503 : 404).end();
        return;
      }
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ keys: [currentPublicKey] }));
    });
    await new Promise<void>((resolve) =>
      jwksServer.listen(0, '127.0.0.1', resolve),
    );
    const address = jwksServer.address() as AddressInfo;
    issuer = 'https://issuer.test/realms/orders';
    process.env.NODE_ENV = 'test';
    process.env.AUTH_ENABLED = 'true';
    process.env.KEYCLOAK_ISSUER = issuer;
    process.env.KEYCLOAK_AUDIENCE = 'order-api';
    process.env.KEYCLOAK_JWKS_URI = `http://127.0.0.1:${address.port}/certs`;
    process.env.JWKS_CACHE_TTL_MS = '600000';
    process.env.JWKS_TIMEOUT_MS = '500';
    process.env.JWKS_RATE_LIMIT = '20';

    // Carrega a configuração apenas depois de iniciar o JWKS local e definir o ambiente.
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const { AppModule } = await import('../src/app.module');
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
    await new Promise<void>((resolve, reject) =>
      jwksServer.close((error) => (error ? reject(error) : resolve())),
    );
  });

  it('responde 401 sem token, com JWT malformado ou expirado', async () => {
    await request(app.getHttpServer()).get('/orders').expect(401);
    await request(app.getHttpServer())
      .get('/orders')
      .set('Authorization', 'Bearer not-a-jwt')
      .expect(401);
    await request(app.getHttpServer())
      .get('/orders')
      .set(
        'Authorization',
        `Bearer ${token(['order-user'], { expiresIn: -1 })}`,
      )
      .expect(401);
  });

  it('responde 401 para assinatura, issuer, audience e nbf inválidos', async () => {
    const wrongKey = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const badSignature = jwt.sign(
      { resource_access: { 'order-api': { roles: ['order-user'] } } },
      wrongKey.privateKey,
      {
        algorithm: 'RS256',
        keyid: 'test-key-1',
        issuer,
        audience: 'order-api',
        subject: 'user-1',
        expiresIn: '5m',
      },
    );
    await request(app.getHttpServer())
      .get('/orders')
      .set('Authorization', `Bearer ${badSignature}`)
      .expect(401);
    await request(app.getHttpServer())
      .get('/orders')
      .set(
        'Authorization',
        `Bearer ${token(['order-user'], { issuer: 'https://wrong.test' })}`,
      )
      .expect(401);
    await request(app.getHttpServer())
      .get('/orders')
      .set(
        'Authorization',
        `Bearer ${token(['order-user'], { audience: 'wrong-api' })}`,
      )
      .expect(401);
    await request(app.getHttpServer())
      .get('/orders')
      .set(
        'Authorization',
        `Bearer ${token(['order-user'], { notBefore: '1m' })}`,
      )
      .expect(401);

    const wrongAlgorithm = jwt.sign(
      { resource_access: { 'order-api': { roles: ['order-user'] } } },
      publicKeyMaterial,
      {
        algorithm: 'HS256',
        keyid: 'test-key-1',
        issuer,
        audience: 'order-api',
        subject: 'user-1',
        expiresIn: '5m',
      },
    );
    await request(app.getHttpServer())
      .get('/orders')
      .set('Authorization', `Bearer ${wrongAlgorithm}`)
      .expect(401);
  });

  it('rejeita token sem claims mínimos sub ou exp', async () => {
    const missingSubject = jwt.sign(
      { resource_access: { 'order-api': { roles: ['order-user'] } } },
      privateKey,
      {
        algorithm: 'RS256',
        keyid: 'test-key-1',
        issuer,
        audience: 'order-api',
        expiresIn: '5m',
      },
    );
    const missingExpiration = jwt.sign(
      { resource_access: { 'order-api': { roles: ['order-user'] } } },
      privateKey,
      {
        algorithm: 'RS256',
        keyid: 'test-key-1',
        issuer,
        audience: 'order-api',
        subject: 'test-user',
      },
    );
    await request(app.getHttpServer())
      .get('/orders')
      .set('Authorization', `Bearer ${missingSubject}`)
      .expect(401);
    await request(app.getHttpServer())
      .get('/orders')
      .set('Authorization', `Bearer ${missingExpiration}`)
      .expect(401);
  });

  it('distingue papel ausente/inválido com 403 e permite GET com order-user', async () => {
    await request(app.getHttpServer())
      .get('/orders')
      .set('Authorization', `Bearer ${token([])}`)
      .expect(403);
    await request(app.getHttpServer())
      .get('/orders')
      .set('Authorization', `Bearer ${token(['other-role'])}`)
      .expect(403);
    await request(app.getHttpServer())
      .get('/orders')
      .set('Authorization', `Bearer ${token(['order-user'])}`)
      .expect(200);
    await request(app.getHttpServer())
      .get('/orders/999999')
      .set('Authorization', `Bearer ${token(['order-user'])}`)
      .expect(404);
  });

  it('exige order-admin para POST e autoriza pedido com o papel correto', async () => {
    const userToken = token(['order-user']);
    const order = {
      customerName: 'Alice',
      items: [{ productName: 'Keyboard', quantity: 2, price: 100 }],
    };
    await request(app.getHttpServer())
      .post('/orders')
      .set('Authorization', `Bearer ${userToken}`)
      .send(order)
      .expect(403);

    const response = await request(app.getHttpServer())
      .post('/orders')
      .set('Authorization', `Bearer ${token(['order-admin'])}`)
      .send(order)
      .expect(201);
    expect(response.body).toHaveProperty('id');
    expect((response.body as { status: string }).status).toBe('PENDING');
  });

  it('busca e aceita kid novo após rotação JWKS, sem fallback aberto', async () => {
    const rotated = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const rotatedJwk = {
      ...(rotated.publicKey.export({ format: 'jwk' }) as JsonWebKey),
      kid: 'test-key-2',
      alg: 'RS256',
      use: 'sig',
    };
    currentPublicKey = rotatedJwk;
    const rotatedToken = jwt.sign(
      { resource_access: { 'order-api': { roles: ['order-user'] } } },
      rotated.privateKey,
      {
        algorithm: 'RS256',
        keyid: 'test-key-2',
        issuer,
        audience: 'order-api',
        subject: 'user-2',
        expiresIn: '5m',
      },
    );
    await request(app.getHttpServer())
      .get('/orders')
      .set('Authorization', `Bearer ${rotatedToken}`)
      .expect(200);

    unavailable = true;
    const unknownKid = jwt.sign(
      { resource_access: { 'order-api': { roles: ['order-user'] } } },
      rotated.privateKey,
      {
        algorithm: 'RS256',
        keyid: 'unknown-kid',
        issuer,
        audience: 'order-api',
        subject: 'user-3',
        expiresIn: '5m',
      },
    );
    await request(app.getHttpServer())
      .get('/orders')
      .set('Authorization', `Bearer ${unknownKid}`)
      .expect(401);
  });

  function token(
    roles: string[],
    options: {
      expiresIn?: number | string;
      issuer?: string;
      audience?: string;
      notBefore?: string;
    } = {},
  ): string {
    return jwt.sign(
      {
        resource_access: { 'order-api': { roles } },
      },
      privateKey,
      {
        algorithm: 'RS256',
        keyid: 'test-key-1',
        issuer: options.issuer ?? issuer,
        audience: options.audience ?? 'order-api',
        subject: 'test-user',
        expiresIn: options.expiresIn ?? '5m',
        ...(options.notBefore ? { notBefore: options.notBefore } : {}),
      },
    );
  }
});
