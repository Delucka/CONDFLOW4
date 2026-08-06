-- ============================================================
-- 0088 — Desde quando espera, e quantas vezes já foi cobrado
-- ============================================================
-- A etapa de preparação dizia O QUE falta ("aguardando fatura") e nada sobre
-- HÁ QUANTO TEMPO nem sobre o que já foi feito a respeito. Na prática é a
-- pergunta que importa: uma fatura atrasada há 2 dias e uma atrasada há 20 são
-- situações diferentes, e "já cobrei três vezes" é o que justifica escalar.
--
-- Sem isso, a informação vivia na cabeça de quem cobrou — e sumia junto com ele.
--
-- ── O QUE ESTA MIGRATION FAZ ──
--   1. `aguardando_desde` — quando a espera ATUAL começou. Muda quando a etapa
--      muda; não é o `criado_em` da linha, que ficaria parado no primeiro mês.
--   2. `cobrancas` — o histórico de cada vez que se foi atrás. Array JSONB de
--      { em, por_nome, canal, obs }. Tabela à parte seria mais ortodoxo, mas a
--      linha já é única por condomínio+mês e o volume é de unidades por mês —
--      um join a mais não paga o próprio custo.
--
-- ── BACKFILL ──
--   `aguardando_desde` das linhas existentes recebe `atualizado_em` (ou
--   `criado_em`). É a melhor aproximação disponível: dirá "espera desde a última
--   vez que alguém tocou", que é falso para trás mas honesto daqui pra frente —
--   e melhor que NULL, que a tela teria de mostrar como "sei lá".
--
-- ⚠️ A etapa 'pronto_para_emitir' CONTINUA aceita pelo CHECK. Ela sai da tela
--    (a emissão criada passa a ser o sinal de "pronto"), mas linhas antigas têm
--    esse valor gravado e derrubar o CHECK quebraria a leitura delas. Fica
--    inerte: nada mais a produz, nada mais depende dela.
--
-- ⚠️ ROLLBACK:
--   ALTER TABLE public.emissoes_preparacao DROP COLUMN IF EXISTS aguardando_desde;
--   ALTER TABLE public.emissoes_preparacao DROP COLUMN IF EXISTS cobrancas;
-- ============================================================

ALTER TABLE public.emissoes_preparacao
  ADD COLUMN IF NOT EXISTS aguardando_desde timestamptz,
  ADD COLUMN IF NOT EXISTS cobrancas        jsonb NOT NULL DEFAULT '[]'::jsonb;

UPDATE public.emissoes_preparacao
   SET aguardando_desde = COALESCE(atualizado_em, criado_em, now())
 WHERE aguardando_desde IS NULL;

-- ── Conferência ──
-- As duas colunas existem (2 linhas):
--   SELECT column_name, data_type FROM information_schema.columns
--    WHERE table_schema='public' AND table_name='emissoes_preparacao'
--      AND column_name IN ('aguardando_desde','cobrancas');
--
-- Nenhuma linha ficou sem data de espera (deve dar 0):
--   SELECT count(*) FROM public.emissoes_preparacao WHERE aguardando_desde IS NULL;
