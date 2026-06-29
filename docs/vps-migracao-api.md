# Migração da API (FastAPI) para a VPS Hostinger

> **Objetivo:** matar o *cold start* do Vercel (causa nº1 da navegação lenta), fazer os caches em memória passarem a valer, e habilitar OCR nativo. O **Next.js continua no Vercel** (CDN/edge); só a **API** vai pra VPS.

## Arquitetura final

```
Navegador
  ├── Next.js  → Vercel (edge/CDN, rápido)
  │     NEXT_PUBLIC_API_URL = https://api.SEUDOMINIO
  └── /api/*   → VPS Hostinger
          Nginx (TLS Let's Encrypt) → gunicorn+uvicorn (FastAPI sempre vivo)
                                          └── Supabase (service-role)
   (n8n já roda nessa mesma VPS)
```

A VPS já tem o n8n. A API vai num processo `systemd` separado, atrás do Nginx, com seu próprio subdomínio.

---

## Pré-requisito: um subdomínio para a API

Aponte um registro DNS **A** `api.SEUDOMINIO` → IP da VPS. (Se você não tem domínio próprio, dá pra usar um grátis no Cloudflare e usar **Cloudflare Tunnel** — ver o final.)

---

## Passo 1 — Código na VPS

```bash
ssh root@IP_DA_VPS
adduser condoflow            # usuário sem root pra rodar a app
mkdir -p /opt/condoflow && chown condoflow:condoflow /opt/condoflow
# copie a pasta api/ do repo para /opt/condoflow/api (git clone ou scp)
cd /opt/condoflow
python3 -m venv venv
./venv/bin/pip install -r api/requirements.txt
./venv/bin/pip install "gunicorn>=21"      # servidor de produção (não vai no Vercel)
```

## Passo 2 — Variáveis de ambiente (`/opt/condoflow/api/.env`)

```ini
SUPABASE_URL=...
SUPABASE_KEY=...                 # anon
SUPABASE_SERVICE_KEY=...         # service-role (NUNCA exponha)
SECRET_KEY=<gere com: openssl rand -hex 32>
PRODUCTION=1                     # faz o app exigir SECRET_KEY (fail-closed)
ALLOWED_ORIGINS=https://condominios-gamma.vercel.app
INTEGRACAO_API_KEY=...           # a mesma usada no n8n
NOTIF_EMAIL_SECRET=...
```

`chmod 600 api/.env` (só o dono lê).

## Passo 3 — Serviço systemd (`/etc/systemd/system/condoflow-api.service`)

```ini
[Unit]
Description=CondoFlow API (FastAPI)
After=network.target

[Service]
User=condoflow
WorkingDirectory=/opt/condoflow/api
EnvironmentFile=/opt/condoflow/api/.env
ExecStart=/opt/condoflow/venv/bin/gunicorn index:app \
  -k uvicorn.workers.UvicornWorker \
  -w 3 -b 127.0.0.1:8001 \
  --timeout 120 --access-logfile - --error-logfile -
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
```

```bash
systemctl daemon-reload
systemctl enable --now condoflow-api
systemctl status condoflow-api          # deve ficar "active (running)"
curl -s http://127.0.0.1:8001/api/health   # se houver /health; senão teste outro GET
```

## Passo 4 — Nginx (reverse proxy + TLS)

`/etc/nginx/sites-available/condoflow-api`:

```nginx
server {
    server_name api.SEUDOMINIO;
    client_max_body_size 30M;            # uploads de boleto/PDF

    location / {
        proxy_pass http://127.0.0.1:8001;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 120s;
    }
}
```

```bash
ln -s /etc/nginx/sites-available/condoflow-api /etc/nginx/sites-enabled/
nginx -t && systemctl reload nginx
apt install -y certbot python3-certbot-nginx
certbot --nginx -d api.SEUDOMINIO        # emite o TLS e força HTTPS
```

## Passo 5 — Apontar o frontend

No Vercel (projeto `condominios`) → Settings → Environment Variables:

```
NEXT_PUBLIC_API_URL = https://api.SEUDOMINIO
```

Redeploy do front (`npx vercel --prod --yes`). Pronto: o `/api/*` passa a bater na VPS, sem cold start.

---

## Segurança da VPS (checklist)

```bash
ufw allow OpenSSH
ufw allow 80,443/tcp
ufw enable                       # fecha todo o resto (a API só escuta em 127.0.0.1)
apt install -y fail2ban          # bloqueia brute-force no SSH
```

- [ ] API escuta **só em 127.0.0.1** (Nginx é a única porta pública) ✔ no systemd acima
- [ ] `SECRET_KEY` forte + `PRODUCTION=1` (boot falha sem a chave)
- [ ] `ALLOWED_ORIGINS` só o domínio do front
- [ ] `.env` com `chmod 600`, service-role key **só** aqui
- [ ] TLS via certbot (renova sozinho)
- [ ] SSH por chave (desabilitar senha): `PasswordAuthentication no`
- [ ] n8n atrás de auth (já deve estar, no template Hostinger)

---

## Alternativa sem abrir portas: Cloudflare Tunnel

Se preferir não expor 80/443 nem mexer em DNS na VPS:

```bash
cloudflared tunnel login
cloudflared tunnel create condoflow
# rota api.SEUDOMINIO → http://127.0.0.1:8001
cloudflared tunnel route dns condoflow api.SEUDOMINIO
```

TLS e DNS ficam no Cloudflare; a VPS não abre nenhuma porta de entrada. Ótimo pra segurança.

---

## Depois da migração (próximos ganhos)

1. **OCR nativo** — instalar `tesseract-ocr tesseract-ocr-por` na VPS e mover o OCR do navegador pra cá (mais rápido, ainda grátis). O `por.traineddata` já está no repo.
2. **Tarefas de fundo** — buscar boleto do Ahreas / limpeza de retenção via `cron` ou `APScheduler` no mesmo processo.
3. **Redis** (opcional) — cache compartilhado entre workers + rate-limit.
