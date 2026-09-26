# Order API

API de pedidos em NestJS, com MySQL, RabbitMQ e processamento assíncrono.

## Pré-requisitos

- Docker Engine 24+ e Docker Compose v2 (`docker compose`)
- Para execução fora do container: Node.js 22+ e npm

## Execução local com Docker Compose

Em um ambiente novo, copie o exemplo e confira a configuração antes de iniciar:

```bash
cp .env.example .env
docker compose config --quiet
docker compose up --build -d
docker compose ps
```

O Compose aguarda MySQL e RabbitMQ saudáveis, executa as migrations pelo
serviço `migrate` e inicia a API depois. A configuração padrão é para uso local;
as credenciais de `.env.example` não devem ser usadas em produção.

Portas publicadas no host:

- API: `3000` (`API_PORT`)
- MySQL: `3306` (`MYSQL_PORT`)
- RabbitMQ AMQP: `5672` (`RABBITMQ_PORT`)
- RabbitMQ Management: `15672` (`RABBITMQ_MANAGEMENT_PORT`)

Dentro da rede Compose, os serviços se resolvem por `mysql` e `rabbitmq`; fora
dela, use `localhost`. Os dados locais de MySQL e RabbitMQ ficam em volumes
persistentes.

```bash
docker compose logs -f api
docker compose down
```

`docker compose down` para os serviços desse projeto sem apagar os volumes.
`docker compose down -v` também apaga os dados e é irreversível; confira o
projeto Compose atual antes de usá-lo. Não execute limpeza enquanto outra
pessoa ou processo estiver usando a mesma stack.

## Migrations

`synchronize` não é usado com `NODE_ENV=production`. A migration é uma etapa
explícita do Compose e também pode ser executada manualmente após o build:

```bash
docker compose run --rm migrate
# ou, fora do Docker:
npm run build
npm run migration:run
```

Não execute `migration:revert` sem confirmar o impacto no banco.

## Testes

Os testes unitários e o E2E local usam SQLite em memória. O comando E2E está
configurado para Jest/TypeScript ESM e pode ser executado independentemente da
stack MySQL/RabbitMQ:

```bash
npm ci --legacy-peer-deps
npm run lint
npm run build
npm test -- --runInBand
npm run test:e2e -- --runInBand
```

A flag `--legacy-peer-deps` também é usada no Dockerfile: `@nestjs/swagger@12`
declara peer de NestJS 12, enquanto o projeto usa NestJS 11. Sem a flag, `npm ci`
faz falhar a resolução de dependências.

Para testar a integração real, `npm run test:acceptance:compose` cria MySQL e
RabbitMQ temporários e executa migrations, lint, build, testes unitários e
aceitação com a aplicação conectada aos dois serviços. O script usa o projeto
Compose fixo `order-api-p0-acceptance`, sem portas publicadas e sem volumes
persistentes; ao terminar (inclusive em caso de falha), remove os recursos
desse projeto. Ele não toca nos volumes do Compose local `order-api`. Não rode
duas execuções desse script simultaneamente nem mantenha outro ambiente usando
o mesmo projeto de aceitação, pois a limpeza é deliberadamente restrita a esse
nome de projeto.

O comando mais abrangente da suíte isolada é:

```bash
npm run test:acceptance:compose
```

Também é possível executar apenas `npm run test:acceptance` quando já houver
MySQL migrado e RabbitMQ acessíveis pelas variáveis `DB_TYPE=mysql`, `DB_HOST`,
`DB_PORT`, `DB_USERNAME`, `DB_PASSWORD`, `DB_NAME`, `RABBITMQ_ENABLED=true` e
`RABBITMQ_URL`. Sem esses serviços, a aceitação falha intencionalmente em vez
de simular o broker ou o banco.

## Publicação confiável e processamento

`POST /orders` persiste pedido e evento `order.created` na tabela outbox dentro
da mesma transação MySQL. Assim, ambos são gravados ou revertidos juntos. Um
dispatcher consulta eventos pendentes em lotes e publica no RabbitMQ usando
publisher confirms; só então registra `publishedAt`. Falha de publicação
mantém o evento pendente para nova tentativa. Há reconexão ao RabbitMQ e os
erros de dispatch/consumer são enviados aos logs da aplicação.

