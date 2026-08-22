-- ============================================================================
-- Conferir se o gerente só enxerga a carteira dele — no BANCO, não na tela
-- ============================================================================
-- Rode no SQL Editor do Supabase. Nada aqui escreve: são quatro consultas.
--
-- Por que isto importa: o recorte por carteira hoje é feito pela aplicação
-- (front e API). O RLS da maioria destas tabelas é `USING (true)`, ou seja, o
-- banco entrega tudo a qualquer sessão autenticada. Isso segura o acesso
-- acidental, mas não segura quem chamar o Supabase direto com a anon key.
-- ============================================================================


-- 1) A função que a tela de aprovação usa para o gerente.
--    Ela não está no repositório (foi criada direto no banco), então esta é a
--    única forma de saber o que ela filtra. Procure por `auth.uid()` e por
--    `gerente_id` no corpo: sem os dois, ela devolve pacote de todo mundo.
SELECT p.proname,
       CASE WHEN p.prosecdef THEN 'SECURITY DEFINER' ELSE 'SECURITY INVOKER' END AS seguranca,
       pg_get_functiondef(p.oid) AS definicao
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE p.proname = 'get_pacotes_gerente';


-- 2) Quais tabelas têm RLS ligado, e quantas policies cada uma tem.
--    Linha com rls_ligado = false: o banco não filtra nada ali.
SELECT c.relname                                    AS tabela,
       c.relrowsecurity                             AS rls_ligado,
       (SELECT count(*) FROM pg_policies pol
         WHERE pol.schemaname = 'public' AND pol.tablename = c.relname) AS policies
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relkind = 'r'
  AND c.relname IN ('condominios','rateios','processos','emissoes_pacotes',
                    'emissoes_arquivos','cobrancas_extras','edicoes_mensais',
                    'condominio_grupos','profiles','gerentes')
ORDER BY c.relrowsecurity, c.relname;


-- 3) As policies que existem, e o que elas de fato exigem.
--    `qual = true` é o mesmo que não ter policy: passa todo mundo autenticado.
SELECT tablename, policyname, cmd, roles::text, qual, with_check
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN ('condominios','rateios','processos','emissoes_pacotes',
                    'emissoes_arquivos','cobrancas_extras','edicoes_mensais')
ORDER BY tablename, policyname;


-- 4) Vínculo assistente → gerente (0057). Assistente sem `gerente_id` não tem
--    carteira nenhuma: as telas dele abrem vazias, e é isso que se quer — mas
--    vale saber quantos estão assim, porque parece defeito.
SELECT a.full_name AS assistente,
       a.email,
       g.full_name AS gerente_vinculado
FROM profiles a
LEFT JOIN profiles g ON g.id = a.gerente_id
WHERE a.role = 'assistente'
ORDER BY g.full_name NULLS FIRST, a.full_name;
