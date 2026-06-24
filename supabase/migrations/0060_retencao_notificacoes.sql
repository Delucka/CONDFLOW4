-- ==========================================
-- MIGRATION 0060: Retenção de notificações (evita a tabela crescer sem limite)
-- Apaga notificações já lidas com +90 dias e qualquer uma com +180 dias.
-- Agenda limpeza diária via pg_cron (se disponível); senão, cria só a função
-- para rodar manualmente (a migration NÃO quebra se pg_cron não existir).
-- ==========================================

CREATE OR REPLACE FUNCTION public.limpar_notificacoes_antigas()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_total integer;
BEGIN
  WITH del AS (
    DELETE FROM public.notificacoes
    WHERE (lida = true  AND created_at < now() - interval '90 days')
       OR (lida = false AND created_at < now() - interval '180 days')
    RETURNING 1
  )
  SELECT count(*) INTO v_total FROM del;
  RETURN v_total;
END;
$$;

-- Agendamento diário às 04:00 UTC (≈01:00 BRT). Tudo protegido: se pg_cron não
-- estiver disponível/permitido, apenas registra um aviso e segue.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'pg_cron') THEN
    EXECUTE 'CREATE EXTENSION IF NOT EXISTS pg_cron';
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'limpar-notificacoes') THEN
      PERFORM cron.unschedule('limpar-notificacoes');
    END IF;
    PERFORM cron.schedule('limpar-notificacoes', '0 4 * * *',
                          'SELECT public.limpar_notificacoes_antigas();');
    RAISE NOTICE 'pg_cron: limpeza diaria de notificacoes agendada (04:00 UTC).';
  ELSE
    RAISE NOTICE 'pg_cron indisponivel — funcao criada; rode manualmente ou habilite a extensao.';
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Nao agendou via pg_cron (%). Funcao criada; rode manualmente.', SQLERRM;
END $$;

-- Faxina imediata da bagagem acumulada (opcional, mas recomendado):
SELECT public.limpar_notificacoes_antigas();
