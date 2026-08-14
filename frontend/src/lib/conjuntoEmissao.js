'use client';
import { registrarNaTrilha } from '@/lib/aprovacaoFluxo';

/**
 * Conjunto de emissão — a regra de "se são um conjunto, todas saem juntas".
 *
 * Desde a 0086 um condomínio pode ter MAIS DE UMA emissão no mesmo mês (um
 * vencimento por grupo: dia 7 e dia 10, bloco A e bloco B, etc.). O UNIQUE que
 * garantia uma só foi derrubado de propósito.
 *
 * Isso cria um risco que não existia antes: metade dos boletos sair e a outra
 * metade ficar presa em aprovação. Para o condômino, receber só parte da
 * cobrança é pior que receber tudo um dia depois.
 *
 * Daí as duas regras deste arquivo, decididas pelo usuário:
 *
 *   1. NADA é registrado enquanto TODAS as emissões do condomínio+mês não
 *      estiverem aprovadas.
 *   2. UMA recusa devolve o CONJUNTO INTEIRO para correção.
 *
 * Num condomínio de vencimento único (a maioria: 277 de 303) o conjunto tem
 * um elemento só e tudo se comporta exatamente como antes.
 */

// Status que já saíram do fluxo de aprovação — não são devolvidos nem cobrados.
const JA_SAIU = ['registrado', 'expedida'];

// Status de quem ainda nem foi enviado. Devolver um rascunho não faz sentido:
// ele já está aberto para edição.
const NAO_ENVIADO = ['rascunho'];

const norm = (p) => String(p?.status || '').toLowerCase();

/**
 * Todas as emissões do mesmo condomínio + mês + ano, incluindo a própria.
 * Devolve `{ pacotes, error }` — nunca lança.
 */
export async function carregarConjunto(supabase, pacote) {
  if (!pacote?.condominio_id) return { pacotes: [], error: null };
  const { data, error } = await supabase
    .from('emissoes_pacotes')
    .select('id, status, grupo_id, condominio_id, mes_referencia, ano_referencia, nivel_aprovacao')
    .eq('condominio_id', pacote.condominio_id)
    .eq('mes_referencia', pacote.mes_referencia)
    .eq('ano_referencia', pacote.ano_referencia);
  if (error) return { pacotes: [], error };
  return { pacotes: data || [], error: null };
}

/**
 * Anexa `grupo_nome` / `grupo_due_day` a uma lista de pacotes.
 *
 * Feito num SELECT à parte, e não por join embutido, porque a lista do gerente
 * vem da RPC `get_pacotes_gerente` — que não aceita join. Assim as quatro telas
 * usam o mesmo caminho.
 *
 * Degrada em silêncio: pacote sem `grupo_id` (ou 0086 não aplicada) volta igual,
 * sem rótulo. Nenhuma tela quebra por causa disto.
 */
export async function anexarGrupos(supabase, pacotes) {
  const lista = pacotes || [];
  const ids = [...new Set(lista.map((p) => p.grupo_id).filter(Boolean))];
  if (ids.length === 0) return lista;
  const { data, error } = await supabase
    .from('condominio_grupos')
    .select('id, nome, due_day')
    .in('id', ids);
  if (error) return lista;
  const porId = Object.fromEntries((data || []).map((g) => [g.id, g]));
  return lista.map((p) => {
    const g = porId[p.grupo_id];
    return g ? { ...p, grupo_nome: g.nome, grupo_due_day: g.due_day } : p;
  });
}

/** As irmãs que ainda não estão aprovadas — o que impede o registro. */
export function pendentesDoConjunto(pacotes, exceptoId = null) {
  return (pacotes || []).filter((p) => {
    if (exceptoId && p.id === exceptoId) return false;
    const s = norm(p);
    return s !== 'aprovado' && !JA_SAIU.includes(s);
  });
}

/** As que uma recusa deve arrastar junto: enviadas, ainda não expedidas. */
export function arrastadasPelaRecusa(pacotes, exceptoId = null) {
  return (pacotes || []).filter((p) => {
    if (exceptoId && p.id === exceptoId) return false;
    const s = norm(p);
    if (JA_SAIU.includes(s)) return false;      // já saiu: reverter é outra operação
    if (NAO_ENVIADO.includes(s)) return false;  // rascunho já é editável
    if (s === 'solicitar_correcao') return false; // já está lá
    return true;
  });
}

/**
 * Pode registrar? Só quando o conjunto inteiro está aprovado.
 * `{ ok, pendentes, error }` — `pendentes` traz as que faltam, para a mensagem.
 */
export async function podeRegistrar(supabase, pacote) {
  const { pacotes, error } = await carregarConjunto(supabase, pacote);
  if (error) return { ok: false, pendentes: [], error };
  const pendentes = pendentesDoConjunto(pacotes, pacote.id);
  return { ok: pendentes.length === 0, pendentes, error: null };
}

/** Nome legível de um grupo, para a mensagem de bloqueio. */
export function rotuloGrupo(pacote, gruposPorId) {
  const g = gruposPorId?.[pacote?.grupo_id];
  if (g?.nome) return g.due_day ? `${g.nome} (vence dia ${g.due_day})` : g.nome;
  return 'Geral';
}

/**
 * Devolve as irmãs junto com a recusa. Só escreve nas que estão em fluxo.
 * Devolve `{ devolvidas, error }`. O chamador já tratou a própria.
 */
export async function devolverConjunto(supabase, pacote, { comentario, user }) {
  const { pacotes, error } = await carregarConjunto(supabase, pacote);
  if (error) return { devolvidas: 0, error };

  const alvos = arrastadasPelaRecusa(pacotes, pacote.id);
  if (alvos.length === 0) return { devolvidas: 0, error: null };

  const agora = new Date().toISOString();
  const ids = alvos.map((p) => p.id);

  const { data, error: upErr } = await supabase
    .from('emissoes_pacotes')
    .update({
      status: 'solicitar_correcao',
      comentario_correcao: comentario,
      correcao_por_nome: user?.full_name || user?.email || null,
      correcao_em: agora,
      atualizado_em: agora,
    })
    .in('id', ids)
    .select('id');
  if (upErr) return { devolvidas: 0, error: upErr };

  // Mesma marca de ciclo da recusa original: as aprovações anteriores destas
  // também deixam de valer, senão elas voltariam "meio aprovadas".
  const { error: errTrilha } = await registrarNaTrilha(supabase, {
    pacoteIds: ids, acao: 'correcao', user,
  });
  // Devolve junto com a contagem: as irmãs JÁ voltaram para correção, então não
  // é caso de abortar — mas quem chamou precisa poder avisar que a trilha delas
  // ficou incompleta.
  if (errTrilha) return { devolvidas: (data || []).length, error: errTrilha };

  return { devolvidas: (data || []).length, error: null };
}
