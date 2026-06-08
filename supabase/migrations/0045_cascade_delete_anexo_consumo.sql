-- ==========================================
-- MIGRATION 0045: Excluir anexo na Central limpa o /consumos (sync de exclusão)
--
-- Problema: sync_concessionaria/relatorio_to_consumos só rodava em INSERT/UPDATE.
-- Ao apagar o anexo em emissoes_arquivos, a fatura/relatório sincronizado ficava
-- órfão em consumos_* e continuava aparecendo na matriz.
--
-- Solução: trigger AFTER DELETE que remove o registro de consumo correspondente
-- (casado por origem_emissao_arquivo_id OU pelo arquivo_url, para cobrir legados).
-- ==========================================

CREATE OR REPLACE FUNCTION public.sync_delete_anexo_consumo()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.categoria = 'concessionaria' THEN
    DELETE FROM public.consumos_faturas
    WHERE origem_emissao_arquivo_id = OLD.id
       OR (OLD.arquivo_url IS NOT NULL AND arquivo_url = OLD.arquivo_url);

  ELSIF OLD.categoria = 'relatorio_leitura' THEN
    DELETE FROM public.consumos_relatorios_leitura
    WHERE origem_emissao_arquivo_id = OLD.id
       OR (OLD.arquivo_url IS NOT NULL AND arquivo_url = OLD.arquivo_url);
  END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_sync_delete_anexo ON public.emissoes_arquivos;
CREATE TRIGGER trg_sync_delete_anexo
  AFTER DELETE ON public.emissoes_arquivos
  FOR EACH ROW EXECUTE FUNCTION public.sync_delete_anexo_consumo();
