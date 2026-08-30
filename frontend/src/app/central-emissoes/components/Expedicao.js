'use client';
import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { createClient } from '@/utils/supabase/client';
import { useAuth } from '@/lib/auth';
import { useToast } from '@/components/Toast';
import { abrirArquivoSeguro } from '@/lib/arquivo';
import { useRevalidarAoVoltar } from '@/lib/useRevalidarAoVoltar';
import { anexarGrupos } from '@/lib/conjuntoEmissao';
import { useRealtime } from '@/lib/realtime';
import TagPrioritario from '@/components/TagPrioritario';
import { mesAnoVigente } from '@/lib/mesVigente';
import { Printer, Check, Loader2, Inbox, Search, RotateCcw, FileText, X, FolderOpen, ExternalLink } from 'lucide-react';
import Link from 'next/link';

/**
 * Central de expedição — a fila de impressão dos boletos.
 *
 * Uma linha por REMESSA, não por documento: condomínio de dois vencimentos tem
 * duas remessas no mesmo mês, com boletos diferentes e datas diferentes, e a
 * expedição trata cada uma como um trabalho separado.
 *
 * Chegam duas categorias do "Expedir": `boleto` e `filipeta` (0110) — o
 * informativo que alguns condomínios mandam no mesmo envelope. O resto do
 * pacote (planilha, faturas, rateio) não é assunto de quem imprime.
 *
 * Condomínio marcado com `usa_filipeta` que chega sem filipeta aparece com o
 * aviso na linha. Não trava: a remessa pode sair assim se for o caso, mas
 * ninguém descobre depois de o envelope ter fechado.
 *
 * A baixa não arquiva: o arquivo continua ali para reimprimir e consultar.
 */

