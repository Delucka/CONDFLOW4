-- ==========================================
-- MIGRATION 0062: Fila de Conferência — auto-resolver correções + auditar reaberturas
-- Substitui/completa a 0061 (pode rodar direto, mesmo sem ter rodado a 0061).
--   1) pacote_id vira OPCIONAL (eventos de condomínio, ex.: reabertura, podem não ter pacote)
--   2) coluna `origem` (correcao | reabertura | manual) distingue p/ auto-resolução e auditoria
--   3) trigger: ENTRA em solicitar_correcao -> abre "Alteração" (origem=correcao);
--      SAI de solicitar_correcao (emissor reenviou) -> resolve as correções abertas do pacote.
-- A reabertura é registrada no backend (origem=reabertura) e é resolvida manualmente.
-- ==========================================

ALTER TABLE public.emissoes_ocorrencias ALTER COLUMN pacote_id DROP NOT NULL;
ALTER TABLE public.emissoes_ocorrencias ADD COLUMN IF NOT EXISTS origem TEXT;

CREATE OR REPLACE FUNCTION public.registrar_solicitacao_correcao()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_uid  uuid := auth.uid();
  v_role text;
BEGIN
  -- ENTRA em 'solicitar_correcao' -> abre uma "Alteração"
  IF lower(coalesce(NEW.status, '')) = 'solicitar_correcao'
     AND lower(coalesce(OLD.status, '')) <> 'solicitar_correcao'
     AND v_uid IS NOT NULL THEN
    SELECT role INTO v_role FROM public.profiles WHERE id = v_uid;
    INSERT INTO public.emissoes_ocorrencias
      (pacote_id, condominio_id, tipo, status, descricao, origem, criado_por, criado_por_role)
    VALUES (
      NEW.id,
      NEW.condominio_id,
      'solicitacao',
      'aberta',
      coalesce(nullif(trim(NEW.comentario_correcao), ''), 'Correção/alteração solicitada na emissão.')
        || ' (ref. ' || lpad(coalesce(NEW.mes_referencia, 0)::text, 2, '0')
        || '/' || coalesce(NEW.ano_referencia, 0)::text || ')',
      'correcao',
      v_uid,
      coalesce(v_role, 'desconhecido')
    );
  END IF;

  -- SAI de 'solicitar_correcao' (emissor respondeu e reenviou) -> resolve as correções abertas do pacote
  IF lower(coalesce(OLD.status, '')) = 'solicitar_correcao'
     AND lower(coalesce(NEW.status, '')) <> 'solicitar_correcao' THEN
    UPDATE public.emissoes_ocorrencias
       SET status = 'resolvida',
           resolvido_em = now(),
           resolvido_por = v_uid,
           resposta = coalesce(nullif(trim(resposta), ''),
                               'Correção reenviada — pacote seguiu para ' || NEW.status || '.')
     WHERE pacote_id = NEW.id
       AND origem = 'correcao'
       AND status <> 'resolvida';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_registrar_solicitacao_correcao ON public.emissoes_pacotes;
CREATE TRIGGER trg_registrar_solicitacao_correcao
  AFTER UPDATE ON public.emissoes_pacotes
  FOR EACH ROW
  WHEN (NEW.status IS DISTINCT FROM OLD.status)
  EXECUTE FUNCTION public.registrar_solicitacao_correcao();
