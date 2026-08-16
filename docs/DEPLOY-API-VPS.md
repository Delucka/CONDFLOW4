# Atualizar a API na VPS

> Este é o procedimento **real**, conferido no servidor em 16/08/2026.
> O `vps-migracao-api.md` descreve o plano original (systemd + nginx) e **não é o
> que existe lá**: a API roda em Docker, atrás do Traefik que já servia o n8n.

## Como está montado

```
/opt/condoflow/
  docker-compose.yml     ← serviço `condoapi`, container `condoflow-api`
  api/                   ← o código, copiado do repositório
    .env                 ← credenciais, SÓ na VPS (nunca vem do repo)
    Dockerfile
    *.py
```

O compose constrói a imagem `condoflow-condoapi` a partir de `./api`, entra na
rede `n8n_default` e publica em `api.emissaonline.com` por labels do Traefik
(TLS automático, porta interna 8001, gunicorn com 4 workers).

**Nenhum volume é montado.** O código fica *dentro* da imagem — editar arquivo em
`/opt/condoflow/api` não muda nada até a imagem ser reconstruída. É a pegadinha
principal deste deploy.

## O que NÃO é automático

`git push` não atualiza a VPS. `npx vercel --prod` também não — a Vercel só
publica o Next.js. Se você mexeu em `api/` e não fez o que está abaixo, a
mudança **não está no ar**.

Foi assim que a API ficou 6 semanas atrasada sem ninguém notar: o site funcionava,
e só oito rotas mais novas respondiam 404.

## Atualizar

Da raiz do repositório:

```bash
tar czf /tmp/api.tgz -C api api_routes.py index.py deps.py emails.py rotas_segundas_vias.py auth_constants.py pdf_extractor.py requirements.txt Dockerfile
```

```bash
ssh -i ~/.ssh/condoflow_vps root@76.13.174.12 "cp -a /opt/condoflow/api /opt/condoflow/api_backup_$(date +%Y%m%d_%H%M)"
```

```bash
ssh -i ~/.ssh/condoflow_vps root@76.13.174.12 "tar xzf - -C /opt/condoflow/api" < /tmp/api.tgz
```

```bash
ssh -i ~/.ssh/condoflow_vps root@76.13.174.12 "cd /opt/condoflow && docker compose up -d --build"
```

A lista de arquivos é explícita de propósito: mandar a pasta inteira sobrescreve
o `.env` do servidor, que tem as credenciais e não existe no repositório.

## Conferir (não pule)

```bash
curl -s -o /dev/null -w "%{http_code}\n" https://api.emissaonline.com/api/health
```

Deve dar **200**. E o teste que pega o erro de verdade — comparar as rotas do
código com as que estão no ar:

```bash
python -c "import json,urllib.request,sys,os; sys.path.insert(0,'api'); import index; vps=set(json.loads(urllib.request.urlopen('https://api.emissaonline.com/openapi.json').read().decode('utf-8'))['paths']); local={r.path for r in index.app.routes if hasattr(r,'path') and r.path.startswith('/api')}; print('no ar:',len(vps)); print('faltando:',sorted(local-vps) or 'nenhuma')"
```

`faltando: nenhuma` é o resultado esperado. Qualquer rota listada ali é uma tela
tomando 404 em produção.

## Se der errado

```bash
ssh -i ~/.ssh/condoflow_vps root@76.13.174.12 "docker logs --tail 50 condoflow-api"
```

Voltar ao estado anterior (troque pela pasta de backup que você criou):

```bash
ssh -i ~/.ssh/condoflow_vps root@76.13.174.12 "cd /opt/condoflow && rm -rf api && mv api_backup_AAAAMMDD_HHMM api && docker compose up -d --build"
```

## Antes de mexer no Python

Não existe build que pegue nome perdido numa refatoração — em Python isso só
aparece quando alguém chama a rota. Rode antes de subir:

```bash
python -m pyflakes api/*.py
```

Foi o que pegou `SB_SERVICE` e `_user_cache` ao separar o `api_routes.py`.

## Acesso

Chave `~/.ssh/condoflow_vps` (pública cadastrada no painel da Hostinger, VPS
`srv1788797`). O Traefik é dono das portas 80/443 — **não instale nginx**.

**O SSH é só por chave** desde 16/08/2026 (`PasswordAuthentication no`,
`PermitRootLogin prohibit-password`). Antes disso o servidor aceitava login de
root por senha pela internet.

Duas coisas a saber:

* Se a chave se perder, a entrada é o **Web console do painel da Hostinger**,
  que não passa pelo `sshd`. É a saída de emergência.
* A senha ficou desligada em `/etc/ssh/sshd_config.d/50-cloud-init.conf`, e não
  num arquivo `99-`: dentro de `sshd_config.d` **vale o primeiro valor lido**, e
  o `50-` vem antes. Um `99-hardening.conf` pareceria certo e não teria efeito
  nenhum. Também existe `/etc/cloud/cloud.cfg.d/99-desliga-senha-ssh.cfg` com
  `ssh_pwauth: false` — sem ele o cloud-init reescreve o `50-` no próximo boot e
  a senha volta sozinha.

Sempre valide antes de recarregar, senão um erro de digitação tranca o acesso:

```bash
ssh -i ~/.ssh/condoflow_vps root@76.13.174.12 "sshd -t && systemctl reload ssh"
```
