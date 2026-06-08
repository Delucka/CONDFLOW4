-- ==========================================
-- MIGRATION 0046: Emissor seleciona quais cobranças extras entram na emissão
--
-- Hoje o trigger lacra_ao_registrar marca TODAS as cobranças 'ativa' do mês
-- como 'processada' quando a emissão é registrada (tudo-ou-nada).
--
-- Agora o emissor escolhe quais cobranças entram (checklist na tela de anexos).
-- A escolha é gravada em emissoes_pacotes.cobrancas_incluidas (array de ids).
-- O trigger passa a respeitar essa lista; quando NULL, mantém o comportamento
-- legado (todas as ativas do mês).
-- ==========================================

ALTER TABLE public.emissoes_pacotes
  ADD COLUMN IF NOT EXISTS cobrancas_incluidas JSONB;

CREATE OR REPLACE FUNCTION lacra_ao_registrar()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status = 'registrado' AND (OLD.status IS NULL OR OLD.status IS DISTINCT FROM 'registrado') THEN
    -- Lacra o pacote
    NEW.lacrada    := true;
    NEW.lacrada_em := now();
    NEW.lacrada_por := auth.uid();

    -- Marca cobranças extras do mês como 'processada' (exceto em retificação)
    IF NEW.eh_retificacao = false THEN
      IF NEW.cobrancas_incluidas IS NOT NULL THEN
        -- Seletivo: apenas as cobranças escolhidas pelo emissor
        UPDATE public.cobrancas_extras
        SET status = 'processada'
        WHERE condominio_id = NEW.condominio_id
          AND mes = NEW.mes_referencia
          AND ano = NEW.ano_referencia
          AND status = 'ativa'
          AND id::text IN (SELECT jsonb_array_elements_text(NEW.cobrancas_incluidas));
      ELSE
        -- Legado: todas as ativas do mês (compatibilidade com pacotes antigos)
        UPDATE public.cobrancas_extras
        SET status = 'processada'
        WHERE condominio_id = NEW.condominio_id
          AND mes = NEW.mes_referencia
          AND ano = NEW.ano_referencia
          AND status = 'ativa';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_lacra_ao_registrar ON emissoes_pacotes;
CREATE TRIGGER trg_lacra_ao_registrar
  BEFORE UPDATE ON emissoes_pacotes
  FOR EACH ROW
  EXECUTE FUNCTION lacra_ao_registrar();
