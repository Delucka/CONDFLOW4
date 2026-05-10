-- ==========================================
-- MIGRAÇÃO: Tabela de Retificações de Emissões
-- Execute no SQL Editor do Supabase
-- Etapa 3
-- ==========================================

CREATE TABLE IF NOT EXISTS emissoes_retificacoes (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pacote_original_id    UUID NOT NULL REFERENCES emissoes_pacotes(id),
  pacote_retificacao_id UUID REFERENCES emissoes_pacotes(id),
  motivo                TEXT NOT NULL,
  descricao_detalhada   TEXT,
  solicitado_por        UUID NOT NULL REFERENCES auth.users(id),
  solicitado_em         TIMESTAMPTZ DEFAULT now(),
  aprovado_por          UUID REFERENCES auth.users(id),
  aprovado_em           TIMESTAMPTZ,
  status                TEXT DEFAULT 'pendente' CHECK (status IN ('pendente', 'aprovada', 'rejeitada'))
);

-- Índices para performance
CREATE INDEX IF NOT EXISTS idx_retif_original ON emissoes_retificacoes(pacote_original_id);
CREATE INDEX IF NOT EXISTS idx_retif_status   ON emissoes_retificacoes(status);

-- RLS
ALTER TABLE emissoes_retificacoes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "retif_select_autenticados" ON emissoes_retificacoes
  FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "retif_insert_master_emissor" ON emissoes_retificacoes
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid()
        AND role IN ('master', 'departamento')
    )
  );

CREATE POLICY "retif_update_master" ON emissoes_retificacoes
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid()
        AND role = 'master'
    )
  );

-- Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE emissoes_retificacoes;
