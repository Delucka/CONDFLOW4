# WhatsApp via Evolution API (na VPS Hostinger)

> Caminho escolhido (sem chip dedicado / sem verificação da Meta). A Evolution conecta um número que **já tem WhatsApp** via QR Code. Roda em Docker na mesma VPS do n8n.
>
> ⚠️ É não-oficial → a Meta pode banir. Use um **número secundário** (não a linha principal) e mantenha volume baixo (bot só responde, a pessoa inicia). Pro caso de 2ª via o risco é baixo.

## Visão geral
```
WhatsApp da pessoa
   → Evolution (VPS, Docker)  --webhook messages.upsert-->  n8n (workflow)
       → POST /api/integracao/wa (nosso backend, o cérebro)
       → Evolution /message/sendText  --> resposta volta pro WhatsApp
```

---

## Passo 1 — Subir a Evolution (Docker Compose)

`/opt/evolution/docker-compose.yml`:

```yaml
services:
  evolution-api:
    image: atendai/evolution-api:v2.2.3
    restart: always
    ports:
      - "127.0.0.1:8080:8080"        # só local; o proxy (Caddy/Nginx) expõe com TLS
    environment:
      SERVER_URL: https://evo.SEUDOMINIO
      AUTHENTICATION_API_KEY: ${EVOLUTION_API_KEY}     # invente uma chave forte
      DATABASE_ENABLED: "true"
      DATABASE_PROVIDER: postgresql
      DATABASE_CONNECTION_URI: postgresql://evolution:evolution@postgres:5432/evolution
      DATABASE_SAVE_DATA_INSTANCE: "true"
      DATABASE_SAVE_DATA_NEW_MESSAGE: "true"
      CACHE_REDIS_ENABLED: "true"
      CACHE_REDIS_URI: redis://redis:6379/6
      CACHE_REDIS_PREFIX_KEY: evolution
      CACHE_LOCAL_ENABLED: "false"
    depends_on: [postgres, redis]
    volumes:
      - evolution_instances:/evolution/instances

  postgres:
    image: postgres:15
    restart: always
    environment:
      POSTGRES_USER: evolution
      POSTGRES_PASSWORD: evolution
      POSTGRES_DB: evolution
    volumes:
      - evolution_pg:/var/lib/postgresql/data

  redis:
    image: redis:7
    restart: always
    volumes:
      - evolution_redis:/data

volumes:
  evolution_instances:
  evolution_pg:
  evolution_redis:
```

```bash
cd /opt/evolution
export EVOLUTION_API_KEY="$(openssl rand -hex 24)"   # guarde essa chave
echo "EVOLUTION_API_KEY=$EVOLUTION_API_KEY" > .env
docker compose up -d
docker compose logs -f evolution-api      # esperar "Server running"
```

Exponha `evo.SEUDOMINIO` → `127.0.0.1:8080` no **mesmo proxy** que serve o n8n (Caddy/Nginx/Traefik), com TLS. (Mesma lógica do guia da API.)

## Passo 2 — Conectar o número (QR Code)

Abra **`https://evo.SEUDOMINIO/manager`** no navegador → faça login com a `EVOLUTION_API_KEY`:
1. **Create Instance** → nome `propstarter` (esse vira o `INSTANCIA` do workflow).
2. Clique em **Connect / QR Code**.
3. No celular do número secundário: WhatsApp → Aparelhos conectados → **Conectar um aparelho** → escaneie o QR.
4. Status fica **open/connected**. Pronto, o número está ligado.

## Passo 3 — Apontar o webhook pro n8n

No workflow do n8n (`docs/n8n/segundas-vias-evolution.json`, importado e **ativo**), copie a **Production URL** do nó "Evolution recebe msg". Depois registre na Evolution:

```bash
curl -X POST "https://evo.SEUDOMINIO/webhook/set/propstarter" \
  -H "apikey: $EVOLUTION_API_KEY" -H "Content-Type: application/json" \
  -d '{
    "webhook": {
      "enabled": true,
      "url": "COLE_A_PRODUCTION_URL_DO_N8N",
      "byEvents": false,
      "events": ["MESSAGES_UPSERT"]
    }
  }'
```

(ou pela aba **Webhook** da instância no Manager: ligar, colar a URL, marcar só `MESSAGES_UPSERT`).

## Passo 4 — Ajustar o workflow no n8n

No `segundas-vias-evolution.json` já importado, edite:
- Nó **"Backend (cérebro do bot)"** → header `x-api-key` = sua `INTEGRACAO_API_KEY`.
- Nó **"Responder (Evolution)"** → URL troca `evo.SEUDOMINIO` e `INSTANCIA` (ex.: `.../sendText/propstarter`) e header `apikey` = sua `EVOLUTION_API_KEY`.

Salve e **ative** o workflow.

## Passo 5 — Testar
Mande um "oi" de outro WhatsApp pro número conectado → o bot deve responder *"Olá! 🐧 … Qual o condomínio?"*.

---

## Pré-requisitos do nosso lado (backend)
- [ ] **`INTEGRACAO_API_KEY`** nas envs do Vercel (hoje **não está**) — é a chave que protege `/api/integracao/wa`.
- [ ] Migrations aplicadas no Supabase: **0069** (segundas_vias.origem/ahreas_ref), **0070** (wa_conversas), **0071** (condominos).
- [ ] **Cadastro de condôminos** importado na tabela `condominos` (pra verificação por CPF). Sem isso o bot funciona, mas não consegue validar quem pode pedir a 2ª via.
