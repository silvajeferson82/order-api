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
serviço `migrate` e inicia a API depois. A configuração padrão do Compose é para desenvolvimento local: a API usa
`NODE_ENV=development` e `AUTH_ENABLED=false`. Esse modo é explicitamente
desprotegido e não deve ser publicado. Em produção, `NODE_ENV=production`
rejeita `AUTH_ENABLED=false` e exige configuração HTTPS do Keycloak. As
credenciais de `.env.example` não devem ser usadas em produção.

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

O E2E sobe um servidor JWKS local e gera chaves RSA efêmeras; não acessa
Keycloak nem usa tokens/chaves do ambiente. A configuração `AUTH_ENABLED=false`
dos testes unitários e da aceitação real é explícita e serve apenas para cobrir
fluxos que não são testes de autenticação.

O E2E cobre também o contrato de `POST /orders/:id/reprocess` (papel,
`202`/`400`/`404`/`409` e gravação transacional da nova mensagem na outbox).
A aceitação Compose com MySQL/RabbitMQ valida o reprocessamento de um pedido
realmente `FAILED`, a conclusão da nova geração e o descarte de uma mensagem
atrasada da geração anterior sem novo débito de estoque.
Também confere o histórico de criação/falha/reprocessamento, sua correlação
com as linhas da outbox e a atualização terminal da tentativa no MySQL.

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

Os contratos de domínio `OrderCreatedEvent` e
`OrderReprocessRequestedEvent` são versionados (`version: 1`) e não dependem de
NestJS, TypeORM ou RabbitMQ. A aplicação cria esses eventos; a persistência
grava o evento serializado na outbox na mesma transação que o pedido; somente o
dispatcher conhece o publisher RabbitMQ. Portanto, o request não publica
diretamente no broker e não há dual-write pedido/broker.

A entrega é **at-least-once**, não exactly-once: uma queda depois do confirm do
broker e antes da atualização da outbox pode causar publicação duplicada. O
consumer reconhece pedidos já terminais (`PROCESSED`/`FAILED`) sem repetir a
reserva. A reserva roda em transação MySQL, serializa o processamento do pedido
com lock e atualiza cada produto condicionalmente (`stock >= quantidade`). Se
algum item não tiver saldo, toda a transação de reserva é revertida, inclusive
as alterações dos itens anteriores, antes de registrar a falha do pedido.

O pedido mantém `generation` e `processingRun`, ambos iniciados em `1`. O
endpoint `POST /orders/:id/reprocess` exige `order-admin` e só aceita pedidos
`FAILED`: sob lock pessimista no MySQL, muda o pedido para `PENDING`, limpa o
motivo de falha, incrementa os dois contadores e grava o evento
`order.reprocess.requested` na mesma transação. Retorna `202`; pedido
inexistente retorna `404`, estado diferente de `FAILED` retorna `409` e ID
malformado retorna `400`. Duas solicitações concorrentes são serializadas:
apenas uma transição pode sair de `FAILED`, a outra observa `PENDING` e recebe
`409`. A geração é incluída nas mensagens e o consumer confirma sem processar
eventos de gerações antigas, inclusive mensagens atrasadas em retry. O estado
e os contadores também são retornados nas consultas do pedido.

Cada geração/processamento também tem uma linha persistente em
`order_processing_runs`, com unicidade `(orderId, generation, processingRun)`.
`source` distingue `CREATE` e `MANUAL`; `eventId` referencia o UUID da linha
outbox correspondente e `eventType` registra o tipo publicado. A linha nasce
como `PENDING` na mesma transação que grava pedido/reprocessamento e outbox.
O consumer atualiza o estado terminal e `completedAt` da tentativa na mesma
transação que atualiza o pedido; `startedAt` é preenchido na primeira entrega
válida e retries não criam novas linhas nem reiniciam o horário. Pedidos
anteriores à migration recebem uma linha inferida de seu estado e timestamps,
sem `eventId` (não se inventa vínculo para uma mensagem que talvez não exista).
`requestedBy` guarda somente o claim JWT `sub` na criação/reprocessamento
quando presente; não armazena o token. Execuções sem identidade autenticada
registram `NULL`. Não há endpoint de leitura do histórico nesta entrega.

