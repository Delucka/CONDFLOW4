-- ==========================================
-- MIGRATION 0078: Reabertura se resolve sozinha quando o gerente LIBERA a planilha
-- Hoje, reabrir um mês insere uma ocorrência (origem='reabertura', status='aberta')
-- que ficava na Fila de Conferência até alguém resolver na mão (ver 0062: "A reabertura
-- é registrada no backend e é resolvida manualmente"). Agora, ao entrar em
-- 'edicao_finalizada', a chamada daquele condomínio + AQUELE MÊS é resolvida:
--   -> some da fila (que conta só status='aberta')
--   -> continua na tabela = histórico/pesquisa
-- Trigger (e não código no endpoint) para pegar TODOS os caminhos de liberação:
-- /liberar, /liberar-todos e a liberação feita pelo master.
-- Reversível: DROP TRIGGER trg_resolver_reabertura_ao_liberar ON public.edicoes_mensais;
-- ==========================================

CREATE OR REPLACE FUNCTION public.resolver_reabertura_ao_liberar()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF lower(coalesce(NEW.status, '')) = 'edicao_finalizada'
     AND lower(coalesce(OLD.status, '')) <> 'edicao_finalizada' THEN

    UPDATE public.emissoes_ocorrencias
       SET status        = 'resolvida',
           resolvido_em  = now(),
           resolvido_por = coalesce(auth.uid(), resolvido_por),
           resposta      = coalesce(nullif(trim(resposta), ''), 'Planilha liberada pelo gerente.')
     WHERE condominio_id = NEW.condominio_id
       AND origem        = 'reabertura'
       AND status       <> 'resolvida'
       -- casa o mês pelo texto que o backend grava: "… (ref. MM/AAAA)."
       AND descricao LIKE '%(ref. ' || lpad(NEW.mes_referencia::text, 2, '0')
                          || '/' || NEW.ano_referencia::text || ')%';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_resolver_reabertura_ao_liberar ON public.edicoes_mensais;
CREATE TRIGGER trg_resolver_reabertura_ao_liberar
  AFTER UPDATE ON public.edicoes_mensais
  FOR EACH ROW
  WHEN (NEW.status IS DISTINCT FROM OLD.status)
  EXECUTE FUNCTION public.resolver_reabertura_ao_liberar();
