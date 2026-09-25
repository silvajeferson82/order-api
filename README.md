# Order API

API de pedidos em NestJS, com MySQL, RabbitMQ e processamento assíncrono.

## Pré-requisitos

- Docker Engine 24+ e Docker Compose v2 (`docker compose`)
- Para execução fora do container: Node.js 22+ e npm

## Execução reproduzível (API + infraestrutura)

```bash
cp .env.example .env
docker compose up --build -d
docker compose ps
```

O Compose aguarda o MySQL e o RabbitMQ ficarem saudáveis, executa as migrations
no serviço `migrate` e só então inicia a API. O healthcheck do container verifica que a porta da API está aceitando conexões TCP; a API não expõe uma rota de saúde.

Portas publicadas no host:

- API: `3000` (`API_PORT`)
- MySQL: `3306` (`MYSQL_PORT`)
- RabbitMQ AMQP: `5672` (`RABBITMQ_PORT`, se definido)
- RabbitMQ Management: `15672` (`RABBITMQ_MANAGEMENT_PORT`)

Dentro da rede Docker, use `mysql` e `rabbitmq` como nomes DNS. Fora dela,
use `localhost`. As credenciais do `.env.example` são somente para
desenvolvimento local; não use esses valores em produção.

Logs e encerramento:

```bash
docker compose logs -f api
docker compose down
# Remove também dados locais (irreversível):
docker compose down -v
```

## Migrations

`synchronize` não é usado quando `NODE_ENV=production`. A migration é uma etapa
explícita do Compose e pode ser executada manualmente após um build:

```bash
docker compose run --rm migrate
# ou, fora do Docker, depois de npm run build:
npm run migration:run
```

Não execute `migration:revert` sem confirmar o impacto no banco.

## Testes isolados

O perfil `test` sobe MySQL e RabbitMQ dedicados, sem volumes persistentes. O
runner aplica as migrations reais, executa lint/build/testes unitários e a
aceitação que inicia a aplicação conectada aos dois serviços. Os testes cobrem
o pedido de ponta a ponta, rollback de múltiplos itens, concorrência no MySQL,
reentrega e DLQ:

```bash
npm run test:acceptance:compose
```

O comando usa o projeto Compose isolado `order-api-p0-acceptance` e remove,
inclusive em caso de falha, seus containers, rede e volumes temporários sem
tocar nos volumes da stack de desenvolvimento. Pode ser repetido. Para rodar
somente a suíte unitária/E2E SQLite existente localmente:

```bash
npm test -- --runInBand
npm run test:e2e -- --runInBand
```

O comando `npm run test:acceptance` requer MySQL migrado e RabbitMQ real
acessíveis via `DB_TYPE=mysql`, `DB_HOST`, `DB_PORT`, `DB_USERNAME`,
`DB_PASSWORD`, `DB_NAME`, `RABBITMQ_ENABLED=true` e `RABBITMQ_URL`; sem esses
serviços ele falha intencionalmente em vez de simular a aceitação.

## Publicação confiável e processamento

O `POST /orders` grava o pedido e o evento `order.created` na tabela outbox na
mesma transação MySQL. Um dispatcher tenta publicar a outbox periodicamente
usando um canal RabbitMQ de publisher confirms e somente marca o registro como
publicado após confirmação do broker. Se a aplicação cair entre confirmação e
marcação, pode haver republicação; o consumer é idempotente pelo estado do
pedido e serializa a reserva usando lock transacional no MySQL.

Falhas transitórias usam três filas RabbitMQ com TTL de 1, 5 e 15 segundos
antes de retornarem à fila principal. Falhas permanentes (por exemplo, estoque
insuficiente ou evento inválido) não são repetidas e são encaminhadas à DLQ.
Falha transitória que exceda as três tentativas marca o pedido como `FAILED` e
é encaminhada à DLQ. Mensagens só são confirmadas após persistir o resultado
ou confirmar a publicação no retry; a semântica é at-least-once, não
exactly-once. Consulte `docker compose logs -f api` para erros de dispatch e
consumer. Não há painel/alerta operacional configurado.

## Desenvolvimento sem Docker

```bash
npm ci
cp .env.example .env
npm run start:dev
```

Nesse caso a API usa `DB_HOST=localhost`. Para desligar a fila e usar o banco
leve de testes, defina `DB_TYPE=better-sqlite3`, `DB_NAME=:memory:` e
`RABBITMQ_ENABLED=false`.

## Endpoints

- `POST /orders`
- `GET /orders/:id`
- `GET /orders?page=1&limit=10`
- Swagger: `/docs`

## Troubleshooting

- **API não inicia:** `docker compose logs migrate api`; confirme que o
  MySQL está `healthy` e que o volume não contém uma instalação interrompida.
- **Porta ocupada:** altere `API_PORT`, `MYSQL_PORT` ou
  `RABBITMQ_MANAGEMENT_PORT` no `.env`.
- **Migration já aplicada:** isso é esperado; TypeORM registra o histórico na
  tabela `migrations`.
- **Limpeza completa de desenvolvimento:** `docker compose down -v`; isso
  apaga também os volumes MySQL/RabbitMQ.
