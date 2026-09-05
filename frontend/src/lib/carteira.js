'use client';
import { useEffect, useState } from 'react';
import { createClient } from '@/utils/supabase/client';
import { useAuth } from '@/lib/auth';

/**
 * A carteira de quem está olhando — em um lugar só.
 *
 * O RLS de `condominios`, `rateios` e `emissoes_*` é `USING (true)`: o banco
 * entrega tudo a qualquer pessoa autenticada. Quem recorta por carteira é a
 * aplicação, e isso já estava escrito de novo em cada tela que precisou —
 * dashboard, fila de ocorrências, sino, relatório. Escrito em vários lugares,
 * um deles esquece: as páginas de `/condominio/[id]` nunca recortaram.
 *
 * Enquanto o RLS não for religado, este módulo é o recorte. Ele não é barreira
 * de segurança de verdade — quem chamar o Supabase direto com a anon key passa
 * por cima dele. É o que impede o acesso acidental e deixa a intenção explícita
 * em um lugar só, pronta para virar policy.
 */

/**
 * `gerentes.id` da carteira de quem está olhando.
 *   • gerente    → a própria
 *   • assistente → a do gerente a que está vinculado (profiles.gerente_id, 0057)
 *   • demais     → null, que aqui significa "vê tudo"
 */
export async function carteiraGerenteId(supabase, profile) {
  const role = profile?.role;
  if (role === 'gerente') {
    const { data } = await supabase
      .from('gerentes').select('id').eq('profile_id', profile.id).maybeSingle();
    return data?.id || null;
  }
  if (role === 'assistente') {
    const pid = profile?.gerente_profile_id;
    if (!pid) return null;
    const { data } = await supabase
      .from('gerentes').select('id').eq('profile_id', pid).maybeSingle();
    return data?.id || null;
  }
  return null;
}

/**
 * Carteiras que estou cobrindo HOJE, porque o dono está de férias (0117).
 *
 * Devolve `[{ ausenciaId, gerenteNome, motivo, dataInicio, dataFim, condoIds }]`,
 * uma entrada por gerente ausente — é o que vira aba própria na tela de
 * aprovações ("Condomínios da Suellen"), para ninguém aprovar achando que a
 * carteira é sua.
 *
 * O período é filtrado aqui e TAMBÉM no banco (`condominios_por_ausencia`). A
 * tela some no dia seguinte ao fim; a política do banco é que garante que não
 * adianta insistir.
 */
export async function carteirasCobertas(supabase, profile) {
  if (!profile?.id) return [];
  const hoje = new Date().toISOString().slice(0, 10);
  const { data, error } = await supabase
    .from('gerente_ausencia_condominios')
    .select('condominio_id, ausencia_id, gerente_ausencias!inner(id, motivo, data_inicio, data_fim, encerrada_em, gerentes!inner(nome))')
    .eq('substituto_id', profile.id)
    .is('gerente_ausencias.encerrada_em', null)
    .lte('gerente_ausencias.data_inicio', hoje)
    .gte('gerente_ausencias.data_fim', hoje);

  // Tabela ainda não existe (0117 não rodou): ninguém está cobrindo ninguém.
  if (error) return [];

  const porAusencia = new Map();
  for (const linha of data || []) {
    const a = linha.gerente_ausencias;
    if (!a) continue;
    const atual = porAusencia.get(a.id) || {
      ausenciaId: a.id,
      gerenteNome: a.gerentes?.nome || 'gerente',
      motivo: a.motivo || 'Férias',
      dataInicio: a.data_inicio,
      dataFim: a.data_fim,
      condoIds: [],
    };
    atual.condoIds.push(linha.condominio_id);
    porAusencia.set(a.id, atual);
  }
  return [...porAusencia.values()];
}

/**
 * Ids dos condomínios da carteira, ou `null` quando não há recorte.
 *
 * Inclui o que estou cobrindo por férias: sem isso o substituto veria a aba com
 * o nome do colega e nenhuma emissão dentro dela.
 */
export async function condosDaCarteira(supabase, profile) {
  const gId = await carteiraGerenteId(supabase, profile);

  // Sem carteira própria (master, departamento, supervisões) = vê tudo, como
  // sempre. Cobrir a carteira de alguém não pode ENCOLHER o alcance de quem já
  // enxergava mais — e é por isso que os cobertos nem são buscados aqui.
  if (!gId) return null;

  const [{ data }, coberturas] = await Promise.all([
    supabase.from('condominios').select('id').eq('gerente_id', gId),
    carteirasCobertas(supabase, profile),
  ]);
  const cobertos = coberturas.flatMap(c => c.condoIds);
  return [...new Set([...(data || []).map(c => c.id), ...cobertos])];
}

/** Quem tem carteira: só gerente e assistente. */
export function temRecorteDeCarteira(role) {
  return role === 'gerente' || role === 'assistente';
}

/**
 * Este condomínio é da carteira de quem está olhando?
 *
 * As telas de `/condominio/[id]` são abertas pela lista — que já vem recortada —
 * mas o id vai na URL, e URL se digita, se guarda nos favoritos e se manda por
 * mensagem. Sem esta checagem, um gerente que troque o id na barra de endereços
 * abre (e edita) a planilha de outro.
 *
 * `permitido` começa `false` e só abre depois da resposta: o contrário mostraria
 * a planilha alheia por uma fração de segundo antes de fechar a porta.
 */
export function useCondoNaCarteira(condoId) {
  const supabase = createClient();
  const { profile } = useAuth();
  const [estado, setEstado] = useState({ carregando: true, permitido: false });

  useEffect(() => {
    let cancelado = false;
    (async () => {
      const role = profile?.role;
      if (!role) { setEstado({ carregando: true, permitido: false }); return; }
      if (!temRecorteDeCarteira(role)) {
        setEstado({ carregando: false, permitido: true });
        return;
      }
      if (!condoId) { setEstado({ carregando: false, permitido: false }); return; }

      // `condosDaCarteira`, e não `eq('gerente_id', ...)`: durante uma cobertura
      // de férias (0117) o dono do condomínio continua sendo o gerente ausente.
      // Perguntar "de quem é?" fechava a porta justamente para quem foi
      // encarregado de abri-la — o substituto via a planilha na fila e batia em
      // "este condomínio não está na sua carteira" ao clicar.
      const ids = await condosDaCarteira(supabase, profile);
      if (cancelado) return;
      setEstado({ carregando: false, permitido: !ids || ids.includes(condoId) });
    })();
    return () => { cancelado = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [condoId, profile?.id, profile?.role, profile?.gerente_profile_id]);

  return estado;
}
