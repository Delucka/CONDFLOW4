-- ============================================================
-- 0099 — Cobrança das contas de concessionária
-- ============================================================
-- O PROBLEMA
--
-- A emissão trava esperando a conta de água/gás/energia chegar, e hoje a
-- cobrança é alguém lembrar de perguntar. Quem cobra esquece, quem deve mandar
-- não é lembrado, e a emissão atrasa sem ninguém ter errado de propósito.
--
-- A PEÇA QUE FALTAVA JÁ ESTAVA NA FATURA
--
-- Toda fatura traz a data da PRÓXIMA leitura — quando a concessionária lê o
-- medidor de novo, ou seja, quando a conta do mês seguinte se forma. Com essa
-- data dá para saber, com um mês de antecedência, quando cobrar cada conta.
--
-- COMO FUNCIONA
--
--   1. Fatura anexada com próxima leitura  ->  abre a pendência do mês seguinte
--   2. Chegou o dia da leitura             ->  começa a cobrar por e-mail
--   3. A fatura do mês é anexada           ->  a pendência fecha sozinha
--   4. Justificativa plausível             ->  suspensa, e o e-mail para
--   5. Justificativa ruim                  ->  master/emissão manda voltar a cobrar
--
-- O passo 3 é o que faz isto valer: ninguém precisa marcar "recebido". A linha
-- em `consumos_faturas` já nasce quando a fatura é anexada (0037/0041), e é ela
-- que fecha a pendência. Cobrança que continua depois da conta chegar seria pior
-- do que não cobrar.
--
-- QUEM É COBRADO
--
-- O gerente da carteira e o assistente vinculado a ele (0057) — decisão da
-- operação, não do código.
--
-- ⚠️ ROLLBACK:
--   DROP TRIGGER IF EXISTS trg_abre_cobranca_conta ON public.consumos_faturas;
--   DROP TRIGGER IF EXISTS trg_fecha_cobranca_conta ON public.consumos_faturas;
--   DROP FUNCTION IF EXISTS public.abre_cobranca_conta();
--   DROP FUNCTION IF EXISTS public.fecha_cobranca_conta();
--   DROP TABLE IF EXISTS public.cobrancas_contas;
-- ============================================================

CREATE TABLE IF NOT EXISTS public.cobrancas_contas (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  condominio_id   UUID NOT NULL REFERENCES public.condominios(id) ON DELETE CASCADE,
  concessionaria  TEXT NOT NULL,                    -- SABESP / COMGAS / ENEL
  mes_referencia  INTEGER NOT NULL,
  ano_referencia  INTEGER NOT NULL,

  -- O dia da leitura informado pela fatura anterior. É quando a cobrança começa.
  previsto_em     DATE,

  -- aguardando: no prazo ou cobrando
  -- recebida   : a fatura chegou (fechada sozinha)
  -- suspensa   : justificada, e-mail parado até alguém reativar
  status          TEXT NOT NULL DEFAULT 'aguardando'
                  CHECK (status IN ('aguardando', 'recebida', 'suspensa')),

  cobrancas          INTEGER NOT NULL DEFAULT 0,
  ultima_cobranca_em TIMESTAMPTZ,

  -- Suspensão (quem está sendo cobrado explica e para o e-mail)
  suspensa_motivo    TEXT,
  suspensa_por       UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  suspensa_por_nome  TEXT,
  suspensa_em        TIMESTAMPTZ,

  -- Reativação (master/emissão não aceitou a justificativa)
  reativada_motivo   TEXT,
  reativada_por      UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  reativada_por_nome TEXT,
  reativada_em       TIMESTAMPTZ,

  recebida_em     TIMESTAMPTZ,
  criado_em       TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Uma pendência por conta, por mês. O ON CONFLICT dos gatilhos depende disto.
  UNIQUE (condominio_id, concessionaria, mes_referencia, ano_referencia)
);

-- O executor varre por "quem está aguardando e já passou da data" — este índice
-- é o que impede a varredura completa quando a tabela crescer.
CREATE INDEX IF NOT EXISTS idx_cobrancas_contas_fila
  ON public.cobrancas_contas (status, previsto_em)
  WHERE status = 'aguardando';

CREATE INDEX IF NOT EXISTS idx_cobrancas_contas_condo
  ON public.cobrancas_contas (condominio_id, ano_referencia, mes_referencia);

-- ══════════════ 1) A fatura de hoje abre a pendência do mês que vem ══════════
CREATE OR REPLACE FUNCTION public.abre_cobranca_conta()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  prox_mes INTEGER;
  prox_ano INTEGER;
