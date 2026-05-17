-- ==========================================
-- MIGRATION: Indices de performance
-- Cobre as queries mais frequentes do dashboard, Central de Emissoes,
-- aprovacoes e tela de conferencia. Todos sao IF NOT EXISTS / idempotentes.
-- ==========================================

-- emissoes_pacotes ---------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_pacotes_condo
  ON public.emissoes_pacotes(condominio_id);

CREATE INDEX IF NOT EXISTS idx_pacotes_status
  ON public.emissoes_pacotes(status);

CREATE INDEX IF NOT EXISTS idx_pacotes_periodo
  ON public.emissoes_pacotes(ano_referencia, mes_referencia);

CREATE INDEX IF NOT EXISTS idx_pacotes_condo_periodo
  ON public.emissoes_pacotes(condominio_id, ano_referencia, mes_referencia);

-- emissoes_arquivos --------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_arquivos_pacote
  ON public.emissoes_arquivos(pacote_id);

CREATE INDEX IF NOT EXISTS idx_arquivos_condo
  ON public.emissoes_arquivos(condominio_id);

CREATE INDEX IF NOT EXISTS idx_arquivos_condo_data
  ON public.emissoes_arquivos(condominio_id, criado_em DESC);

-- processos ----------------------------------------------------------
-- (cobertura para queries em /dashboard, /aprovacoes e RouteGuard)
CREATE INDEX IF NOT EXISTS idx_processos_condo
  ON public.processos(condominio_id);

CREATE INDEX IF NOT EXISTS idx_processos_status
  ON public.processos(status);

CREATE INDEX IF NOT EXISTS idx_processos_condo_periodo
  ON public.processos(condominio_id, year, semester);

-- aprovacoes (auditoria + pipeline) -----------------------------------
CREATE INDEX IF NOT EXISTS idx_aprovacoes_processo
  ON public.aprovacoes(processo_id, created_at DESC);

-- condominios (RBAC gerente) -----------------------------------------
CREATE INDEX IF NOT EXISTS idx_condominios_gerente
  ON public.condominios(gerente_id);

-- gerentes (lookup por profile_id no login) ---------------------------
CREATE INDEX IF NOT EXISTS idx_gerentes_profile
  ON public.gerentes(profile_id);
