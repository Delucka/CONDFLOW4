-- ==========================================
-- MIGRATION 0076: Congelar as cobranças extras no snapshot da emissão
-- Integridade/auditoria: hoje só a planilha é congelada no registro (planilha_snapshot).
-- As cobranças extras (salão de festas, churrasqueira etc.) e seus documentos não eram
-- salvas, então sumiam/podiam mudar depois. Este campo guarda um retrato imutável das
-- cobranças incluídas na emissão (descrição, valor, unidades e caminhos dos anexos).
-- ==========================================

ALTER TABLE public.emissoes_pacotes
  ADD COLUMN IF NOT EXISTS cobrancas_snapshot JSONB;

-- Formato (array): [{ id, descricao, valor, mes, ano, unidades, attachments: [path,...] }]
COMMENT ON COLUMN public.emissoes_pacotes.cobrancas_snapshot IS
  'Retrato congelado das cobranças extras incluídas na emissão, capturado no registro.';
