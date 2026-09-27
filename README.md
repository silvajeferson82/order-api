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