A entrega é **at-least-once**, não exactly-once: uma queda depois do confirm do
broker e antes da atualização da outbox pode causar publicação duplicada. O
consumer reconhece pedidos já terminais (`PROCESSED`/`FAILED`) sem repetir a
reserva. A reserva roda em transação MySQL, serializa o processamento do pedido
com lock e atualiza cada produto condicionalmente (`stock >= quantidade`). Se
algum item não tiver saldo, toda a transação de reserva é revertida, inclusive
as alterações dos itens anteriores, antes de registrar a falha do pedido.

Falhas de evento inválido, pedido inexistente e estoque insuficiente são
permanentes: não são repetidas e seguem para a DLQ; quando há pedido, o motivo
é persistido como `FAILED`. As demais falhas de processamento são tratadas
como transitórias e tentadas novamente por filas RabbitMQ com TTL de 1, 5 e 15
segundos. A publicação no retry também usa publisher confirm antes de confirmar
a mensagem original. Depois das três tentativas adicionais, o pedido é marcado
`FAILED` e a mensagem vai para a DLQ.

### Limitações operacionais conhecidas

- A outbox não tem mecanismo distribuído de claim/lease: várias réplicas da
  API podem publicar o mesmo evento pendente. O fluxo tolera redelivery, mas
  isso não substitui uma estratégia de coordenação para escalar dispatchers.
- Há logs de erro, mas não estão configurados métricas, alertas, tracing,
  painel operacional ou procedimento automatizado de inspeção/reprocessamento
  da DLQ.
- Os atrasos de retry são fixos e o dispatch da outbox volta a tentar no ciclo
  seguinte; não há política operacional configurável nem retenção/limpeza da
  outbox documentada.
- JWT e autorização não estão implementados. O Compose é para desenvolvimento
  e validação local, não constitui configuração de produção validada.

## Desenvolvimento sem Docker

```bash
npm ci --legacy-peer-deps
cp .env.example .env
npm run start:dev
```

Para executar a API fora dos containers, use `DB_HOST=localhost` e tenha os
serviços necessários disponíveis. Para os testes unitários/E2E isolados, a
configuração de teste usa `DB_TYPE=better-sqlite3`, `DB_NAME=:memory:` e
`RABBITMQ_ENABLED=false`.

## Endpoints

- `POST /orders`
- `GET /orders/:id`
- `GET /orders?page=1&limit=10`
- Swagger: `/docs`

## Respostas de arquitetura

1. **Redelivery:** a reserva e a mudança para `PROCESSED` são transacionais; o
   consumer confirma pedidos em estado terminal sem decrementar estoque de
   novo. A garantia é idempotência do efeito de negócio, com entrega
   at-least-once.
2. **Escala:** consumers podem ser executados em mais instâncias, respeitando
   os limites de conexão e concorrência do MySQL. Antes de escalar dispatchers
   da outbox, é necessário acrescentar claim/lease ou locking distribuído para
   evitar publicações duplicadas.
3. **Migrações sem downtime:** aplicar mudanças compatíveis em etapas
   expand/contract (adicionar estrutura opcional, implantar código compatível,
   migrar dados e só depois remover estrutura antiga), com backup e plano de
   rollback próprios. O Compose local não valida esse processo operacional.
4. **SSO indisponível:** não existe integração SSO/JWT nesta entrega; se
   adicionada, validação local de tokens assinados com chaves em cache poderia
   reduzir dependência de chamadas ao provedor, com política explícita de
   expiração e rotação.
5. **Pedido pendente:** correlacionar id do pedido nos registros da aplicação,
   conferir evento e tentativas na outbox, conectividade/filas no RabbitMQ e
   os logs do consumer. Atualmente não há métricas/alertas nem ferramenta de
   replay da DLQ, então a investigação depende dos logs e inspeção dos serviços.

## Troubleshooting

- **API não inicia:** consulte `docker compose logs migrate api` e confirme
  que MySQL e RabbitMQ estão saudáveis.
- **Porta ocupada:** altere `API_PORT`, `MYSQL_PORT` ou
  `RABBITMQ_MANAGEMENT_PORT` no `.env`.
- **Migration já aplicada:** isso é esperado; TypeORM registra o histórico na
  tabela `migrations`.
- **Limpeza completa local:** `docker compose down -v` remove também os
  volumes MySQL/RabbitMQ; revise o projeto selecionado antes de executar.
