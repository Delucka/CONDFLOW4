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
import { Printer, Check, Loader2, Inbox, Search, RotateCcw, FileText, X } from 'lucide-react';

/**
 * Central de expedição — a fila de impressão.
 *
 * Duas etapas, e a baixa é dada na hora de imprimir:
 *
 *   a imprimir  →  impresso
 *
 * Houve uma terceira, "entregue", com data e nome de quem recebeu. Saiu a
 * pedido de quem usa: a baixa acontece na impressão, e a data de entrega não é
 * informação que alguém vá consultar. Um passo a mais na tela é um passo a
 * mais para esquecer.
 *
 * As colunas continuam no banco (0111) e o endpoint de pé — se um dia a
 * entrega precisar de registro, é devolver os botões.
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
  const { user } = useAuth();
  const { addToast } = useToast();

  const [remessas, setRemessas] = useState([]);
  const [loading, setLoading] = useState(true);
  // Ver o comentário em fetchFila(): distingue primeira carga de rebusca.
  const jaCarregouRef = useRef(false);
  const [mesAba, setMesAba] = useState(null);      // "2026-09"
  const [filtro, setFiltro] = useState('a_imprimir');
  const [busca, setBusca] = useState('');
  const [marcando, setMarcando] = useState(null);
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
        .select('id, condominio_id, mes_referencia, ano_referencia, status, grupo_id, condominios(name, due_day, prazo_expedicao_dia, prioridade_motivo)')
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

      // `usa_filipeta` (0110) vem numa consulta à parte de propósito: se a
      // migration não rodou, o pedido falha sozinho e a fila continua inteira —
      // em vez de a coluna nova derrubar a consulta que traz o trabalho do dia.
      const cfRes = await supabase.from('condominios').select('id').eq('usa_filipeta', true);
      const mandaFilipeta = new Set((cfRes?.data || []).map(c => c.id));

      const comGrupo = await anexarGrupos(supabase, pacs || []);
      // Pacote sem nada anexado não é trabalho de expedição — ainda está com
      // quem emite. Some da fila em vez de virar linha vazia.
      const lista = comGrupo
        .map(p => {
          const docs = porPacote[p.id] || [];
          const filipetas = docs.filter(d => d.categoria === 'filipeta');
          // Uma regra só para a linha, o filtro e a contagem da aba nunca
          // discordarem sobre onde a remessa está.
          const etapa = docs.every(d => d.impresso_em) ? 'impresso' : 'imprimir';
          return {
            ...p,
            etapa,
            docs,
            boletos: docs.filter(d => d.categoria !== 'filipeta'),
            filipetas,
            // Deveria ter filipeta e não tem. É o único estado desta tela que
            // pede alguém fazer alguma coisa ANTES de imprimir.
            faltaFilipeta: mandaFilipeta.has(p.condominio_id) && filipetas.length === 0,
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
      atual.pendentes += r.etapa === 'imprimir' ? 1 : 0;
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
        if (filtro === 'a_imprimir') return r.etapa === 'imprimir';
        return r.etapa === 'impresso';
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
    if (!r.docs.length) return;
    const ok = await abrirArquivoSeguro(r.docs[0].arquivo_url);
    if (!ok) { addToast('Não consegui abrir o arquivo.', 'error'); return; }
    // Abrir todos de uma vez esbarra no bloqueador de pop-up. Os outros estão
    // à vista na própria linha — só avisa que existem.
    if (r.docs.length > 1) {
      addToast(`Abri o primeiro. Os outros ${r.docs.length - 1} estão na linha, é só clicar.`, 'info');
    }
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

  // As duas etapas do mês aberto, contadas de uma vez.
  //
  // "Quantos faltam" é a primeira pergunta de quem senta para trabalhar, e a
  // resposta estava escondida atrás de clicar em cada filtro e contar linha.
  const contagem = useMemo(() => {
    const doMes = remessas.filter(r =>
      `${r.ano_referencia}-${String(r.mes_referencia).padStart(2, '0')}` === abaAtiva);
    return {
      imprimir: doMes.filter(r => r.etapa === 'imprimir').length,
      impresso: doMes.filter(r => r.etapa === 'impresso').length,
      total: doMes.length,
    };
  }, [remessas, abaAtiva]);

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
        {contagem.total > 0 && (
          <p className="text-xs text-slate-500">
            {contagem.imprimir > 0 ? (
              <>
                <span className="font-bold text-slate-800">
                  {contagem.imprimir} de {contagem.total}
                </span> ainda não {contagem.imprimir === 1 ? 'foi impressa' : 'foram impressas'}
              </>
            ) : (
              <span className="font-bold text-emerald-700">
                Tudo impresso neste mês ({contagem.total})
              </span>
            )}
          </p>
        )}
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
        {/* Rola em vez de ser cortado. Os três filtros somam mais que a
            largura de um celular, e o `overflow-x-hidden` da casca mobile
            recortava o terceiro — "Sem filipeta" ficava invisível e sem
            nenhuma forma de alcançar. */}
        <div className="shrink-0 max-w-full overflow-x-auto scrollbar-thin">
          <div className="inline-flex border border-slate-200 rounded-xl overflow-hidden">
            {[{ id: 'a_imprimir', r: `A imprimir (${contagem.imprimir})` },
              { id: 'impressos', r: `Impressos (${contagem.impresso})` },
              ...(semFilipeta > 0 ? [{ id: 'sem_filipeta', r: `Sem filipeta (${semFilipeta})` }] : []),
            ].map(f => (
              <button key={f.id} type="button" onClick={() => setFiltro(f.id)} aria-pressed={filtro === f.id}
                className={`px-3.5 py-2 text-xs whitespace-nowrap transition-colors ${
                  filtro === f.id ? 'bg-violet-600 text-white font-semibold' : 'bg-white text-slate-600 hover:bg-slate-100'}`}>
                {f.r}
              </button>
            ))}
          </div>
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
              : filtro === 'a_imprimir' ? 'Nada para imprimir neste mês.'
              : 'Nada foi impresso neste mês ainda.'}
          </p>
        </div>
      ) : (
        <div className="border border-slate-200 rounded-2xl overflow-hidden divide-y divide-slate-200">
          {lista.map(r => {
            const impresso = r.etapa === 'impresso';
            const marca = r.docs.find(b => b.impresso_em);
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
                    {/* Os arquivos ficam à vista, impressos ou não. Depois da
                        baixa eles sumiam, e reler o boleto exigia apertar
                        "Reimprimir" — um botão que anuncia outra coisa. */}
                    <div className="flex items-center gap-1.5 flex-wrap mt-1">
                      {r.docs.map(b => (
                        <button key={b.id} type="button" onClick={() => abrirArquivoSeguro(b.arquivo_url)}
                          title={`Abrir ${b.arquivo_nome}`}
                          className={`inline-flex items-center gap-1.5 max-w-[260px] rounded-lg border px-2 py-1 text-[11px] transition-colors ${
                            b.categoria === 'filipeta'
                              ? 'border-amber-200 bg-amber-50 text-amber-800 hover:bg-amber-100'
                              : 'border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100'}`}>
                          <FileText className={`w-3.5 h-3.5 shrink-0 ${
                            b.categoria === 'filipeta' ? 'text-amber-500' : 'text-violet-500'}`} aria-hidden="true" />
                          <span className="truncate">{b.arquivo_nome}</span>
                        </button>
                      ))}
                      {r.faltaFilipeta && (
                        <span className="rounded-md border border-amber-300 bg-amber-50 px-1.5 py-0.5 text-[10px] font-bold text-amber-800"
                              title="Este condomínio manda filipeta todo mês e ela não veio nesta remessa">
                          FALTA A FILIPETA
                        </span>
                      )}
                    </div>
                  </div>

                  {impresso ? (
                    <>
                      <span className="rounded-md border border-emerald-300 bg-emerald-50 px-2 py-1 text-[11px] font-bold text-emerald-800 shrink-0"
                            title={marca?.impresso_por_nome ? `Baixa dada por ${marca.impresso_por_nome}` : undefined}>
                        <Check className="w-3 h-3 inline -mt-0.5 mr-1" />
                        Impresso {fmtData(marca?.impresso_em)}
                        {marca?.impresso_por_nome ? ` · ${marca.impresso_por_nome.split(' ')[0]}` : ''}
                      </span>
                      <button type="button" onClick={() => imprimir(r)}
                        className="shrink-0 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-600 hover:bg-slate-100 transition-colors">
                        Reimprimir
                      </button>
                      <button type="button" onClick={() => marcar(r, false)} aria-label="Voltar para a fila de impressão"
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

              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
