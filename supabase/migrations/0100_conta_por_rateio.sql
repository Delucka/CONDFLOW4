-- ============================================================
-- 0100 — Cada conta vai para a SUA verba
-- ============================================================
-- O PROBLEMA
--
-- Um condomínio pode ter duas contas do mesmo serviço em instalações
-- diferentes: o gás do prédio e o gás da piscina, cada um com o seu medidor,
-- a sua fatura e a SUA verba no rateio.
--
-- O sistema resolvia a verba pelo NOME e devolvia um valor por serviço:
--
--     'GAS' in nome  ->  serviço 'gas'  ->  um único total
--
-- Com isso, "CONSUMO DE GÁS" e "GÁS PISCINA" recebiam o mesmo número — a soma
-- das duas contas em cada uma das duas verbas. O condomínio 0302 (Reference by
-- Helbor) mostrou o caso: R$ 9.909,45 do bloco e R$ 1.387,42 da piscina.
--
-- A SOLUÇÃO
--
-- Guardar, no próprio anexo, a que verba aquela conta pertence.
--
--   instalacao  identificador da instalação, como vem impresso na fatura
--   rateio_id   a verba que recebe o valor desta conta
--
-- `instalacao` existe para não perguntar duas vezes: no mês seguinte, a fatura
-- da mesma instalação herda a verba que já foi escolhida uma vez.
--
-- Condomínio com UMA verba por serviço — a esmagadora maioria — não muda em
-- nada: sem escolha a fazer, o valor continua indo para a única verba possível.
--
-- ⚠️ ROLLBACK:
--   ALTER TABLE public.emissoes_arquivos DROP COLUMN IF EXISTS rateio_id;
--   ALTER TABLE public.emissoes_arquivos DROP COLUMN IF EXISTS instalacao;
-- ============================================================

ALTER TABLE public.emissoes_arquivos
  ADD COLUMN IF NOT EXISTS instalacao TEXT,
  ADD COLUMN IF NOT EXISTS rateio_id  UUID REFERENCES public.rateios_config(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.emissoes_arquivos.instalacao IS
  'Identificador da instalação na concessionária (ex.: 34604537). Serve para a fatura do mês seguinte herdar a verba já escolhida.';

COMMENT ON COLUMN public.emissoes_arquivos.rateio_id IS
  'Verba de rateios_config que recebe o valor desta conta. NULL = decidir na tela, ou condomínio com uma verba só para o serviço.';

-- Buscar "a fatura do mês passado desta instalação" é o caminho quente da
-- sugestão automática.
CREATE INDEX IF NOT EXISTS idx_emissoes_arquivos_instalacao
  ON public.emissoes_arquivos (condominio_id, instalacao)
  WHERE instalacao IS NOT NULL;

-- ── Conferência ──
--   SELECT column_name FROM information_schema.columns
--    WHERE table_schema='public' AND table_name='emissoes_arquivos'
--      AND column_name IN ('instalacao','rateio_id');     -- 2 linhas
