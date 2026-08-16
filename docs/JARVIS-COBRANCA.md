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
GET https://api.emissaonline.com/api/cobrancas-contas
Header: x-api-key = {{ $env.INTEGRACAO_API_KEY }}
Query (opcionais):
  condominio = {{ $fromAI("condominio") }}   nome ou código, como a pessoa fala
  status     = aguardando | suspensa | recebida
```

Descrição para o agente:

> Lista as contas de concessionária que ainda não chegaram. Use `condominio` para
> filtrar por nome ou número (ex.: "irapuru", "436"). Cada item traz: condomínio,
> concessionária, mês de referência, data da leitura (`previsto_em`), `status`,
> quantas cobranças já saíram (`cobrancas`), se está atrasada, e a justificativa
> quando existe.

## Substitua o nó "Enviar email"

**HTTP Request Tool** — `Cobrar a conta`

```
POST https://api.emissaonline.com/api/cobrancas-contas/{{ $fromAI("cobrancaId") }}/cobrar
Header: x-api-key = {{ $env.INTEGRACAO_API_KEY }}
```

Descrição para o agente:

> Manda o e-mail de cobrança daquela conta para o gerente e o assistente do
> condomínio. Use o `id` vindo da consulta. Responde com a lista de e-mails que
> receberam. Só depois da confirmação do usuário.

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
