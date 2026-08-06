'use client';
import { useState, useEffect, useMemo, useCallback } from 'react';
import { createClient } from '@/utils/supabase/client';

/**
 * Hook que calcula quais meses (1-12) de um (condominio, ano) estão BLOQUEADOS
 * para edição da planilha e cobranças extras.
 *
 * Regras:
 *   1. Prazo do mês encerrado: hoje >= dia 16 do mês X → trava
 *      (cada mês é trabalhado no mês anterior; tem até dia 15 inclusivo
 *       para finalizar/corrigir, no dia 16 fecha de vez)
 *   2. EXISTE pacote de emissão do mês → trava, mesmo em rascunho
 *
 * A regra 2 era 'etapa = pronto_para_emitir' (marcada à mão) e, à parte,
 * 'pacote registrado'. As duas juntas deixavam um vão: com a emissão já montada
 * mas ainda não registrada, dava para lançar cobrança extra por baixo dela — e a
 * cobrança não entrava no pacote que já estava pronto. Agora o sinal é a
 * existência do pacote: a partir do momento em que a emissão começa a ser
 * montada, os valores do mês param de se mexer.
 *
 * O lock se aplica a TODOS os perfis (nem master destrava).
 * Para correções, usar o fluxo de retificação — ou cancelar o rascunho, que
 * devolve o mês.
 */
export function useLockedMonths(condoId, ano) {
  // A etapa de preparação deixou de travar mês (0088): o hook só olha pacote.
  const [pacotes, setPacotes] = useState([]);
  const [loading, setLoading] = useState(true);

  const fetchAll = useCallback(async () => {
    if (!condoId || !ano) { setLoading(false); return; }
    const supabase = createClient();
    setLoading(true);
    try {
      const { data } = await supabase
        .from('emissoes_pacotes').select('mes_referencia, ano_referencia, status')
        .eq('condominio_id', condoId).eq('ano_referencia', ano);
      setPacotes(data || []);
    } finally {
      setLoading(false);
    }
  }, [condoId, ano]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  // Realtime: atualiza quando alguém cria/registra pacote
  useEffect(() => {
    if (!condoId || !ano) return;
    const supabase = createClient();
    const ch = supabase.channel(`locked-months-${condoId}-${ano}-${Math.random().toString(36).slice(2)}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'emissoes_pacotes', filter: `condominio_id=eq.${condoId}` }, fetchAll)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [condoId, ano, fetchAll]);

  const lockedMap = useMemo(() => {
    const map = {}; // { 1: { locked: true, reason: 'prazo_encerrado' }, ... }
    const today = new Date();
    for (let mes = 1; mes <= 12; mes++) {
      // Regra 1: hoje >= dia 16 do próprio mês (prazo de 15 dias do mês X encerrado)
      // JS: new Date(ano, mes-1, 16) = dia 16 do mês 'mes' às 00:00
      const cutoff = new Date(ano, mes - 1, 16, 0, 0, 0);
      if (today >= cutoff) { map[mes] = { locked: true, reason: 'prazo_encerrado' }; continue; }

      // Regra 2: existe pacote do mês — inclusive rascunho. Montar a emissão é
      // o momento em que os valores do mês param de se mexer; deixar cobrança
      // entrar depois disso faria o pacote sair sem ela.
      const pac = pacotes.find(p => p.mes_referencia === mes);
      if (pac) {
        const jaSaiu = ['registrado', 'expedida'].includes(pac.status);
        map[mes] = { locked: true, reason: jaSaiu ? 'emitido' : 'em_emissao' }; continue;
      }

      map[mes] = { locked: false };
    }
    return map;
  }, [pacotes, ano]);

  const isLocked = useCallback((mes) => !!lockedMap[mes]?.locked, [lockedMap]);
  const reasonFor = useCallback((mes) => lockedMap[mes]?.reason || null, [lockedMap]);

  return { lockedMap, isLocked, reasonFor, loading, refetch: fetchAll };
}

export function reasonLabel(reason) {
  switch (reason) {
    case 'passado':            return 'Mês encerrado';                  // legado
    case 'prazo_encerrado':    return 'Prazo encerrado (após dia 15)';
    case 'pronto_para_emitir': return 'Fechado antecipadamente';   // legado (até a 0088)
    case 'em_emissao':         return 'Emissão em montagem';
    case 'emitido':            return 'Emissão registrada';
    default:                   return 'Bloqueado';
  }
}
