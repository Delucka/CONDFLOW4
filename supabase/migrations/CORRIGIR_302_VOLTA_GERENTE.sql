-- ============================================================================
-- 302 (09/2026): devolver ao gerente E acertar o nível do fluxo
--
-- Dois problemas somados:
--
--   1. a emissão foi parar na supervisora de contabilidade depois da correção
--   2. se o nível estiver em 1, o gerente NEM FAZ PARTE do fluxo — nível 1 exige
--      só a supervisora de contabilidade. Direcionar ao gerente sem acertar o
--      nível resolveria por cinco minutos: assim que ele aprovasse, a emissão
--      voltaria para a SPC.
--
-- Nível 4 = gerente + supervisor de gerentes + supervisora de contabilidade.
--
-- Rode o PASSO 1 e confira antes do PASSO 2.
-- ============================================================================

-- ── PASSO 1: o que existe hoje ──
SELECT p.id,
       c.name            AS condominio,
       p.status          AS status_agora,
       p.nivel_aprovacao AS nivel_agora,
       p.status_pre_correcao,
       p.correcao_por_nome,
       p.correcao_em
  FROM public.emissoes_pacotes p
  JOIN public.condominios c ON c.id = p.condominio_id
 WHERE c.name LIKE '302%'
   AND p.mes_referencia = 9
   AND p.ano_referencia = 2026;

-- Confira: UMA linha. Veja o `nivel_agora` — se vier 1, era esse o problema de
-- fundo, e não só o direcionamento.


-- ── PASSO 2: devolver ao gerente com o fluxo completo ──
UPDATE public.emissoes_pacotes p
   SET status              = 'pendente_gerente',
       nivel_aprovacao     = '4',
       -- Marco: se pedirem correção de novo, ela volta para o gerente.
       status_pre_correcao = 'pendente_gerente',
       atualizado_em       = now()
  FROM public.condominios c
 WHERE c.id = p.condominio_id
   AND c.name LIKE '302%'
   AND p.mes_referencia = 9
   AND p.ano_referencia = 2026
   -- Não mexe se já estiver com o gerente: rodar duas vezes não faz estrago.
   AND p.status <> 'pendente_gerente';

-- ── PASSO 3: conferir ──
SELECT c.name, p.status, p.nivel_aprovacao, p.status_pre_correcao
  FROM public.emissoes_pacotes p
  JOIN public.condominios c ON c.id = p.condominio_id
 WHERE c.name LIKE '302%' AND p.mes_referencia = 9 AND p.ano_referencia = 2026;

-- Esperado: status = pendente_gerente, nivel_aprovacao = 4.
--
-- Depois disso o caminho é: gerente aprova -> supervisor de gerentes ->
-- supervisora de contabilidade -> aprovada.
