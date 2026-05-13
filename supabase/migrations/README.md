# Supabase Migrations

Pasta de migrations SQL aplicadas no Supabase (PostgreSQL).

## Convenção

```
NNNN_descricao_curta.sql
```

- `NNNN` — número sequencial de 4 dígitos (`0001`, `0002`, …)
- `descricao_curta` — snake_case descrevendo o que a migration faz

Migrations devem ser **idempotentes** sempre que possível (usar `CREATE TABLE IF NOT EXISTS`, `ALTER ... ADD COLUMN IF NOT EXISTS`, `DROP POLICY IF EXISTS` antes de `CREATE POLICY`, etc.).

## Como aplicar

Como o projeto ainda não usa Supabase CLI, **aplique manualmente** no SQL Editor do Supabase Dashboard, em ordem numérica. Marque cada migration aplicada no `applied.txt`.

## Estado atual

Veja `applied.txt` para conferir quais migrations já estão no banco de produção.
Migrations `0001`–`0018` foram aplicadas durante o desenvolvimento inicial e estão consideradas no estado base.

## Adicionando uma nova migration

1. Pegue o próximo número disponível.
2. Crie `NNNN_descricao.sql` aqui.
3. Aplique no Supabase Dashboard.
4. Adicione a linha em `applied.txt`.
5. Commit.
