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
no serviço `migrate` e só então inicia a API. A API também possui healthcheck
HTTP em `GET /`.

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

O perfil `test` usa uma imagem com dependências de desenvolvimento, um serviço
MySQL separado (`mysql-test`) e um volume separado. O serviço de testes usa
`NODE_ENV=test`, `dropSchema=true` e RabbitMQ desabilitado, portanto não
reutiliza os dados da API. Ele executa lint, build e testes unitários:

```bash
docker compose --profile test run --rm test
# Para o E2E, após a configuração de módulos do Jest ser alinhada:
npm run test:e2e -- --runInBand
```

Para remover o banco de testes:

```bash
docker compose --profile test down -v
```

Os testes unitários também podem ser executados localmente com
`npm ci && npm test -- --runInBand`; essa modalidade usa a configuração
existente do projeto e não valida conectividade Docker.

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

- `GET /`
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
