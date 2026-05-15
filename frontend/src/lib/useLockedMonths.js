'use client';
import { useState, useEffect, useMemo, useCallback } from 'react';
import { createClient } from '@/utils/supabase/client';

/**
 * Hook que calcula quais meses (1-12) de um (condominio, ano) estão BLOQUEADOS
 * para edição da planilha e cobranças extras.
 *
 * Regras:
 *   1. Mês passou (hoje > último dia do mês) → trava
 *   2. Etapa de preparação = 'pronto_para_emitir' → trava
 *   3. Pacote de emissão registrado/expedido → trava
 *
 * O lock se aplica a TODOS os perfis (nem master destrava).
 * Para correções, usar o fluxo de retificação.
 */
export function useLockedMonths(condoId, ano) {
  const [preparacoes, setPreparacoes] = useState([]);
  const [pacotes, setPacotes]         = useState([]);
  const [loading, setLoading]         = useState(true);

  const fetchAll = useCallback(async () => {
    if (!condoId || !ano) { setLoading(false); return; }
    const supabase = createClient();
    setLoading(true);
    try {
      const [prepRes, pacRes] = await Promise.all([
        supabase.from('emissoes_preparacao').select('mes_referencia, ano_referencia, etapa')
          .eq('condominio_id', condoId).eq('ano_referencia', ano),
        supabase.from('emissoes_pacotes').select('mes_referencia, ano_referencia, status')
          .eq('condominio_id', condoId).eq('ano_referencia', ano),
      ]);
      setPreparacoes(prepRes.data || []);
      setPacotes(pacRes.data || []);
    } finally {
      setLoading(false);
    }
  }, [condoId, ano]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  // Realtime: atualiza quando alguém muda etapa ou registra pacote
  useEffect(() => {
    if (!condoId || !ano) return;
    const supabase = createClient();
    const ch = supabase.channel(`locked-months-${condoId}-${ano}-${Math.random().toString(36).slice(2)}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'emissoes_preparacao', filter: `condominio_id=eq.${condoId}` }, fetchAll)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'emissoes_pacotes',    filter: `condominio_id=eq.${condoId}` }, fetchAll)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [condoId, ano, fetchAll]);

  const lockedMap = useMemo(() => {
    const map = {}; // { 1: { locked: true, reason: 'passado' }, ... }
    const today = new Date();
    for (let mes = 1; mes <= 12; mes++) {
      // Regra 1: mês passou
      const lastDay = new Date(ano, mes, 0, 23, 59, 59);
      if (today > lastDay) { map[mes] = { locked: true, reason: 'passado' }; continue; }

      // Regra 2: etapa pronto p/ emitir
      const prep = preparacoes.find(p => p.mes_referencia === mes);
      if (prep?.etapa === 'pronto_para_emitir') {
        map[mes] = { locked: true, reason: 'pronto_para_emitir' }; continue;
      }

      // Regra 3: pacote registrado/expedido
      const pac = pacotes.find(p => p.mes_referencia === mes);
      if (pac && ['registrado','expedida'].includes(pac.status)) {
        map[mes] = { locked: true, reason: 'emitido' }; continue;
      }

      map[mes] = { locked: false };
    }
    return map;
  }, [preparacoes, pacotes, ano]);

  const isLocked = useCallback((mes) => !!lockedMap[mes]?.locked, [lockedMap]);
  const reasonFor = useCallback((mes) => lockedMap[mes]?.reason || null, [lockedMap]);

  return { lockedMap, isLocked, reasonFor, loading, refetch: fetchAll };
}

export function reasonLabel(reason) {
  switch (reason) {
    case 'passado':            return 'Mês encerrado';
    case 'pronto_para_emitir': return 'Pronto p/ emitir';
    case 'emitido':            return 'Emissão registrada';
    default:                   return 'Bloqueado';
  }
}
