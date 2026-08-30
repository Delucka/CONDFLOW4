-- ============================================================================
-- 0115 — A expedição não enxergava o nome do condomínio
-- ============================================================================
--
-- Na fila da expedição, cada linha aparecia assim:
--
--     Condomínio            —            1 boleto
--
-- Sem nome, sem código, sem dia de vencimento. Quem imprime não sabia para
-- QUEM estava imprimindo.
--
-- A causa é a `condominios_leitura` (0084): ela lista os papéis com alcance
-- global — master, departamento, as três supervisões — e depois trata gerente e
-- assistente pela carteira. A `expedicao` não existia quando aquela política foi
-- escrita (o papel só entrou no enum agora, na 0112), então não está em lugar
-- nenhum dela. O PostgREST não erra: devolve o pacote e, no lugar do
-- condomínio, nulo.
--
-- A expedição precisa do condomínio inteiro por três motivos, todos visíveis na
-- tela: o NOME (para saber o que está imprimindo), o `due_day` (o dia de
-- vencimento que ordena a fila) e o `prazo_expedicao_dia` com o
-- `prioridade_motivo` (a tarja de prazo, 0096). Sem o vínculo, os três somem
-- juntos.
--
-- Leitura, e só. A escrita continua em master/departamento pela
-- `condominios_escrita`, que esta migration não toca — a expedição não cadastra
-- condomínio nem muda vencimento.
--
-- ROLLBACK: rodar de novo a `condominios_leitura` como está na 0084, sem
-- 'expedicao' na lista.
-- ============================================================================

DROP POLICY IF EXISTS "condominios_leitura" ON public.condominios;

CREATE POLICY "condominios_leitura" ON public.condominios
  FOR SELECT TO authenticated
  USING (
    public.papel_atual() IN (
      'master', 'departamento',
      'supervisora', 'supervisora_contabilidade', 'supervisor_gerentes',
      'expedicao'
    )
    -- gerente: a própria carteira
    OR gerente_id IN (SELECT g.id FROM public.gerentes g WHERE g.profile_id = auth.uid())
    -- assistente: a carteira do gerente ao qual está vinculado (0057)
    OR gerente_id IN (
         SELECT g.id FROM public.gerentes g
          JOIN public.profiles p ON p.gerente_id = g.profile_id
         WHERE p.id = auth.uid()
       )
  );


-- ============================================================================
-- CONFERIR (rode depois)
-- ============================================================================
-- A política menciona a expedição (deve vir 'ok'):
--   SELECT CASE WHEN qual LIKE '%expedicao%' THEN 'ok' ELSE '>>> FALTA <<<' END AS veredito
--     FROM pg_policies WHERE tablename = 'condominios' AND policyname = 'condominios_leitura';
--
-- E a escrita continua fechada para ela (deve listar só master/departamento):
--   SELECT policyname, cmd FROM pg_policies
--    WHERE tablename = 'condominios' AND policyname = 'condominios_escrita';
