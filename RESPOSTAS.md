# Respostas de arquitetura e sistemas

As respostas abaixo descrevem primeiro o que a implementação atual faz e distinguem isso das medidas que seriam necessárias para evoluí-la. O projeto usa NestJS, MySQL/TypeORM, RabbitMQ e Keycloak; o Compose padrão é de desenvolvimento local.

## 1. Como garantir que um evento não seja processado duas vezes em caso de reentrega?

A aplicação não promete entrega *exactly-once*. A outbox publica com publisher confirm e só marca o evento como publicado após a confirmação do RabbitMQ; uma falha entre a confirmação e a atualização de `publishedAt` ainda pode causar republicação. O consumer, portanto, protege o **efeito de negócio** contra duplicidade:

- Antes de processar, compara `generation` e `processingRun` da mensagem com os valores atuais do pedido. Mensagem antiga ou pedido já `PROCESSED`/`FAILED` recebe ACK sem nova reserva.
- `startProcessingRun` verifica pedido e tentativa em transação; a execução válida é identificada pela combinação de pedido, geração e processamento.
- A reserva e a mudança para `PROCESSED` ocorrem na mesma transação MySQL, sob lock pessimista do pedido. O estoque é decrementado condicionalmente (`stock >= quantidade`); se um item falhar, a transação toda é revertida.
- O registro persistente `order_processing_runs` tem unicidade por `(orderId, generation, processingRun)` e mantém o estado/timestamps da tentativa.

Assim, reentregas concorrentes/duplicadas não devem debitar estoque novamente. Isso é idempotência do processamento de negócio, não deduplicação universal por `eventId`: a implementação não mantém uma tabela genérica de eventos consumidos. A entrega permanece **at-least-once**.

## 2. Como escalar o worker se o volume de pedidos crescer 10x?

Hoje o consumer é iniciado pela própria aplicação NestJS, consome `order.created` com `prefetch(1)`, e o dispatcher da outbox também roda nesse processo (busca lotes de até 20 eventos, a cada segundo). Portanto, o worker não é atualmente um serviço/deployment independente com autoscaling configurado.

A evolução recomendada é separar a execução HTTP dos processos de consumo e, se necessário, dos dispatchers da outbox. Escalaria réplicas de consumer gradualmente e observaria backlog/idade da fila, `Ready`/`Unacked`, latência e duração de processamento, taxa de falha/retry e capacidade de conexões/locks do MySQL. Depois de medir, ajustaria concorrência e `prefetch` com limites compatíveis com o banco; `prefetch(1)` atual favorece processamento controlado, mas pode limitar throughput. Também validaria o impacto de contenção no estoque e nos locks antes de elevar paralelismo.

Há uma limitação importante para escalar o dispatcher: ele não usa claim/lease ou locking distribuído. Subir várias réplicas que executam o dispatcher pode fazer mais de uma publicar a mesma linha ainda pendente. Antes de escalar dispatchers, seria necessário implementar coordenação atômica no MySQL (por exemplo, claim/lease com prazo e recuperação de lease expirado) e manter o consumer idempotente. O projeto não configura autoscaling, benchmarks de 10x, worker separado nem essa coordenação; esses passos são uma proposta de evolução, não capacidade já comprovada.

## 3. Como migrar schema em produção sem downtime?

O projeto usa migrations versionadas do TypeORM, e não `synchronize` em produção. Isso fornece a unidade de versionamento/aplicação, mas não torna qualquer alteração automaticamente compatível com zero downtime. Eu usaria uma estratégia **expand–migrate–contract**, com backup, validação em staging e plano de rollback:

1. **Expandir:** adicionar primeiro estruturas compatíveis e opcionais — novas tabelas/colunas nullable, índices ou defaults compatíveis — sem remover nem renomear campos ainda utilizados. Avaliar o comportamento de DDL/locks para a versão e tamanho reais do MySQL; usar operação online quando suportada e apropriada.
2. **Compatibilizar a aplicação:** publicar uma versão que funcione com schema antigo e novo. Se houver escrita dupla ou leitura de fallback, mantê-las temporariamente explícitas e testadas.
3. **Migrar dados:** backfill em lotes idempotentes, monitorando duração, locks, replicação e erros. Em tabelas grandes, evitar uma única transação longa.
4. **Trocar o uso:** implantar código que passe a ler/escrever o novo modelo e verificar métricas, logs e consistência.
5. **Contrair depois:** somente após todas as instâncias antigas serem drenadas e a migração confirmada, remover estruturas antigas em uma migration posterior.

