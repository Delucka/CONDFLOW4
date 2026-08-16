# Cobrança das contas de concessionária

A emissão trava esperando a conta de água, gás ou energia chegar. A cobrança era
alguém lembrar de perguntar — quem cobra esquece, quem deve mandar não é
lembrado, e a emissão atrasa sem ninguém ter errado de propósito.

## A peça que já estava na fatura

Toda fatura traz a data da **próxima leitura**: quando a concessionária lê o
medidor de novo, ou seja, quando a conta do mês seguinte se forma. Com ela dá
para agendar a cobrança com um mês de antecedência, em vez de descobrir o atraso
na hora de emitir.

## O ciclo

| Quando | O que acontece |
|---|---|
| Fatura anexada com próxima leitura | abre a pendência do **mês seguinte** |
| Chega o dia da leitura | começa a cobrar por e-mail |
| A fatura do mês é anexada | a pendência **fecha sozinha** |
| Justificativa escrita | suspensa — o e-mail para |
| Justificativa recusada | volta a cobrar, com o motivo da recusa no e-mail |

O terceiro item é o que faz isto valer: **ninguém marca "recebido" à mão**. A
linha em `consumos_faturas` já nasce quando a fatura é anexada (0037/0041), e um
gatilho fecha a pendência. Cobrança que continua depois da conta chegar seria
pior do que não cobrar.

## As regras, e de onde vieram

Todas foram decididas pela operação, não pelo código:

- **quem é cobrado** — o gerente da carteira e o assistente vinculado a ele
- **a cada 2 dias** — o prazo de emissão é apertado
- **só e-mail** — o sino não alcança quem não abriu o sistema no dia
- **começa no dia da leitura** — não espera folga
- **quem suspende** — o próprio gerente ou assistente, com justificativa escrita.
  Sem aprovação prévia: travar isso criaria fila para quem já está cheio. O
  controle é por transparência.
- **quem manda voltar a cobrar** — master e emissão, com o motivo da recusa

Uma assumida por mim, e vale revisar se incomodar: **só dispara em dia útil**. Se
o envio cair no sábado, sai na segunda. E-mail de cobrança no fim de semana não é
pressão, é ruído — e faz a pessoa parar de ler os da semana.

## Onde fica na tela

**Consumos**, logo abaixo do cabeçalho. A matriz de consumos é consulta; a fila
de cobrança é trabalho com prazo, então vem antes.

Gerente e assistente veem a própria carteira. Master, emissão e supervisão veem
tudo — o recorte é feito no endpoint, porque a policy de leitura da tabela é
`USING (true)`.

## O agendamento (n8n)

O disparo **não** roda sozinho: é um endpoint que precisa ser chamado uma vez por
dia. O n8n já roda na mesma VPS.

Workflow com dois nós:

1. **Schedule Trigger** — todo dia, 9h
2. **HTTP Request**
   - `POST https://api.emissaonline.com/api/cobrancas-contas/executar`
   - header `x-api-key` = o mesmo `INTEGRACAO_API_KEY` do `.env` da API

Rodar duas vezes no mesmo dia **não** manda dois e-mails: o executor só pega quem
está `aguardando`, já passou da data e não foi cobrado nos últimos 2 dias. A
idempotência é da consulta, não de um controle à parte.

A resposta diz o que aconteceu:

```json
{"ok": true, "enviados": 4, "sem_destinatario": 1, "falhas_envio": 0, "candidatas": 12}
```

`sem_destinatario` maior que zero significa condomínio sem gerente com e-mail —
vale olhar o cadastro.

## Teste antes de agendar

```bash
curl -X POST https://api.emissaonline.com/api/cobrancas-contas/executar -H "x-api-key: SUA_CHAVE"
```

Num sábado ou domingo responde `{"pulado": "fim de semana", "enviados": 0}` — é o
comportamento correto, não uma falha.

## O que isto NÃO faz

- **Não cobra por WhatsApp.** A Evolution roda na VPS, mas não está conectada por
  QR Code. Quando estiver, o canal entra aqui.
- **Não sabe de conta que nunca teve fatura anexada.** A fila nasce da próxima
  leitura de uma fatura anterior; condomínio que nunca teve fatura no sistema não
  aparece — não há data de onde partir.
- **Não preenche o passado.** Até 16/08/2026 o OCR do navegador não extraía a
  próxima leitura, então quase nenhuma fatura antiga tem a data. Reprocessar os
  PDFs do bucket com OCR no servidor é o passo que resolveria isso.
