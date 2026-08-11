-- ============================================================
-- ENSAIO da 0087 — cria o trigger, testa e DESFAZ TUDO
-- ============================================================
-- Cole no SQL Editor do Supabase e rode INTEIRO, de uma vez só. O bloco acaba
-- em RAISE EXCEPTION de propósito: no Postgres o DDL é transacional, então o
-- trigger e as linhas de teste somem quando a transação aborta. Nada fica.
--
-- O resultado sai como a MENSAGEM DE ERRO no fim — é ali que se lê o veredito.
-- "Success" nenhum vai aparecer; ver o erro ENSAIO OK é o esperado.
-- ============================================================

DO $ensaio$
DECLARE
  v_condo   uuid;
  v_a       uuid;
  v_b       uuid;
  v_erro    text := 'NAO BLOQUEOU';
  v_solo    text := 'NAO PASSOU';
  v_relato  text;
BEGIN
  -- O índice único parcial da 0016, que a 0086 não encontrou (ela varreu
  -- pg_constraint, e isto é índice). Some junto com a transação, como o resto.
  DROP INDEX IF EXISTS public.idx_emissao_unica_por_competencia;

  -- O trigger de verdade, dentro da transação de ensaio.
  CREATE OR REPLACE FUNCTION public.checa_conjunto_emissao()
  RETURNS trigger LANGUAGE plpgsql AS $f$
  DECLARE faltam integer;
  BEGIN
    IF NEW.status <> 'registrado' OR OLD.status = 'registrado' THEN RETURN NEW; END IF;
    SELECT count(*) INTO faltam FROM public.emissoes_pacotes p
     WHERE p.condominio_id = NEW.condominio_id
       AND p.mes_referencia = NEW.mes_referencia
       AND p.ano_referencia = NEW.ano_referencia
       AND p.id <> NEW.id
       AND p.status NOT IN ('aprovado','registrado','expedida');
    IF faltam > 0 THEN
      RAISE EXCEPTION 'Faltam % emissão(ões) deste condomínio em %/% para aprovar. Os boletos do mês saem juntos.',
        faltam, lpad(NEW.mes_referencia::text,2,'0'), NEW.ano_referencia USING ERRCODE='check_violation';
    END IF;
    RETURN NEW;
  END $f$;

  DROP TRIGGER IF EXISTS trg_conjunto_emissao ON public.emissoes_pacotes;
  CREATE TRIGGER trg_conjunto_emissao BEFORE UPDATE ON public.emissoes_pacotes
    FOR EACH ROW EXECUTE FUNCTION public.checa_conjunto_emissao();

  SELECT id INTO v_condo FROM public.condominios ORDER BY name LIMIT 1;

  -- ── Caso 1: duas emissões no mesmo mês, uma pendente ──
  -- Ano 2099 para não colidir com dado real nenhum.
  INSERT INTO public.emissoes_pacotes (condominio_id, mes_referencia, ano_referencia, status)
  VALUES (v_condo, 1, 2099, 'aprovado') RETURNING id INTO v_a;
  INSERT INTO public.emissoes_pacotes (condominio_id, mes_referencia, ano_referencia, status)
  VALUES (v_condo, 1, 2099, 'pendente_gerente') RETURNING id INTO v_b;

  BEGIN
    UPDATE public.emissoes_pacotes SET status = 'registrado' WHERE id = v_a;
    v_erro := 'FALHOU: registrou com a irmã pendente';
  EXCEPTION WHEN check_violation THEN
    v_erro := 'BLOQUEOU (certo): ' || SQLERRM;
  END;

  -- ── Caso 2: irmã aprovada, tem de passar ──
  UPDATE public.emissoes_pacotes SET status = 'aprovado' WHERE id = v_b;
  BEGIN
    UPDATE public.emissoes_pacotes SET status = 'registrado' WHERE id = v_a;
    v_solo := 'PASSOU (certo): conjunto todo aprovado';
  EXCEPTION WHEN others THEN
    v_solo := 'FALHOU: bloqueou mesmo com tudo aprovado — ' || SQLERRM;
  END;

  v_relato :=
    E'\n\n===== ENSAIO 0087 =====\n' ||
    '  Caso 1 (irmã pendente)  ..... ' || v_erro || E'\n' ||
    '  Caso 2 (conjunto pronto) .... ' || v_solo || E'\n' ||
    '=======================\n' ||
    'Nada foi gravado: esta transação vai ser desfeita agora.';

  RAISE EXCEPTION 'ENSAIO OK %', v_relato;
END
$ensaio$;
