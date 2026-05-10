-- ==========================================
-- MIGRAÇÃO: Sistema de Lacre de Emissões
-- Execute no SQL Editor do Supabase
-- Etapa 2 — Campos + Triggers
-- ==========================================

-- ══════════════════════════════════════════
-- 2.1  Adicionar campos de lacre e retificação
-- ══════════════════════════════════════════
ALTER TABLE emissoes_pacotes
  ADD COLUMN IF NOT EXISTS lacrada          BOOLEAN     DEFAULT false,
  ADD COLUMN IF NOT EXISTS lacrada_em       TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS lacrada_por      UUID        REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS data_vencimento  DATE,
  ADD COLUMN IF NOT EXISTS pacote_original_id UUID      REFERENCES emissoes_pacotes(id),
  ADD COLUMN IF NOT EXISTS eh_retificacao   BOOLEAN     DEFAULT false,
  ADD COLUMN IF NOT EXISTS motivo_retificacao TEXT;

-- ══════════════════════════════════════════
-- 2.2  Backfill — marcar pacotes já registrados como lacrados
-- ══════════════════════════════════════════
UPDATE emissoes_pacotes
SET lacrada    = true,
    lacrada_em = COALESCE(atualizado_em, now())
WHERE status = 'registrado'
  AND (lacrada IS NULL OR lacrada = false);

-- ══════════════════════════════════════════
-- 2.3  Trigger: lacrar automaticamente ao registrar
--      (quando o botão REGISTRAR muda o status para 'registrado')
-- ══════════════════════════════════════════
CREATE OR REPLACE FUNCTION lacra_ao_registrar()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status = 'registrado' AND OLD.status IS DISTINCT FROM 'registrado' THEN
    NEW.lacrada    := true;
    NEW.lacrada_em := now();
    NEW.lacrada_por := auth.uid();
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_lacra_ao_registrar ON emissoes_pacotes;
CREATE TRIGGER trg_lacra_ao_registrar
  BEFORE UPDATE ON emissoes_pacotes
  FOR EACH ROW
  EXECUTE FUNCTION lacra_ao_registrar();

-- ══════════════════════════════════════════
-- 2.4  Trigger: proteger pacote lacrado contra edição
-- ══════════════════════════════════════════
CREATE OR REPLACE FUNCTION protege_pacote_lacrado()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.lacrada = true AND NEW.lacrada = true THEN
    IF NEW.condominio_id    IS DISTINCT FROM OLD.condominio_id    OR
       NEW.mes_referencia   IS DISTINCT FROM OLD.mes_referencia   OR
       NEW.ano_referencia   IS DISTINCT FROM OLD.ano_referencia   OR
       NEW.data_vencimento  IS DISTINCT FROM OLD.data_vencimento  THEN
      RAISE EXCEPTION 'Pacote lacrado não pode ser modificado. Solicite uma retificação.';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_protege_pacote_lacrado ON emissoes_pacotes;
CREATE TRIGGER trg_protege_pacote_lacrado
  BEFORE UPDATE ON emissoes_pacotes
  FOR EACH ROW
  EXECUTE FUNCTION protege_pacote_lacrado();

-- ══════════════════════════════════════════
-- 2.5  Trigger: proteger arquivos de pacotes lacrados
-- ══════════════════════════════════════════
CREATE OR REPLACE FUNCTION protege_arquivos_lacrados()
RETURNS TRIGGER AS $$
DECLARE
  pacote_lacrado BOOLEAN;
BEGIN
  SELECT lacrada INTO pacote_lacrado
  FROM emissoes_pacotes
  WHERE id = COALESCE(NEW.pacote_id, OLD.pacote_id);

  IF pacote_lacrado = true THEN
    RAISE EXCEPTION 'Não é possível modificar arquivos de pacote lacrado.';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_protege_arquivos ON emissoes_arquivos;
CREATE TRIGGER trg_protege_arquivos
  BEFORE INSERT OR UPDATE OR DELETE ON emissoes_arquivos
  FOR EACH ROW
  EXECUTE FUNCTION protege_arquivos_lacrados();

-- ══════════════════════════════════════════
-- 2.6  Atualizar constraint de unicidade
--      Remove a UNIQUE antiga (que bloqueia retificações)
--      Cria index parcial que permite retificações mas bloqueia duplicatas
-- ══════════════════════════════════════════

-- Descobrir e dropar a constraint existente
DO $$
DECLARE
  constraint_name TEXT;
BEGIN
  SELECT tc.constraint_name INTO constraint_name
  FROM information_schema.table_constraints tc
  WHERE tc.table_name = 'emissoes_pacotes'
    AND tc.constraint_type = 'UNIQUE'
    AND tc.constraint_name LIKE '%condominio_id%mes_referencia%';

  IF constraint_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE emissoes_pacotes DROP CONSTRAINT %I', constraint_name);
    RAISE NOTICE 'Constraint % removida.', constraint_name;
  ELSE
    -- Tentar pelo nome padrão gerado pelo Postgres
    BEGIN
      ALTER TABLE emissoes_pacotes
        DROP CONSTRAINT IF EXISTS emissoes_pacotes_condominio_id_mes_referencia_ano_referencia_key;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'Nenhuma constraint UNIQUE encontrada para remover.';
    END;
  END IF;
END $$;

-- Nova constraint parcial: bloqueia duplicatas exceto retificações e rascunhos
CREATE UNIQUE INDEX IF NOT EXISTS idx_emissao_unica_por_competencia
  ON emissoes_pacotes (condominio_id, mes_referencia, ano_referencia)
  WHERE eh_retificacao = false AND status != 'rascunho';

-- ══════════════════════════════════════════
-- Verificação final
-- ══════════════════════════════════════════
-- Rode após executar para confirmar:
-- SELECT COUNT(*) AS lacrados FROM emissoes_pacotes WHERE lacrada = true;
