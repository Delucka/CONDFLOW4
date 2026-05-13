-- ==========================================
-- ATUALIZAÇÃO: "Consumo" de Cobranças Extras
-- Execute no SQL Editor do Supabase
-- ==========================================

CREATE OR REPLACE FUNCTION lacra_ao_registrar()
RETURNS TRIGGER AS $$
BEGIN
  -- Se o status mudou para 'registrado'
  IF NEW.status = 'registrado' AND (OLD.status IS NULL OR OLD.status IS DISTINCT FROM 'registrado') THEN
    -- Lacra o pacote
    NEW.lacrada    := true;
    NEW.lacrada_em := now();
    NEW.lacrada_por := auth.uid();
    
    -- Marca as cobranças extras do mês correspondente como 'processada'
    -- APENAS se NÃO for retificação (conforme pedido: "em caso de retificação mante-las")
    IF NEW.eh_retificacao = false THEN
      UPDATE public.cobrancas_extras 
      SET status = 'processada'
      WHERE condominio_id = NEW.condominio_id 
        AND mes = NEW.mes_referencia 
        AND ano = NEW.ano_referencia
        AND status = 'ativa';
        
      -- Nota: Usamos 'processada' para que as cobranças sumam das próximas emissões,
      -- mas continuem no banco para serem visualizadas em caso de Retificação.
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- RE-APLICAR O TRIGGER
DROP TRIGGER IF EXISTS trg_lacra_ao_registrar ON emissoes_pacotes;
CREATE TRIGGER trg_lacra_ao_registrar
  BEFORE UPDATE ON emissoes_pacotes
  FOR EACH ROW
  EXECUTE FUNCTION lacra_ao_registrar();