BEGIN
  -- Sem a data da próxima leitura não há o que agendar.
  IF NEW.proxima_leitura IS NULL THEN
    RETURN NEW;
  END IF;

  prox_mes := NEW.mes_referencia + 1;
  prox_ano := NEW.ano_referencia;
  IF prox_mes > 12 THEN
    prox_mes := 1;
    prox_ano := prox_ano + 1;
  END IF;

  INSERT INTO public.cobrancas_contas
    (condominio_id, concessionaria, mes_referencia, ano_referencia, previsto_em)
  VALUES
    (NEW.condominio_id, upper(btrim(NEW.concessionaria)), prox_mes, prox_ano, NEW.proxima_leitura)
  ON CONFLICT (condominio_id, concessionaria, mes_referencia, ano_referencia)
  DO UPDATE SET
    -- A data pode ser corrigida à mão depois; a mais recente vale. Mas não
    -- ressuscita pendência já fechada ou suspensa — só atualiza a data.
    previsto_em = EXCLUDED.previsto_em;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_abre_cobranca_conta ON public.consumos_faturas;
CREATE TRIGGER trg_abre_cobranca_conta
  AFTER INSERT OR UPDATE OF proxima_leitura ON public.consumos_faturas
  FOR EACH ROW EXECUTE FUNCTION public.abre_cobranca_conta();

-- ══════════════ 2) A fatura chegou: a pendência fecha sozinha ════════════════
CREATE OR REPLACE FUNCTION public.fecha_cobranca_conta()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.cobrancas_contas
     SET status = 'recebida',
         recebida_em = now()
   WHERE condominio_id  = NEW.condominio_id
     AND concessionaria = upper(btrim(NEW.concessionaria))
     AND mes_referencia = NEW.mes_referencia
     AND ano_referencia = NEW.ano_referencia
     AND status <> 'recebida';
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_fecha_cobranca_conta ON public.consumos_faturas;
CREATE TRIGGER trg_fecha_cobranca_conta
  AFTER INSERT OR UPDATE ON public.consumos_faturas
  FOR EACH ROW EXECUTE FUNCTION public.fecha_cobranca_conta();

-- ══════════════ RLS ══════════════
-- Leitura: quem está logado vê (a tela já recorta por carteira, e o dado é
-- "falta a conta de água do 0059" — nada sensível).
-- Escrita: NEGADA pelo navegador. Suspender e reativar passam pelo backend, que
-- confere papel e carteira e grava quem foi e por quê. Sem policy de escrita, a
-- chave anon não altera nada — é essa a intenção, não esquecimento.
ALTER TABLE public.cobrancas_contas ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "cobrancas_contas_leitura" ON public.cobrancas_contas;
CREATE POLICY "cobrancas_contas_leitura" ON public.cobrancas_contas
  FOR SELECT TO authenticated
  USING (true);

-- ══════════════ Semeadura do que já dá para agendar ══════════════
-- Roda o gatilho de abertura sobre as faturas que JÁ têm próxima leitura, para
-- a fila não nascer vazia. Hoje isso é pouca coisa (o OCR do navegador não
-- extraía a data até 16/08/2026), mas o que existir entra.
INSERT INTO public.cobrancas_contas
  (condominio_id, concessionaria, mes_referencia, ano_referencia, previsto_em)
SELECT f.condominio_id,
       upper(btrim(f.concessionaria)),
       CASE WHEN f.mes_referencia = 12 THEN 1 ELSE f.mes_referencia + 1 END,
       CASE WHEN f.mes_referencia = 12 THEN f.ano_referencia + 1 ELSE f.ano_referencia END,
       f.proxima_leitura
  FROM public.consumos_faturas f
 WHERE f.proxima_leitura IS NOT NULL
ON CONFLICT (condominio_id, concessionaria, mes_referencia, ano_referencia) DO NOTHING;

-- Fecha na mesma hora as que já foram recebidas (a fatura do mês seguinte já
-- está anexada) — senão a fila nasceria cobrando conta que já chegou.
UPDATE public.cobrancas_contas c
   SET status = 'recebida', recebida_em = now()
  FROM public.consumos_faturas f
 WHERE f.condominio_id  = c.condominio_id
   AND upper(btrim(f.concessionaria)) = c.concessionaria
   AND f.mes_referencia = c.mes_referencia
   AND f.ano_referencia = c.ano_referencia
   AND c.status = 'aguardando';

-- ── Conferência ──
--   SELECT status, count(*) FROM public.cobrancas_contas GROUP BY status;
--   SELECT c.name, k.concessionaria, k.mes_referencia, k.previsto_em, k.status
--     FROM public.cobrancas_contas k
--     JOIN public.condominios c ON c.id = k.condominio_id
--    ORDER BY k.previsto_em LIMIT 20;