Em deploy progressivo, a migration cria tabela/índices e faz o backfill inicial
sem alterar/remover colunas antigas. Binaries antigos continuam compatíveis
com a tabela adicional, mas não gravam tentativas: após drenar todas as
instâncias antigas, execute uma reconciliação idempotente para cobrir os
pedidos eventualmente criados nesse intervalo (o mesmo `INSERT ... SELECT` do
backfill, com `WHERE NOT EXISTS` pela chave única), antes de considerar a
auditoria completa. Faça backup e monitore tempo/locks do backfill em bases
grandes. O `down` remove exclusivamente a tabela nova e, portanto, descarta
todo o histórico.

Falhas de evento inválido, pedido inexistente e estoque insuficiente são
permanentes: não são repetidas e seguem para a DLQ; quando há pedido, o motivo
é persistido como `FAILED`. As demais falhas de processamento são tratadas
como transitórias e tentadas novamente por filas RabbitMQ com TTL de 1, 5 e 15
segundos. A publicação no retry também usa publisher confirm antes de confirmar
a mensagem original. Depois das três tentativas adicionais, o pedido é marcado
`FAILED` e a mensagem vai para a DLQ.

## Observabilidade e operação

Os logs da aplicação são JSON em stdout/stderr. O middleware aceita
`X-Request-Id` apenas quando é um UUID válido; outros valores (inclusive
strings longas, token-like ou IDs sem formato UUID) são substituídos por UUID.
A resposta sempre
retorna `X-Request-Id`. O identificador é propagado por AsyncLocalStorage,
gravado na outbox/evento quando o pedido nasce via HTTP e enviado nos headers
RabbitMQ. Eventos anteriores à mudança continuam válidos e podem não ter
`requestId`, `traceparent` ou `eventId` no payload.

Os logs dos marcos `order.create.accepted`, `order.reprocess.accepted`,
`outbox.event.published`/`outbox.event.publish_failed` e
`consumer.attempt.started`/`succeeded`/`failed`/
`retry_scheduled`/`message.stale` carregam os IDs aplicáveis
(`requestId`, `eventId`, `orderId`, `generation`, `processingRun`,
`eventType`). O sistema não registra corpo de pedido, itens, nomes de cliente,
JWT, credenciais nem conteúdo integral da mensagem. A `failureReason` continua
persistida para diagnóstico funcional; não a copie para canais de log/ticket
sem avaliar se contém informação sensível.

### Subir o profile local de observabilidade

O profile não é iniciado no `docker compose up` padrão. Para ativar os
exporters OTLP e os serviços de observabilidade:

```bash
OTEL_EXPORTER_OTLP_ENDPOINT=http://otel-collector:4318 \
  docker compose --profile observability up --build -d
docker compose --profile observability ps
docker compose --profile observability logs -f api prometheus loki alloy otel-collector tempo
```

Endpoints publicados apenas em loopback:

| Serviço | URL local | Uso |
| --- | --- | --- |
| Prometheus | http://localhost:9090 | métricas, regras e alertas avaliados |
| Grafana | http://localhost:3001 | dashboard `Order API / Order API - Operações` e Explore |
| Loki | http://localhost:3101 | logs JSON do container API, retenção de 72 horas |
| RabbitMQ Management | http://localhost:15672 | filas e consumers |
| API `/metrics` | http://localhost:3000/metrics | scrape Prometheus; não é rota health |

No primeiro acesso local ao Grafana, troque a senha de bootstrap imediatamente
e use essa instância somente para desenvolvimento local. As credenciais de
MySQL e RabbitMQ são as definidas localmente pelas variáveis `MYSQL_*` e
`RABBITMQ_*` no `.env`; não copie valores de exemplo para produção. As portas
do MySQL, AMQP, API, Management, Prometheus e Grafana estão limitadas a
`127.0.0.1` pelo Compose. O endpoint Prometheus do RabbitMQ
(`15692`) e o OTLP (`4318`) não são publicados no host, só ficam acessíveis na
rede Compose. Tempo mantém traces por até 72 horas; Prometheus, Grafana, Tempo e Loki usam
volumes persistentes e podem conter dados operacionais. Loki também persiste
logs por até 72 horas.

O Alloy usa a API Docker para descobrir exclusivamente containers com labels
Compose do projeto atual e serviço `api`; os IDs ficam como structured
metadata no Loki, não como labels indexadas. O socket Docker concede poder
elevado, efetivamente equivalente a controle do daemon local; o mount `:ro`
não limita as operações da API. Portanto, este profile é apenas para uma
máquina de desenvolvimento com daemon isolado, não para ambiente compartilhado
ou produção. Se não aceitar esse risco, não ative Alloy/profile; use os logs
diretamente com `docker compose logs`.

