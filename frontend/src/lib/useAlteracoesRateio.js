'use client';
import { useState, useEffect, useMemo, useCallback } from 'react';
import { createClient } from '@/utils/supabase/client';

/**
 * Hook que carrega as alterações de rateio (AGO/AGE/Reuniao) de um condomínio
 * num ano. Retorna lista bruta + mapa agrupado por mês + helpers.
 *
 * Quem pode criar/editar: master + gerente daquele condomínio
 *   (RLS aplica o filtro automaticamente)
 *
 * @param {string|null} condoId
 * @param {number|null} ano
 */
export function useAlteracoesRateio(condoId, ano) {
  const [alteracoes, setAlteracoes] = useState([]);
  const [loading, setLoading]       = useState(true);
  const [erro, setErro]             = useState(null);

  const fetchAll = useCallback(async () => {
    if (!condoId || !ano) { setAlteracoes([]); setLoading(false); return; }
    setLoading(true);
    setErro(null);
    try {
      const supabase = createClient();
      const { data, error } = await supabase
        .from('alteracoes_rateio')
        .select('*')
        .eq('condominio_id', condoId)
        .eq('ano_referencia', ano)
        .order('mes_referencia')
        .order('data_evento');
      if (error) throw error;
      setAlteracoes(data || []);
    } catch (e) {
      console.error('[useAlteracoesRateio] erro:', e);
      setErro(e.message || String(e));
    } finally {
      setLoading(false);
    }
  }, [condoId, ano]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  // Realtime: atualiza quando algum item muda
  useEffect(() => {
    if (!condoId) return;
    const supabase = createClient();
    const ch = supabase.channel(`alteracoes_${condoId}_${Math.random().toString(36).slice(2)}`)
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'alteracoes_rateio', filter: `condominio_id=eq.${condoId}` },
        fetchAll
      )
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [condoId, fetchAll]);

  // Mapa: { 6: [alteracao1, alteracao2], 8: [...] }
  const porMes = useMemo(() => {
    const m = {};
    for (const alt of alteracoes) {
      if (!m[alt.mes_referencia]) m[alt.mes_referencia] = [];
      m[alt.mes_referencia].push(alt);
    }
    return m;
  }, [alteracoes]);

  // Tem alguma alteração 'prevista' no mês? (usado para bloquear emissor)
  const temPrevistaNoMes = useCallback((mes) => {
    return (porMes[mes] || []).some(a => a.status === 'prevista');
  }, [porMes]);

  return {
    alteracoes,
    porMes,
    temPrevistaNoMes,
    loading,
    erro,
    refetch: fetchAll,
  };
}

export const TIPOS_ALTERACAO = [
  { value: 'AGO',     label: 'AGO — Assembleia Geral Ordinária',     color: 'amber' },
  { value: 'AGE',     label: 'AGE — Assembleia Geral Extraordinária', color: 'orange' },
  { value: 'Reuniao', label: 'Reunião',                                color: 'cyan' },
];

export const STATUS_ALTERACAO = [
  { value: 'prevista',  label: 'Prevista (ainda não ocorreu)', color: 'amber' },
  { value: 'realizada', label: 'Realizada',                    color: 'emerald' },
  { value: 'cancelada', label: 'Cancelada',                    color: 'slate' },
];
