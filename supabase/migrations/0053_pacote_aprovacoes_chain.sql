-- ==========================================
-- MIGRATION 0053: Trilha COMPLETA de aprovação do pacote (1 linha por nível)
-- Cada aprovação registra quem (role + nome + email) e quando.
-- Exibida como siglas (SPC, SPG, GER...) com cargo+nome no hover.
-- ==========================================
CREATE TABLE IF NOT EXISTS public.emissoes_pacotes_aprovacoes (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pacote_id     UUID NOT NULL REFERENCES public.emissoes_pacotes(id) ON DELETE CASCADE,
  acao          TEXT NOT NULL DEFAULT 'aprovacao',   -- 'aprovacao' | 'correcao'
  role          TEXT,
  usuario_nome  TEXT,
  usuario_email TEXT,
  criado_em     TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.emissoes_pacotes_aprovacoes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "pac_apr_all_auth" ON public.emissoes_pacotes_aprovacoes;
CREATE POLICY "pac_apr_all_auth" ON public.emissoes_pacotes_aprovacoes
  FOR ALL USING (auth.role() = 'authenticated') WITH CHECK (auth.role() = 'authenticated');

CREATE INDEX IF NOT EXISTS idx_pac_apr_pacote ON public.emissoes_pacotes_aprovacoes(pacote_id);