Em ambiente `production`, `METRICS_TOKEN` é obrigatório e deve ter pelo menos
32 caracteres aleatórios. O scrape da API deve enviar esse segredo em
`X-Metrics-Token` e estar restrito por rede/firewall; o token não deve ser
colocado em arquivos versionados nem em argumentos de linha de comando
persistentes. O Prometheus do profile local não configura autenticação de
scrape: não defina `METRICS_TOKEN` no ambiente local se quiser usá-lo sem
ajustar também uma credencial de scrape protegida. `/metrics` não tem JWT de
propósito para permitir scrape; com token configurado, a rota exige o token.
Não existe rota HTTP `/health`.

Os spans HTTP seguem `traceparent`/`tracestate`; os spans
`outbox.publish` e `order.process` preservam a relação com a requisição e
atravessam os headers AMQP, inclusive retries. No Grafana, abra **Explore**:
use Loki para buscar logs JSON e Tempo para filtrar por `request.id`.
Métricas não usam IDs individuais como labels. Foram adicionadas métricas HTTP,
resultados/duração de processamento, outbox pendente/idade/tentativas e
resultados de consumer/retry. O plugin `rabbitmq_prometheus` fornece métricas
da fila, incluindo ready, unacked e consumers. As regras ficam em
`observability/prometheus/alerts.yml` e podem ser consultadas em
`http://localhost:9090/alerts`: backlog da outbox/fila principal, outbox com
mais de 10 minutos, mensagens na DLQ, proporção elevada de falhas e scrape
indisponível. As regras são avaliadas localmente no Prometheus; não há
Alertmanager nem integração de notificação configurada.

### Runbook: pedido `X` continua `PENDING` há 10 minutos

1. Confirme o ID do pedido e o horário/ambiente. Não use o corpo completo do
   pedido para buscar diagnóstico.
2. Faça as consultas abaixo em uma sessão MySQL somente leitura. Os campos de
   saída não incluem nome do cliente, itens nem payload completo:

```sql
START TRANSACTION READ ONLY;

SELECT id, status, generation, processingRun, failureReason, createdAt, updatedAt,
       TIMESTAMPDIFF(MINUTE, createdAt, CURRENT_TIMESTAMP) AS ageMinutes
FROM orders
WHERE id = X;

SELECT orderId, generation, processingRun, source, eventId, eventType, status,
       failureReason, startedAt, completedAt, createdAt
FROM order_processing_runs
WHERE orderId = X
ORDER BY generation, processingRun;

SELECT eventId, eventType, requestId, attempts, publishedAt, createdAt
FROM outbox_events
WHERE eventType IN ('order.created', 'order.reprocess.requested')
  AND JSON_EXTRACT(payload, '$.orderId') = X
ORDER BY id DESC;

COMMIT;
```

   Substitua `X` por um inteiro validado. A consulta da outbox usa o JSON do
   evento apenas para filtrar o ID; não selecione nem compartilhe o payload.
3. Interprete os tempos/estados junto com a fila:
   - `orders.status=PENDING`, execução `PENDING` com `startedAt IS NULL`:
     ainda não há início válido do consumer. Se a outbox não tem linha ou
     `publishedAt IS NULL`, investigue dispatcher, erro de publicação e
     conectividade do broker.
   - `publishedAt` preenchido comprova que o dispatcher recebeu publisher
     confirm e atualizou o MySQL; **não** comprova que o consumer processou a
     mensagem. Compare fila pronta, consumers e retry.
   - `outbox_events.attempts` conta falhas de publicação registradas no banco,
     e não entregas RabbitMQ nem confirmações bem-sucedidas. A métrica
     `order_outbox_publication_attempts_total` contabiliza as tentativas do
     dispatcher.
   - `startedAt` preenchido indica que uma entrega válida iniciou aquela
     execução. Retries não reiniciam esse timestamp. `completedAt` preenchido
     e status terminal indicam resultado persistido; `failureReason` explica
     uma execução `FAILED`.
   - Uma geração/run anterior pode estar obsoleta após reprocessamento. Use
     sempre o par atual `generation`/`processingRun`; o consumer reconhece e
     confirma entregas antigas sem processá-las.