O Compose executa o serviço `migrate` antes de iniciar a API, mas esse arranjo local não comprova deploy sem downtime em produção. A estratégia deve considerar a ordem de rollout entre versões e a duração/impacto da migration real. Não executaria `migration:revert` como mecanismo automático de rollback sem avaliar se houve escrita no novo schema; em muitos casos, a correção é uma migration forward.

## 4. O que ocorre se Keycloak/Auth0 ficar indisponível e como mitigar?

A API valida localmente a assinatura RS256 do JWT usando chaves públicas JWKS; não chama o provedor a cada requisição nem mantém sessão. A chave JWKS é cacheada por processo (TTL padrão de 10 minutos). Enquanto a chave necessária estiver válida no cache, tokens assinados por ela ainda podem ser verificados durante uma indisponibilidade do provedor. Se o `kid` for desconhecido ou for necessária uma atualização após expiração do cache, a falha/timeout do JWKS impede a validação e a requisição autenticada falha de forma fechada, normalmente com `401`. O cache e a configuração são locais por instância.

Para mitigar: operar o IdP com alta disponibilidade; monitorar conectividade, latência e erros do endpoint JWKS; garantir DNS/TLS/rede entre API e IdP; definir TTL e timeout compatíveis com a janela de rotação e o risco de revogação; e orientar clientes a tratar `401` conforme a causa e repetir chamadas de forma limitada quando aplicável. O cache melhora a tolerância a interrupções curtas para chaves já conhecidas, mas um TTL maior também atrasa a adoção de rotação/revogação. Não se deve aceitar token sem validar assinatura, ignorar issuer/audience/expiração, nem desabilitar autenticação como fallback. O projeto não tem cache JWKS compartilhado, introspecção, failover de IdP ou métrica/alerta específico de JWKS.

## 5. Como investigar um pedido travado sem confirmação: API, fila ou worker?

Eu seguiria os identificadores `orderId`, `eventId`, `requestId`, `generation` e `processingRun`, comparando banco, outbox, RabbitMQ e logs. As consultas abaixo são somente leitura; substitua `X` por um ID inteiro validado e não compartilhe payload completo nem dados pessoais:

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

Em seguida, classificaria a etapa:

- **API/persistência:** conferir resposta HTTP e `X-Request-Id`, logs `order.create.accepted` ou `order.reprocess.accepted`, status/counters HTTP e estado do pedido no MySQL. Se não houver pedido, investigar validação, autorização, erro da requisição ou transação.
- **Outbox/publicação:** se houver pedido, mas nenhuma outbox correspondente ou `publishedAt` estiver nulo, consultar `order_outbox_pending`, `order_outbox_oldest_pending_age_seconds`, `order_outbox_publication_attempts_total` e logs `outbox.event.publish_failed` / `outbox.dispatch.query_failed`. Isso aponta para gravação/publicação/dispatcher, não prova problema no consumer.
- **Fila/broker:** `publishedAt` significa que o dispatcher obteve publisher confirm e atualizou o banco; não significa que o worker terminou. No RabbitMQ Management, verificar `order.created`, filas `order.created.retry.*` e `order.created.dlq`, especialmente `Ready`, `Unacked` e `Consumers`. `Ready` crescente sem consumers sugere worker desconectado; mensagens `Unacked` sem progresso sugerem processamento lento/suspenso; retry ou DLQ indica falha/reentrega.
- **Worker:** procurar logs `consumer.attempt.started`, `consumer.attempt.succeeded`, `consumer.attempt.retry_scheduled`, `consumer.attempt.failed` ou `consumer.message.stale`, correlacionando geração/run atuais. `startedAt` mostra se uma tentativa válida iniciou; `completedAt` e status terminal mostram conclusão persistida. Verificar também `order_consumer_results_total`, `order_processing_results_total` e duração de processamento.
- **Trace e correlação:** no Grafana Explore, filtrar logs do Loki por `requestId`/`eventId`/`orderId` e abrir no Tempo o trace pelo atributo `request.id`; spans relevantes incluem HTTP, `outbox.publish` e `order.process`. Eventos antigos podem não ter todos os identificadores.

O projeto não tem endpoint HTTP `/health`, não instrumenta consultas SQL/TypeORM e não configura notificações do Alertmanager. Não usar **Get messages**, ack, requeue, purge ou alteração de binding no Management durante a investigação: essas operações podem consumir, duplicar, reordenar ou apagar evidência. Para pedidos `FAILED`, corrigir a causa e usar o endpoint suportado de reprocessamento; ele não faz replay direto da DLQ.
