'use client';
import { useState, useEffect, useMemo, useCallback } from 'react';
import { createClient } from '@/utils/supabase/client';

/**
 * Carrega o plano de contas (estilo Ahreas).
 * Retorna a hierarquia: grupos → subcontas (sintéticas) → analíticas.
 *
 * @param {string|null} planoId — UUID do plano. Se null, carrega o primeiro plano ativo.
 */
export function usePlanoContas(planoId = null) {
  const [plano, setPlano]       = useState(null);
  const [itens, setItens]       = useState([]);
  const [loading, setLoading]   = useState(true);
  const [erro, setErro]         = useState(null);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    setErro(null);
    try {
      const supabase = createClient();

      // 1) Resolve qual plano carregar
      let p = null;
      if (planoId) {
        const { data } = await supabase.from('planos_contas').select('*').eq('id', planoId).maybeSingle();
        p = data;
      } else {
        const { data } = await supabase.from('planos_contas').select('*').eq('ativo', true).order('codigo').limit(1);
        p = (data || [])[0] || null;
      }
      if (!p) { setPlano(null); setItens([]); return; }
      setPlano(p);

      // 2) Carrega todos os itens ordenados
      const { data: rows } = await supabase
        .from('planos_contas_itens')
        .select('*')
        .eq('plano_id', p.id)
        .eq('ativo', true)
        .order('ordem');
      setItens(rows || []);
    } catch (e) {
      setErro(e.message || String(e));
    } finally {
      setLoading(false);
    }
  }, [planoId]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  // Estrutura em árvore: { grupos: [{ ...grupo, filhos: [{ ...sintetica, filhos: [analiticas] }] }] }
  const arvore = useMemo(() => {
    const byId = new Map();
    itens.forEach(it => byId.set(it.id, { ...it, filhos: [] }));

    const grupos = [];
    for (const it of itens) {
      const node = byId.get(it.id);
      if (it.parent_id && byId.has(it.parent_id)) {
        byId.get(it.parent_id).filhos.push(node);
      } else if (!it.natureza) {
        // Grupo de 1º grau (sem natureza)
        grupos.push(node);
      }
    }
    return grupos;
  }, [itens]);

  return { plano, itens, arvore, loading, erro, refetch: fetchAll };
}

/** Lista todos os planos disponíveis (dropdown de seleção) */
export function usePlanosList() {
  const [planos, setPlanos]   = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const supabase = createClient();
      const { data } = await supabase.from('planos_contas').select('*').eq('ativo', true).order('codigo');
      setPlanos(data || []);
      setLoading(false);
    })();
  }, []);

  return { planos, loading };
}
