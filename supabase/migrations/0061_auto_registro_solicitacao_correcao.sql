-- ==========================================
-- MIGRATION 0061: "Alterações" vira auditoria viva
-- Quando um pacote de emissão passa para 'solicitar_correcao', cria automaticamente
-- um registro em emissoes_ocorrencias (tipo='solicitacao') com o motivo (comentário
-- da correção), o autor (quem pediu) e a referência — sem ninguém preencher à mão.
-- O "+ NOVA" continua funcionando para registros avulsos.
-- ==========================================

CREATE OR REPLACE FUNCTION public.registrar_solicitacao_correcao()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_uid  uuid := auth.uid();          -- quem disparou a correção (via JWT do frontend)
  v_role text;
BEGIN
  -- só quando ENTRA em 'solicitar_correcao' (não a cada update)
  IF lower(coalesce(NEW.status, '')) = 'solicitar_correcao'
     AND lower(coalesce(OLD.status, '')) <> 'solicitar_correcao'
     AND v_uid IS NOT NULL THEN

    SELECT role INTO v_role FROM public.profiles WHERE id = v_uid;

    INSERT INTO public.emissoes_ocorrencias
      (pacote_id, condominio_id, tipo, status, descricao, criado_por, criado_por_role)
    VALUES (
      NEW.id,
      NEW.condominio_id,
      'solicitacao',
      'aberta',
      coalesce(nullif(trim(NEW.comentario_correcao), ''), 'Correção/alteração solicitada na emissão.')
        || ' (ref. ' || lpad(coalesce(NEW.mes_referencia, 0)::text, 2, '0')
        || '/' || coalesce(NEW.ano_referencia, 0)::text || ')',
      v_uid,
      coalesce(v_role, 'desconhecido')
    );
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
