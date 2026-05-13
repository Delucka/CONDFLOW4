-- ==========================================
-- MIGRATION: Fila de Ocorrências e Solicitações
-- Execute no SQL Editor do Supabase
-- ==========================================

CREATE TABLE IF NOT EXISTS emissoes_ocorrencias (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pacote_id UUID NOT NULL REFERENCES emissoes_pacotes(id) ON DELETE CASCADE,
  condominio_id UUID NOT NULL REFERENCES condominios(id),
  
  tipo TEXT NOT NULL CHECK (tipo IN ('ocorrencia', 'solicitacao')),
  status TEXT NOT NULL DEFAULT 'aberta' CHECK (status IN ('aberta', 'analise', 'resolvida')),
  
  descricao TEXT NOT NULL,
  
  criado_por UUID NOT NULL REFERENCES auth.users(id),
  criado_por_role TEXT NOT NULL,
  
  resolvido_por UUID REFERENCES auth.users(id),
  resolvido_em TIMESTAMPTZ,
  resposta TEXT,
  
  criado_em TIMESTAMPTZ DEFAULT now(),
  atualizado_em TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ocorrencias_pacote ON emissoes_ocorrencias(pacote_id);
CREATE INDEX IF NOT EXISTS idx_ocorrencias_condominio ON emissoes_ocorrencias(condominio_id);
CREATE INDEX IF NOT EXISTS idx_ocorrencias_status ON emissoes_ocorrencias(status);

-- Habilitar Realtime para esta tabela
ALTER PUBLICATION supabase_realtime ADD TABLE emissoes_ocorrencias;