const MESES = ['', 'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
               'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];

const soDigitos = (s) => String(s || '').replace(/\D/g, '');
const semAcento = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

const fmtData = (iso) => iso
  ? new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
  : null;

export default function Expedicao() {
  const supabase = useMemo(() => createClient(), []);
  const { user, profile } = useAuth();
  const { addToast } = useToast();

  const [remessas, setRemessas] = useState([]);
  const [loading, setLoading] = useState(true);
  // Ver o comentário em fetchFila(): distingue primeira carga de rebusca.
  const jaCarregouRef = useRef(false);
  const [mesAba, setMesAba] = useState(null);      // "2026-09"
  const [filtro, setFiltro] = useState('pendentes');
  const [busca, setBusca] = useState('');
  const [expandido, setExpandido] = useState(null);
  const [marcando, setMarcando] = useState(null);
  // Origem: o resto do pacote (planilha, faturas, rateio) da remessa aberta.
  // Boleto errado é problema de quem imprime, mas a explicação está sempre no
  // que gerou o boleto — e daqui não havia caminho nenhum até lá.
  const [origem, setOrigem] = useState(null);   // { pacoteId, arquivos, carregando }

  // Quem emite pode abrir a emissão de verdade; a expedição vê os arquivos.
  const podeAbrirEmissao = profile?.role === 'master' || profile?.role === 'departamento';

  async function verOrigem(r) {
    if (origem?.pacoteId === r.id) { setOrigem(null); return; }
    setOrigem({ pacoteId: r.id, arquivos: [], carregando: true });
    const { data, error } = await supabase
      .from('emissoes_arquivos')
      .select('id, arquivo_nome, arquivo_url, categoria, criado_em')
      .eq('pacote_id', r.id)
      .neq('categoria', 'boleto')
      .order('criado_em');
    if (error) {
      addToast('Não consegui abrir a emissão: ' + error.message, 'error');
      setOrigem(null);
      return;
    }
    setOrigem({ pacoteId: r.id, arquivos: data || [], carregando: false });
  }

  const fetchFila = useCallback(async () => {
      // Spinner de tela cheia SÓ na primeira carga. Antes, todo rebusca (voltar
      // para a aba, evento do realtime) acendia o spinner e desmontava a árvore:
      // carteira expandida fechava, rolagem voltava ao topo, filtro parecia
      // "sair de ordem". O dado nem mudava — o que se perdia era o lugar.
    if (!jaCarregouRef.current) setLoading(true);
    try {
      // Só emissões que já passaram do registro. Antes disso não existe boleto.
      const { data: pacs, error } = await supabase
        .from('emissoes_pacotes')
        .select('id, condominio_id, mes_referencia, ano_referencia, status, grupo_id, condominios(name, due_day, prazo_expedicao_dia, prioridade_motivo, usa_filipeta)')
        .in('status', ['registrado', 'expedida']);
      if (error) throw error;

      const ids = (pacs || []).map(p => p.id);
      const porPacote = {};
      if (ids.length) {
        const { data: arqs } = await supabase
          .from('emissoes_arquivos')
          .select('id, pacote_id, arquivo_nome, arquivo_url, categoria, impresso_em, impresso_por_nome, ordem, criado_em')
          .in('pacote_id', ids)
          // `categoria` (0095/0110) é o que o "Expedir" anexa. Antes o código
          // marcava `status: 'expedida'`, valor que o enum nem aceita — o
          // insert falhava calado e nenhum boleto chegou à tabela.
          .in('categoria', ['boleto', 'filipeta'])
          .order('ordem', { ascending: true, nullsFirst: false })
          .order('criado_em', { ascending: true });
        (arqs || []).forEach(a => { (porPacote[a.pacote_id] = porPacote[a.pacote_id] || []).push(a); });
      }

      const comGrupo = await anexarGrupos(supabase, pacs || []);
      // Pacote sem nada anexado não é trabalho de expedição — ainda está com
      // quem emite. Some da fila em vez de virar linha vazia.
      const lista = comGrupo
        .map(p => {
          const docs = porPacote[p.id] || [];
          const filipetas = docs.filter(d => d.categoria === 'filipeta');
          return {
            ...p,
            docs,
            boletos: docs.filter(d => d.categoria !== 'filipeta'),
            filipetas,
            // Deveria ter filipeta e não tem. É o único estado desta tela que
            // pede alguém fazer alguma coisa ANTES de imprimir.
            faltaFilipeta: !!p.condominios?.usa_filipeta && filipetas.length === 0,
            vencimento: p.grupo_due_day ?? p.condominios?.due_day ?? null,
          };
        })
        .filter(p => p.docs.length > 0);

      setRemessas(lista);
    } catch (e) {
      addToast('Erro ao carregar a fila: ' + (e.message || e), 'error');
      setRemessas([]);
    } finally {
      jaCarregouRef.current = true;
      setLoading(false);
    }
  }, [supabase, addToast]);

  useEffect(() => { fetchFila(); }, [fetchFila]);
  useRealtime(['emissoes_arquivos', 'emissoes_pacotes'], fetchFila);

  useRevalidarAoVoltar(fetchFila);

  // ── Abas de mês ──
  const abas = useMemo(() => {
    const mapa = new Map();
    for (const r of remessas) {
      const chave = `${r.ano_referencia}-${String(r.mes_referencia).padStart(2, '0')}`;
      const atual = mapa.get(chave) || { chave, mes: r.mes_referencia, ano: r.ano_referencia, pendentes: 0 };
      atual.pendentes += r.docs.filter(b => !b.impresso_em).length ? 1 : 0;
      mapa.set(chave, atual);
    }
    return [...mapa.values()].sort((a, b) => b.chave.localeCompare(a.chave));
  }, [remessas]);

  // Abre no mês de trabalho quando ele tem fila; senão, no mais recente que tem.
  const abaAtiva = useMemo(() => {
    if (mesAba && abas.some(a => a.chave === mesAba)) return mesAba;
    const vig = mesAnoVigente();
    const chaveVig = `${vig.ano}-${String(vig.mes).padStart(2, '0')}`;
    if (abas.some(a => a.chave === chaveVig)) return chaveVig;
    return abas[0]?.chave || null;
  }, [mesAba, abas]);

  // ── Busca: número, nome ou dia de vencimento, num campo só ──
  // Termo numérico casa com o código do condomínio E com o dia do vencimento —
  // obrigar a escolher o tipo seria uma pergunta a mais para quem só quer achar.
  const lista = useMemo(() => {
    const termo = busca.trim();
    const num = soDigitos(termo);
    const texto = semAcento(termo);

    return remessas
      .filter(r => `${r.ano_referencia}-${String(r.mes_referencia).padStart(2, '0')}` === abaAtiva)
      .filter(r => {
        if (filtro === 'sem_filipeta') return r.faltaFilipeta;
        const pendente = r.docs.some(b => !b.impresso_em);
        return filtro === 'pendentes' ? pendente : !pendente;
      })
      .filter(r => {
        if (!termo) return true;
        const nome = semAcento(r.condominios?.name);
        if (texto && nome.includes(texto)) return true;
        if (!num) return false;
        const codigo = soDigitos((r.condominios?.name || '').split('-')[0]);
        if (codigo && parseInt(codigo, 10) === parseInt(num, 10)) return true;
        return r.vencimento != null && r.vencimento === parseInt(num, 10);
      })
      .sort((a, b) => (a.vencimento ?? 99) - (b.vencimento ?? 99)
        || String(a.condominios?.name || '').localeCompare(String(b.condominios?.name || '')));
  }, [remessas, abaAtiva, filtro, busca]);

  // ── Ações ──
  async function imprimir(r) {
    if (r.docs.length === 1) {
      const ok = await abrirArquivoSeguro(r.docs[0].arquivo_url);
      if (!ok) addToast('Não consegui abrir o arquivo.', 'error');
      return;
    }
    // Vários: abrir tudo de uma vez esbarra no bloqueador de pop-up do
    // navegador. Abre a lista e a pessoa clica em cada um.
    setExpandido(e => (e === r.id ? null : r.id));
  }

  async function marcar(r, impresso) {
    // A baixa é da REMESSA inteira: boleto e filipeta saem na mesma impressão,
    // e deixar a filipeta pendente sozinha faria a linha voltar para a fila
    // sem nada para fazer nela.
    const ids = r.docs.map(b => b.id);
    const payload = impresso
      ? { impresso_em: new Date().toISOString(), impresso_por_nome: user?.full_name || user?.email || null }
      : { impresso_em: null, impresso_por_nome: null };

    setMarcando(r.id);
    setRemessas(prev => prev.map(x => (x.id === r.id
      ? {
          ...x,
          docs: x.docs.map(b => ({ ...b, ...payload })),
          boletos: x.boletos.map(b => ({ ...b, ...payload })),
          filipetas: x.filipetas.map(b => ({ ...b, ...payload })),
        }
      : x)));

    const { error } = await supabase.from('emissoes_arquivos').update(payload).in('id', ids);
    setMarcando(null);
    if (error) { addToast('Não consegui dar baixa: ' + error.message, 'error'); fetchFila(); return; }
    addToast(impresso ? 'Baixa registrada.' : 'Voltou para a fila.', 'success');
  }

  // Quantos condomínios estão sem a filipeta que deveriam ter, no mês aberto.
  // Zero esconde o filtro: aviso que fica na tela sem nunca acender é ruído.
  const semFilipeta = useMemo(
    () => remessas.filter(r =>
      `${r.ano_referencia}-${String(r.mes_referencia).padStart(2, '0')}` === abaAtiva
      && r.faltaFilipeta).length,
    [remessas, abaAtiva],
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2.5">
        <Printer className="w-5 h-5 text-violet-500" aria-hidden="true" />
        <h3 className="text-base font-semibold text-slate-900">Expedição</h3>
      </div>

      {/* Abas por mês */}
      {abas.length > 0 && (
        <div className="flex gap-1 border-b border-slate-200 overflow-x-auto scrollbar-thin">
          {abas.map(a => (
            <button key={a.chave} type="button" onClick={() => setMesAba(a.chave)}
              aria-current={abaAtiva === a.chave ? 'true' : undefined}
              className={`shrink-0 px-3.5 py-2 text-sm transition-colors border-b-2 -mb-px ${
                abaAtiva === a.chave
                  ? 'border-violet-600 text-violet-700 font-semibold'
                  : 'border-transparent text-slate-500 hover:text-slate-800'}`}>
              {MESES[a.mes]}/{String(a.ano).slice(-2)}
              {a.pendentes > 0 && (
                <span className="ml-1.5 rounded-md bg-amber-100 border border-amber-300 px-1.5 text-[11px] font-bold text-amber-800">
                  {a.pendentes}
                </span>
              )}
            </button>
          ))}
        </div>
      )}

      <div className="flex gap-2.5 items-center flex-wrap">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" aria-hidden="true" />
          <input value={busca} onChange={e => setBusca(e.target.value)}
            placeholder="Número, nome ou dia de vencimento" aria-label="Buscar por número, nome ou dia de vencimento"
            className="w-full bg-white border border-slate-200 rounded-xl pl-9 pr-8 py-2.5 text-sm text-slate-800 outline-none focus:border-violet-500" />
          {busca && (
            <button type="button" onClick={() => setBusca('')} aria-label="Limpar busca"
              className="absolute right-2.5 top-1/2 -translate-y-1/2 p-0.5 text-slate-400 hover:text-slate-700">
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
        <div className="inline-flex border border-slate-200 rounded-xl overflow-hidden shrink-0">
          {[{ id: 'pendentes', r: 'A imprimir' },
            { id: 'impressos', r: 'Impressos' },
            ...(semFilipeta > 0 ? [{ id: 'sem_filipeta', r: `Sem filipeta (${semFilipeta})` }] : []),
          ].map(f => (
            <button key={f.id} type="button" onClick={() => setFiltro(f.id)} aria-pressed={filtro === f.id}
              className={`px-3.5 py-2 text-xs transition-colors ${
                filtro === f.id ? 'bg-violet-600 text-white font-semibold' : 'bg-white text-slate-600 hover:bg-slate-100'}`}>
              {f.r}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-violet-500" /></div>
      ) : lista.length === 0 ? (
        <div className="py-16 text-center">
          <Inbox className="w-12 h-12 text-slate-300 mx-auto mb-3" aria-hidden="true" />
          <p className="text-slate-500 font-medium">
            {busca ? 'Nada encontrado com esse termo.'
              : filtro === 'sem_filipeta' ? 'Toda remessa deste mês veio com a filipeta.'
              : filtro === 'pendentes' ? 'Nada para imprimir neste mês.'
              : 'Nada foi impresso neste mês ainda.'}
          </p>
        </div>
      ) : (
        <div className="border border-slate-200 rounded-2xl overflow-hidden divide-y divide-slate-200">
          {lista.map(r => {
            const impresso = r.docs.every(b => b.impresso_em);
            const marca = r.docs.find(b => b.impresso_em);
            const aberto = expandido === r.id;
            return (
              <div key={r.id} className={impresso ? 'bg-slate-50' : 'bg-white'}>
                <div className="flex items-center gap-3 px-4 py-3 flex-wrap">
                  <span className="w-14 shrink-0 text-center text-xs text-slate-600 border border-slate-200 rounded-lg py-1"
                        title="Dia de vencimento dos boletos desta remessa">
                    {r.vencimento ? `dia ${r.vencimento}` : '—'}
                  </span>

                  <div className="flex-1 min-w-0">
                    <p className={`text-sm truncate ${impresso ? 'text-slate-500' : 'font-semibold text-slate-900'}`}>
                      {r.condominios?.name || 'Condomínio'}
                      <TagPrioritario condo={r.condominios} mes={r.mes_referencia} ano={r.ano_referencia} className="ml-2" />
                      {r.grupo_nome && (
                        <span className="ml-2 rounded-md border border-violet-200 bg-violet-50 px-1.5 py-0.5 text-[11px] font-semibold text-violet-700">
                          {r.grupo_nome}
                        </span>
                      )}
                    </p>
                    <p className="text-[11px] text-slate-500">
                      {r.boletos.length} boleto{r.boletos.length !== 1 ? 's' : ''}
                      {r.filipetas.length > 0 && ` · ${r.filipetas.length} filipeta${r.filipetas.length !== 1 ? 's' : ''}`}
                      {r.faltaFilipeta && (
                        <span className="ml-2 rounded-md border border-amber-300 bg-amber-50 px-1.5 py-0.5 text-[10px] font-bold text-amber-800"
                              title="Este condomínio manda filipeta todo mês e ela não veio nesta remessa">
                          FALTA A FILIPETA
                        </span>
                      )}
                    </p>
                  </div>

                  <button type="button" onClick={() => verOrigem(r)}
                    aria-expanded={origem?.pacoteId === r.id}
                    title="Ver a emissão que gerou estes boletos"
                    className={`shrink-0 inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs transition-colors ${
                      origem?.pacoteId === r.id
                        ? 'border-violet-300 bg-violet-50 text-violet-700'
                        : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-100'}`}>
                    <FolderOpen className="w-3.5 h-3.5" /> A emissão
                  </button>

                  {impresso ? (
                    <>
                      <span className="rounded-md border border-emerald-300 bg-emerald-50 px-2 py-1 text-[11px] font-bold text-emerald-800 shrink-0"
                            title={marca?.impresso_por_nome ? `Baixa dada por ${marca.impresso_por_nome}` : undefined}>
                        <Check className="w-3 h-3 inline -mt-0.5 mr-1" />
                        {fmtData(marca?.impresso_em)}{marca?.impresso_por_nome ? ` · ${marca.impresso_por_nome.split(' ')[0]}` : ''}
                      </span>
                      <button type="button" onClick={() => imprimir(r)}
                        className="shrink-0 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-600 hover:bg-slate-100 transition-colors">
                        Reimprimir
                      </button>
                      <button type="button" onClick={() => marcar(r, false)} aria-label="Voltar para a fila"
                        title="Voltar para a fila de impressão"
                        className="shrink-0 p-1.5 rounded-lg text-slate-400 hover:text-violet-600 hover:bg-slate-100 transition-colors">
                        <RotateCcw className="w-4 h-4" />
                      </button>
                    </>
                  ) : (
                    <>
                      <button type="button" onClick={() => imprimir(r)}
                        className="shrink-0 inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100 transition-colors">
                        <Printer className="w-3.5 h-3.5" /> Imprimir
                      </button>
                      <button type="button" onClick={() => marcar(r, true)} disabled={marcando === r.id}
                        className="shrink-0 inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-emerald-700 transition-colors disabled:opacity-50">
                        {marcando === r.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                        Impresso
                      </button>
                    </>
                  )}
                </div>

                {origem?.pacoteId === r.id && (
                  <div className="px-4 pb-3 pl-20">
                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                      <div className="flex items-center justify-between gap-2 mb-2 flex-wrap">
                        <p className="text-[11px] font-bold uppercase tracking-widest text-slate-500">
                          O que veio na emissão
                        </p>
                        {podeAbrirEmissao && (
                          <Link
                            href={`/central-emissoes?tab=upload&condo=${r.condominio_id}&mes=${r.mes_referencia}&ano=${r.ano_referencia}&pacote=${r.id}`}
                            className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-violet-700 hover:underline">
                            <ExternalLink className="w-3.5 h-3.5" /> Abrir na emissão
                          </Link>
                        )}
                      </div>
                      {origem.carregando ? (
                        <Loader2 className="w-4 h-4 animate-spin text-violet-500" />
                      ) : origem.arquivos.length === 0 ? (
                        <p className="text-xs text-slate-500">Esta emissão não tem outros arquivos além dos boletos.</p>
                      ) : (
                        <div className="space-y-1">
                          {origem.arquivos.map(a => (
                            <button key={a.id} type="button" onClick={() => abrirArquivoSeguro(a.arquivo_url)}
                              className="flex items-center gap-2 text-xs text-slate-600 hover:text-violet-700 hover:underline text-left">
                              <FileText className="w-3.5 h-3.5 text-slate-400 shrink-0" aria-hidden="true" />
                              <span className="truncate">{a.arquivo_nome}</span>
                              {a.categoria && (
                                <span className="shrink-0 rounded border border-slate-200 bg-white px-1 text-[10px] text-slate-500">
                                  {a.categoria}
                                </span>
                              )}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* Mais de um arquivo: abre a lista em vez de disparar várias
                    abas de uma vez, que o navegador bloquearia. */}
                {aberto && r.docs.length > 1 && (
                  <div className="px-4 pb-3 pl-20 space-y-1">
                    {r.docs.map(b => (
                      <button key={b.id} type="button" onClick={() => abrirArquivoSeguro(b.arquivo_url)}
                        className="flex items-center gap-2 text-xs text-slate-600 hover:text-violet-700 hover:underline">
                        <FileText className={`w-3.5 h-3.5 shrink-0 ${
                          b.categoria === 'filipeta' ? 'text-amber-500' : 'text-violet-500'}`} aria-hidden="true" />
                        <span className="truncate">{b.arquivo_nome}</span>
                        {b.categoria === 'filipeta' && (
                          <span className="shrink-0 rounded border border-amber-200 bg-amber-50 px-1 text-[10px] font-bold text-amber-700">
                            filipeta
                          </span>
                        )}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
