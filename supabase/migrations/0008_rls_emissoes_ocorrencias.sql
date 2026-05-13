-- ==========================================
-- RLS (CORRIGIDO): Políticas de Segurança para Ocorrências
-- Execute no SQL Editor do Supabase
-- ==========================================

-- Remover políticas anteriores para evitar conflitos se necessário
DROP POLICY IF EXISTS "Visao total para master_emissor_sup" ON emissoes_ocorrencias;
DROP POLICY IF EXISTS "Gerente ve apenas sua carteira" ON emissoes_ocorrencias;
DROP POLICY IF EXISTS "Autenticados podem criar" ON emissoes_ocorrencias;
DROP POLICY IF EXISTS "Master_emissor_sup podem resolver" ON emissoes_ocorrencias;

ALTER TABLE emissoes_ocorrencias ENABLE ROW LEVEL SECURITY;

-- 1. Visão total para Master, Emissor (departamento) e Supervisores
CREATE POLICY "Visao total para master_emissor_sup"
ON emissoes_ocorrencias FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM profiles
    WHERE profiles.id = auth.uid()
      AND profiles.role IN ('master', 'departamento', 'supervisor_gerentes', 'supervisora_contabilidade', 'supervisora')
  )
);

-- 2. Gerente vê apenas os condomínios da sua carteira
CREATE POLICY "Gerente ve apenas sua carteira"
ON emissoes_ocorrencias FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM profiles p
    WHERE p.id = auth.uid()
      AND p.role = 'gerente'
      AND emissoes_ocorrencias.condominio_id IN (
        SELECT c.id FROM condominios c
        JOIN gerentes g ON c.gerente_id = g.id
        WHERE g.profile_id = auth.uid()
      )
  )
);

-- 3. Criar ocorrência: Qualquer usuário autenticado pode criar
CREATE POLICY "Autenticados podem criar"
ON emissoes_ocorrencias FOR INSERT
WITH CHECK (auth.uid() = criado_por);

-- 4. Resolver ocorrência: Apenas Master, Emissor e Supervisores podem atualizar
CREATE POLICY "Master_emissor_sup podem resolver"
ON emissoes_ocorrencias FOR UPDATE
USING (
  EXISTS (
    SELECT 1 FROM profiles
    WHERE profiles.id = auth.uid()
      AND profiles.role IN ('master', 'departamento', 'supervisor_gerentes', 'supervisora_contabilidade', 'supervisora')
  )
);
