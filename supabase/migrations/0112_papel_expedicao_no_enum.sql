-- ============================================================================
-- 0112 — O papel `expedicao` existe no app, mas não no banco
-- ============================================================================
--
-- Descoberto em 30/08/2026, tentando contar quem tem o papel:
--
--   invalid input value for enum user_role: "expedicao"   (22P02)
--
-- O app inteiro trata `expedicao` como papel de verdade: está em
-- `auth_constants.py`, em `roles.js` (rótulo, sigla EXP), no `ROUTE_ACCESS` de
-- /central-emissoes, e nas policies da 0103. Só o enum `user_role` (0001) nunca
-- soube dele — o `assistente` foi acrescentado depois, o `expedicao` ficou.
--
-- Consequência: NÃO ERA POSSÍVEL criar o usuário da expedição. Qualquer
-- tentativa de gravar o papel batia em 22P02, e o aviso de remessa nova ficava
-- sem destinatário — o `.eq('role','expedicao')` do backend também estourava,
-- calado dentro do try/except, devolvendo "ninguém para avisar".
--
-- Toda a tela de expedição existia para um papel que o banco recusava.
--
-- ATENÇÃO — RODE ESTE ARQUIVO SOZINHO, sem BEGIN/COMMIT em volta.
-- `ALTER TYPE ... ADD VALUE` não pode dividir transação com quem usa o valor
-- novo. Rodar solto no SQL Editor resolve; colar junto de outra migration não.
--
-- ROLLBACK: não há. Postgres não remove valor de enum. O valor sobra sem uso —
-- inofensivo — e é por isso que ele não estava lá por acaso: quem escreveu a
-- 0001 sabia que enum não volta atrás. Custo de deixar: zero.
-- ============================================================================

ALTER TYPE public.user_role ADD VALUE IF NOT EXISTS 'expedicao';


-- ============================================================================
-- CONFERIR (rode depois, numa aba nova)
-- ============================================================================
-- Deve listar os 10 papéis, com 'expedicao' entre eles:
--   SELECT unnest(enum_range(NULL::public.user_role)) AS papel;
--
-- E isto deve rodar sem 22P02 (0 agora, até criarem o login):
--   SELECT count(*) FROM public.profiles WHERE role = 'expedicao';