4. Abra http://localhost:15672 com as credenciais locais e selecione o vhost
   `/`, depois **Queues and Streams**. Examine `order.created`,
   `order.created.retry.1`, `.retry.2`, `.retry.3` e `order.created.dlq`:
   `Ready` é aguardando entrega; `Unacked` é entregue e ainda não confirmada;
   `Consumers` deve mostrar o worker conectado. Crescimento de `Ready` com
   consumers zero aponta para worker/conexão; `Unacked` parado pode indicar
   processamento suspenso ou demorado; retry crescente indica falha transitória
   e DLQ com conteúdo requer investigação da razão permanente/esgotamento.
5. Busque os logs JSON locais pelo `requestId` retornado no header HTTP (ou
   `eventId`/`orderId`/`generation`):

```bash
docker compose logs --since 30m --no-color api | grep -F '"requestId":"<uuid>"'
docker compose logs --since 30m --no-color api | grep -F '"eventId":"<uuid>"'
```

   No Grafana **Explore**, escolha Loki e use
   `{job="order-api"} | requestId="<uuid>"` (ou filtre `eventId`/`orderId`).
   Os IDs são structured metadata e não labels indexadas. Para traces, selecione
   Tempo e filtre o atributo `request.id` para abrir o trace HTTP e seus spans
   `outbox.publish` e `order.process`. Sem request ID em evento antigo,
   correlacione por `eventId`/IDs de execução e timestamps; não presuma que
   evento legado possui trace.
6. Consulte as séries do dashboard/Prometheus:
   `order_outbox_pending`,
   `order_outbox_oldest_pending_age_seconds`,
   `order_outbox_publication_attempts_total`,
   `order_processing_results_total`,
   `order_consumer_results_total`,
   `rabbitmq_detailed_queue_messages_ready`,
   `rabbitmq_detailed_queue_messages_unacked` e
   `rabbitmq_detailed_queue_consumers` (famílias detalhadas do plugin 3.13).
   Use as regras ativas em `/alerts` como sinais,
   não como prova isolada da causa.
7. A inspeção do Management deve ser somente leitura. Não use **Get messages**,
   ack, requeue, purge ou alteração de bindings como tentativa de diagnóstico:
   isso pode consumir uma mensagem, alterar sua ordem, duplicar processamento
   ou apagar evidência. Não faça `nack` manual nem requeue silencioso. Não
   apague/republique a linha da outbox. Para pedido já persistido como
   `FAILED`, o caminho suportado é `POST /orders/:id/reprocess` com papel
   `order-admin`; para fila/DLQ, registre evidência e valide um procedimento
   operacional revisado antes de qualquer intervenção.

### Limitações operacionais conhecidas

- A outbox não tem mecanismo distribuído de claim/lease: várias réplicas da
  API podem publicar o mesmo evento pendente. O fluxo tolera redelivery, mas
  isso não substitui uma estratégia de coordenação para escalar dispatchers.
- O profile local avalia regras Prometheus, mas não envia notificações; métricas
  RabbitMQ dependem de `rabbitmq_prometheus` e os spans são exportados apenas
  quando o endpoint OTLP está configurado. Não há instrumentação de consultas
  SQL/TypeORM. O novo endpoint reprocessa somente
  pedidos cuja falha já foi persistida no banco;
  ele não consome nem altera diretamente mensagens da DLQ.
- Os atrasos de retry são fixos e o dispatch da outbox volta a tentar no ciclo
  seguinte; não há política operacional configurável nem retenção/limpeza da
  outbox documentada.
- O Compose padrão é desenvolvimento local e inicia sem autenticação por
  configuração explícita. A autenticação JWT fica obrigatória em
  `NODE_ENV=production`, mas implantação, realm e disponibilidade do Keycloak
  precisam ser operados pelo ambiente consumidor.

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
- `POST /orders/:id/reprocess` (papel `order-admin`; somente estado `FAILED`)
- `GET /orders/:id`
- `GET /orders?page=1&limit=10`
- Swagger: `/docs`

## Autenticação e autorização (Keycloak)

A API atua como **Resource Server**: não faz login, não recebe senha de usuário
e não delega autenticação ao endpoint. O cliente obtém um access token no
Keycloak e envia `Authorization: Bearer <access_token>`. A estratégia NestJS
Passport valida localmente a assinatura RS256 a partir das chaves públicas
JWKS e, em seguida, valida `iss`, `aud`, `exp`, `nbf` (quando presente) e os
claims mínimos `sub` e `exp`. Token ausente, inválido, expirado ou com claims
incorretos resulta em **401**; token válido sem papel requerido resulta em
**403**.

