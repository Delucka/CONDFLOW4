-- ============================================================
-- 0101 — Cancelar emissão sem apagar o que aconteceu
-- ============================================================
-- HOJE
--
-- "Excluir emissão" apaga tudo: os arquivos do bucket, a trilha de aprovação e
-- o pacote. Some do sistema como se nunca tivesse existido.
--
-- Isso é ruim justamente quando mais importa: a emissão foi cancelada PORQUE
-- teve um erro, e o erro é o que se quer poder olhar depois. Sem o registro,
-- ninguém sabe o que foi emitido errado, nem por quê, nem quem decidiu refazer.
--
-- COMO PASSA A SER
--
-- Cancelar vira um ESTADO, não uma exclusão:
--
--   * o pacote continua lá, com os arquivos e a trilha, marcado como cancelada
--   * o motivo é obrigatório e fica gravado com autor e data
--   * uma nova emissão nasce no lugar, ligada à antiga por `substituida_por`
--
-- Quem procurar aquele mês encontra as duas e entende a história.
--
-- O GATILHO PRECISOU MUDAR JUNTO
--
-- `checa_conjunto_emissao()` (0087) impede registrar uma emissão enquanto as
-- outras do mesmo condomínio/mês não estiverem prontas. Ele conta como
-- "faltando" todo pacote fora de aprovado/registrado/expedida — e uma emissão
-- CANCELADA cairia nessa conta, travando para sempre o registro da que veio
-- substituí-la. Cancelada não falta: ela foi descartada de propósito.
--
-- ⚠️ ROLLBACK:
--   ALTER TABLE public.emissoes_pacotes
--     DROP COLUMN IF EXISTS cancelamento_motivo, DROP COLUMN IF EXISTS cancelada_em,
--     DROP COLUMN IF EXISTS cancelada_por, DROP COLUMN IF EXISTS cancelada_por_nome,
--     DROP COLUMN IF EXISTS substituida_por;
--   (e restaurar a função da 0087)
-- ============================================================

ALTER TABLE public.emissoes_pacotes
  ADD COLUMN IF NOT EXISTS cancelamento_motivo TEXT,
  ADD COLUMN IF NOT EXISTS cancelada_em        TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS cancelada_por       UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS cancelada_por_nome  TEXT,
  -- A emissão nova que nasceu no lugar desta. Ler as duas pontas conta a
  -- história inteira sem ninguém precisar lembrar.
  ADD COLUMN IF NOT EXISTS substituida_por     UUID REFERENCES public.emissoes_pacotes(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.emissoes_pacotes.cancelamento_motivo IS
  'Por que a emissão foi cancelada. Obrigatório no cancelamento — é o que explica o erro depois.';

CREATE INDEX IF NOT EXISTS idx_pacotes_canceladas
  ON public.emissoes_pacotes (condominio_id, ano_referencia, mes_referencia)
  WHERE status = 'cancelada';

-- ── O gatilho do conjunto passa a ignorar as canceladas ──
CREATE OR REPLACE FUNCTION public.checa_conjunto_emissao()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  faltam INTEGER;
BEGIN
  IF NEW.status <> 'registrado' OR OLD.status = 'registrado' THEN
    RETURN NEW;
  END IF;

  SELECT count(*) INTO faltam
    FROM public.emissoes_pacotes p
   WHERE p.condominio_id  = NEW.condominio_id
     AND p.mes_referencia = NEW.mes_referencia
     AND p.ano_referencia = NEW.ano_referencia
     AND p.id <> NEW.id
     -- 'cancelada' entra aqui na 0101: emissão descartada de propósito não é
     -- pendência. Sem isto, cancelar uma trava o registro da que a substituiu.
     AND p.status NOT IN ('aprovado', 'registrado', 'expedida', 'cancelada');

  IF faltam > 0 THEN
    RAISE EXCEPTION
      'Faltam % emissão(ões) deste condomínio em %/% para aprovar antes de registrar.',
      faltam, NEW.mes_referencia, NEW.ano_referencia;
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_conjunto_emissao ON public.emissoes_pacotes;
CREATE TRIGGER trg_conjunto_emissao
  BEFORE UPDATE ON public.emissoes_pacotes
  FOR EACH ROW EXECUTE FUNCTION public.checa_conjunto_emissao();

-- ── Conferência ──
--   SELECT column_name FROM information_schema.columns
--    WHERE table_schema='public' AND table_name='emissoes_pacotes'
--      AND column_name LIKE 'cancel%' OR column_name='substituida_por';   -- 5 linhas
--
--   SELECT prosrc LIKE '%cancelada%' AS gatilho_atualizado
--     FROM pg_proc WHERE proname = 'checa_conjunto_emissao';              -- true
