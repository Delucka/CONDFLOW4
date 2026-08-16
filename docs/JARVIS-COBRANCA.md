# Ligar o JARVIS na fila de cobrança

O agente do WhatsApp já existe e funciona. O que muda aqui é **de onde ele lê** e
**por onde ele manda**.

## O problema das duas pontas

Hoje o JARVIS lê a planilha "ATUALIZAÇÃO DE COBRANÇA 2025" e manda pelo Gmail
direto. Isso cria dois pontos cegos:

**Ele não sabe o que o sistema sabe.** Não vê que a conta da SABESP do 374 chegou
ontem, nem que o gerente justificou o atraso, nem quantas vezes já foi cobrado. A
planilha é uma foto de quando alguém a atualizou pela última vez.

**O sistema não sabe o que ele fez.** O e-mail sai pelo Gmail e a cobrança não
fica registrada em lugar nenhum. Amanhã ninguém sabe se aquele condomínio foi
cobrado, nem quantas vezes.

Trocando as duas pontas, o JARVIS vira a interface por WhatsApp da **mesma fila**
que a tela mostra.

## A autenticação

Os endpoints aceitam `x-api-key` com o mesmo valor de `INTEGRACAO_API_KEY` que já
está no `.env` da API. Sem a chave, respondem 401.

A máquina entra com o papel `integracao`: vê tudo e pode cobrar. O que ela **não**
pode é suspender uma cobrança — justificativa tem de ser atribuível a uma pessoa,
senão "suspenso por JARVIS" vira um beco sem responsável.

## Substitua o nó "Get row(s) in sheet"

**HTTP Request Tool** — `Consultar contas que faltam`

```
GET https://api.emissaonline.com/api/contas-esperadas/mes
Header: x-api-key = {{ $env.INTEGRACAO_API_KEY }}
Query (todos opcionais):
  condominio = {{ $fromAI("condominio") }}   nome ou código, como a pessoa fala
  situacao   = {{ $fromAI("situacao") }}     cobrar | esperando | sem_informacao | chegaram
  mes, ano                                   sem eles, assume o mês de trabalho
```

Descrição para o agente:

> Mostra as contas de concessionária esperadas no mês e o estado de cada uma.
> Filtre com `condominio` (nome ou número, ex.: "irapuru", "436") e com
> `situacao`:
> **cobrar** = a leitura já aconteceu e a conta não chegou (é o que se cobra);
> **esperando** = a leitura ainda não aconteceu, a conta nem foi emitida;
> **sem_informacao** = não sabemos a data da leitura;
> **chegaram** = já anexada.
> Cada item traz condominio_id, concessionaria, leitura_prevista, leitura_passou,
> ja_anexada e, quando existe, a cobrança com quantas já foram enviadas.
> NUNCA cobre um item com situacao "esperando": a concessionária ainda não emitiu
> a conta, e cobrar o gerente por isso é cobrar pelo que ele não pode entregar.

**Por que este e não `/api/cobrancas-contas`:** aquele lista só as cobranças já
abertas. Este mostra o mês inteiro — inclusive o que ainda ninguém cobrou, que é
justamente o que se quer descobrir.

## Substitua o nó "Enviar email"

**HTTP Request Tool** — `Cobrar a conta`

```
POST https://api.emissaonline.com/api/cobrancas-contas/cobrar-direto
Header: x-api-key = {{ $env.INTEGRACAO_API_KEY }}
Body (JSON):
  condominio_id  = {{ $fromAI("condominioId") }}
  concessionaria = {{ $fromAI("concessionaria") }}
  mes_referencia = {{ $fromAI("mes") }}
  ano_referencia = {{ $fromAI("ano") }}
```

Descrição para o agente:

> Manda o e-mail de cobrança para o gerente e o assistente do condomínio. Use o
> `condominio_id`, a `concessionaria`, o `mes` e o `ano` vindos da consulta.
> Responde com a lista de e-mails que receberam. Só chame depois da confirmação
> explícita do usuário.

Este endpoint abre a pendência se ela ainda não existir — por isso serve tanto
para a primeira cobrança quanto para a insistência, sem o agente precisar saber
a diferença.

Por que não é o Gmail direto: aqui o e-mail sai com o template do sistema, para
os destinatários corretos resolvidos pela carteira, **e a cobrança fica
registrada** — contador, data e histórico.

## Abrir cobrança pelo WhatsApp (opcional)

```
POST https://api.emissaonline.com/api/cobrancas-contas
Header: x-api-key = ...
Body: { "condominio_id": "...", "concessionaria": "SABESP",
        "mes_referencia": 9, "ano_referencia": 2026 }
```

Serve para "abre cobrança da água do 374 de setembro". Precisa do `condominio_id`,
que vem da consulta.

## O que o system prompt precisa mudar

O prompt atual diz "toda informação vem da PLANILHA VINCULADA". Troque por:

> Toda informação vem da consulta à fila de cobrança do CondoFlow. Nunca invente
> condomínio, valor ou data — se a consulta não trouxe, diga que não encontrou.

O resto do prompt continua valendo, e é a melhor parte dele: mostrar os dados
extraídos, mostrar a prévia, e **esperar confirmação antes de enviar**. Com o
endpoint de cobrar, essa confirmação passa a ser a última tranca antes de um
e-mail de verdade sair — vale mantê-la exatamente como está.

## O que continua fora

- **Suspender pelo WhatsApp.** A justificativa precisa de autor. Se um dia o
  JARVIS atender os gerentes (hoje ele responde a um número só), dá para permitir
  registrando quem falou.
- **A fila cheia.** Ela nasce da próxima leitura impressa na fatura, e esse dado
  só passou a ser capturado em 16/08/2026. Enquanto o histórico não existir, o
  JARVIS vai encontrar pouca coisa — use "Nova cobrança" para abrir o que já se
  sabe estar faltando.