### Matriz endpoint/papel

| Endpoint          | Papel client exigido |
| ----------------- | -------------------- |
| `GET /orders`     | `order-user`         |
| `GET /orders/:id` | `order-user`         |
| `POST /orders`    | `order-admin`        |
| `POST /orders/:id/reprocess` | `order-admin` |

Os papéis são lidos exclusivamente de
`resource_access.order-api.roles`. Não há autorização por propriedade/
ownership de pedido nesta implementação. Não foram criados endpoints PUT ou
DELETE.

### Keycloak e configuração

#### Iniciar Keycloak localmente com Docker

O Keycloak não faz parte do Compose da API. Primeiro inicie a stack para criar
a rede Docker do projeto:

```bash
docker compose up --build -d
docker network ls
```

Com o nome de rede padrão do projeto (`order-api_default`), inicie o Keycloak
e publique a porta 8080 no host:

```bash
docker volume create keycloak_data
docker run -d --name keycloak \
  --network order-api_default \
  --network-alias keycloak \
  -p 8080:8080 \
  -v keycloak_data:/opt/keycloak/data \
  -e KC_BOOTSTRAP_ADMIN_USERNAME=admin \
  -e KC_BOOTSTRAP_ADMIN_PASSWORD=admin \
  quay.io/keycloak/keycloak:26.2.5 start-dev \
  --hostname=http://localhost:8080
```

Se a rede tiver outro nome (por exemplo, porque `COMPOSE_PROJECT_NAME` foi
alterado), substitua `order-api_default` pelo nome mostrado por
`docker network ls`. Acompanhe a inicialização com
`docker logs -f keycloak`; quando estiver pronto, abra
`http://localhost:8080/admin/` e entre com `admin` / `admin`. Esses dados e o
modo `start-dev` são somente para desenvolvimento local. O volume
`keycloak_data` preserva o estado do Keycloak entre reinicializações.

#### Criar realm, client e papéis

1. No console administrativo, crie o realm `orders` (seletor de realm no
   canto superior esquerdo → **Create realm**).
2. Em **Clients**, crie um client OpenID Connect com o ID `order-api`.
   Cadastre os papéis de client `order-user` e `order-admin` na aba **Roles**.
   Para o teste interativo com Postman, deixe **Client authentication** desligado
   (client público), habilite **Standard flow** e cadastre
   `https://oauth.pstmn.io/v1/callback` em **Valid redirect URIs**. A API valida
   access tokens Bearer e não usa o client secret. Em produção, prefira clients
   separados para a aplicação cliente e para a API/recurso.
3. Configure um mapper de audiência para incluir `order-api` no claim `aud`
   dos access tokens: no client scope dedicado do client, adicione um mapper
   do tipo **Audience**, selecione **Included Client Audience: order-api** e
   habilite **Add to access token**.
4. Para testes locais, crie um usuário no realm, defina uma senha não temporária
   e, em **Role mapping**, atribua os client roles `order-user` e/ou
   `order-admin` do client `order-api`. Conceda `order-admin` apenas a quem
   puder criar pedidos.
5. Para obter um token de usuário no Postman, escolha **OAuth 2.0** →
   **Get New Access Token** e informe:
   - Grant Type: **Authorization Code (With PKCE)**; Code Challenge Method:
     **SHA-256 (S256)**.
   - Auth URL: `http://localhost:8080/realms/orders/protocol/openid-connect/auth`.
   - Access Token URL:
     `http://localhost:8080/realms/orders/protocol/openid-connect/token`.
   - Client ID: `order-api`; Client Secret: vazio; Callback URL:
     `https://oauth.pstmn.io/v1/callback`; Scope: `openid`.

   Clique em **Get New Access Token**, autentique o usuário criado no passo 4 e
   use **Use Token**. No Swagger (`http://localhost:3000/docs`), clique em
   **Authorize** e informe o access token. Para serviço a serviço, use
   **Client Credentials** com service account e privilégio mínimo. Não use
   password grant como fluxo de produção.

Com o `--hostname` usado acima, o issuer local é
`http://localhost:8080/realms/orders`. O endpoint JWKS acessível pela API em
container é `http://keycloak:8080/realms/orders/protocol/openid-connect/certs`;
`keycloak` é o alias na rede Docker. Para rodar a API fora do Docker, use
`http://localhost:8080` também na URL JWKS.

#### Conectar a API ao Keycloak

Para autenticar a API no Compose local, configure estas variáveis no `.env`:

```dotenv
NODE_ENV=development
AUTH_ENABLED=true
KEYCLOAK_ISSUER=http://localhost:8080/realms/orders
KEYCLOAK_AUDIENCE=order-api
KEYCLOAK_JWKS_URI=http://keycloak:8080/realms/orders/protocol/openid-connect/certs
```

Recrie a API para aplicar a configuração e confira os logs:

```bash
docker compose up -d --force-recreate api
docker compose logs -f api
```

O `iss` do token precisa corresponder exatamente a `KEYCLOAK_ISSUER`, e o
token deve conter `aud: order-api` e o papel de client em
`resource_access.order-api.roles`. Ao executar a API fora do Docker, troque
`KEYCLOAK_JWKS_URI` para
`http://localhost:8080/realms/orders/protocol/openid-connect/certs`.

Em ambientes não locais, use URLs HTTPS e injete a configuração por ambiente
ou secret manager (não versionar credenciais ou secrets):

```dotenv
NODE_ENV=production
AUTH_ENABLED=true
KEYCLOAK_ISSUER=https://<host>/realms/orders
KEYCLOAK_AUDIENCE=order-api
KEYCLOAK_JWKS_URI=https://<host>/realms/orders/protocol/openid-connect/certs
JWKS_CACHE_TTL_MS=600000
JWKS_TIMEOUT_MS=3000
JWKS_RATE_LIMIT=10
```

`AUTH_ENABLED` aceita somente `true`/`false`; quando omitido, autenticação é
ligada e as variáveis do Keycloak são obrigatórias. Desabilitá-la requer
`AUTH_ENABLED=false` explícito e só é permitido com `NODE_ENV=development` ou
`NODE_ENV=test`; é proibido em staging e em `NODE_ENV=production`. O
`.env.example` e o Compose padrão são exclusivamente desenvolvimento local.
Para Compose em produção, passe `NODE_ENV=production`, `AUTH_ENABLED=true` e
os três parâmetros Keycloak; sem eles o processo não inicia protegido.
Issuer/JWKS devem usar HTTPS fora de `development`/`test`. Os tempos e o limite JWKS são
validados na inicialização (TTL de 1 s a 24 h, timeout de 100 ms a 30 s e
limite de 1 a 100 requisições/minuto por instância).

### Fluxos recomendados

- **Usuário:** cliente web/mobile separado usa OpenID Connect Authorization
  Code com PKCE (S256), valida o fluxo no cliente e encaminha o access token à
  API. Não usar Implicit Flow.
- **Serviço:** Client Credentials com service account e client role mínimo
  necessário. Guarde o segredo do client em secret manager e faça rotação.
- O Resource Owner Password Credentials / password grant não é o fluxo
  principal recomendado; não colete senha de usuário nesta API.

### Cache JWKS, rotação e indisponibilidade

O JWKS client mantém cache em memória por processo (padrão 10 minutos) e
limita atualização a 10 solicitações/minuto por instância. Um `kid` não
conhecido provoca busca de JWKS para suportar rotação. A resposta de chave tem
timeout padrão de 3 segundos. Não há fallback para chave desconhecida ou para
chave obsoleta após expiração do cache: erro, timeout, HTTP inválido, limite
atingido ou ausência de `kid` resulta em autenticação negada (**fail-closed**,
401), sem aceitar token por indisponibilidade do provedor.

Chaves já obtidas continuam utilizáveis enquanto estiverem válidas no cache,
mesmo durante uma indisponibilidade do JWKS. Isso melhora disponibilidade,
mas significa que a revogação/rotação de chave pode levar até o TTL para
refletir em cada instância. Ajuste o TTL à janela de rotação e risco; reinicie
instâncias para limpar cache emergencialmente. O cache é local, não
compartilhado, e não há métrica/alerta JWKS incluído nesta entrega. A emissão e
renovação de tokens é responsabilidade do cliente/provedor; a API não mantém
sessão nem chama o endpoint de introspecção.

O Swagger em `/docs` declara HTTP Bearer e documenta respostas 401/403. Tokens,
senhas e segredos não são registrados pela implementação.

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
4. **Keycloak indisponível:** tokens com `kid` já conhecido e chave ainda em
   cache seguem verificáveis até expirar o TTL; chaves desconhecidas/expiradas
   não são aceitas sem atualização bem-sucedida do JWKS. A API nunca aceita um
   token sem validar a assinatura como fallback.
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
