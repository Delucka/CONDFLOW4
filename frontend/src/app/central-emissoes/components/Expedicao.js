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
 * Central de expedição — a fila de impressão dos boletos.
 *
 * Uma linha por REMESSA, não por documento: condomínio de dois vencimentos tem
 * duas remessas no mesmo mês, com boletos diferentes e datas diferentes, e a
 * expedição trata cada uma como um trabalho separado.
 *
 * Boleto aqui é `emissoes_arquivos.categoria = 'boleto'` — os arquivos que o
 * emissor anexa no "Expedir", depois de registrar. O resto do pacote (planilha,
 * faturas, rateio) não é assunto de quem imprime.
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
  const [filtro, setFiltro] = useState('pendentes');
  const [busca, setBusca] = useState('');
  const [expandido, setExpandido] = useState(null);
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
          .select('id, pacote_id, arquivo_nome, arquivo_url, impresso_em, impresso_por_nome, ordem, criado_em')
          .in('pacote_id', ids)
          // `categoria = 'boleto'` (0095) é o que o "Expedir" anexa. Antes o
          // código marcava `status: 'expedida'`, valor que o enum nem aceita —
          // o insert falhava calado e nenhum boleto chegou à tabela.
          .eq('categoria', 'boleto')
          .order('ordem', { ascending: true, nullsFirst: false })
          .order('criado_em', { ascending: true });
        (arqs || []).forEach(a => { (porPacote[a.pacote_id] = porPacote[a.pacote_id] || []).push(a); });
      }

      const comGrupo = await anexarGrupos(supabase, pacs || []);
      // Pacote sem boleto anexado não é trabalho de expedição — ainda está com
      // quem emite. Some da fila em vez de virar linha vazia.
      const lista = comGrupo
        .map(p => ({
          ...p,
          boletos: porPacote[p.id] || [],
          vencimento: p.grupo_due_day ?? p.condominios?.due_day ?? null,
        }))
        .filter(p => p.boletos.length > 0);

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
      atual.pendentes += r.boletos.filter(b => !b.impresso_em).length ? 1 : 0;
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
        const pendente = r.boletos.some(b => !b.impresso_em);
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
    if (r.boletos.length === 1) {
      const ok = await abrirArquivoSeguro(r.boletos[0].arquivo_url);
      if (!ok) addToast('Não consegui abrir o arquivo.', 'error');
      return;
    }
    // Vários: abrir tudo de uma vez esbarra no bloqueador de pop-up do
    // navegador. Abre a lista e a pessoa clica em cada um.
    setExpandido(e => (e === r.id ? null : r.id));
  }

  async function marcar(r, impresso) {
    const ids = r.boletos.map(b => b.id);
    const payload = impresso
      ? { impresso_em: new Date().toISOString(), impresso_por_nome: user?.full_name || user?.email || null }
      : { impresso_em: null, impresso_por_nome: null };

    setMarcando(r.id);
    setRemessas(prev => prev.map(x => (x.id === r.id
      ? { ...x, boletos: x.boletos.map(b => ({ ...b, ...payload })) } : x)));

    const { error } = await supabase.from('emissoes_arquivos').update(payload).in('id', ids);
    setMarcando(null);
    if (error) { addToast('Não consegui dar baixa: ' + error.message, 'error'); fetchFila(); return; }
    addToast(impresso ? 'Baixa registrada.' : 'Voltou para a fila.', 'success');
  }

  const totalBoletos = (r) => r.boletos.length;

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
          {[{ id: 'pendentes', r: 'A imprimir' }, { id: 'impressos', r: 'Impressos' }].map(f => (
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
              : filtro === 'pendentes' ? 'Nada para imprimir neste mês.'
              : 'Nada foi impresso neste mês ainda.'}
          </p>
        </div>
      ) : (
        <div className="border border-slate-200 rounded-2xl overflow-hidden divide-y divide-slate-200">
          {lista.map(r => {
            const impresso = r.boletos.every(b => b.impresso_em);
            const marca = r.boletos.find(b => b.impresso_em);
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
                      {totalBoletos(r)} arquivo{totalBoletos(r) !== 1 ? 's' : ''} de boleto
                    </p>
                  </div>

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

                {/* Mais de um arquivo: abre a lista em vez de disparar várias
                    abas de uma vez, que o navegador bloquearia. */}
                {aberto && r.boletos.length > 1 && (
                  <div className="px-4 pb-3 pl-20 space-y-1">
                    {r.boletos.map(b => (
                      <button key={b.id} type="button" onClick={() => abrirArquivoSeguro(b.arquivo_url)}
                        className="flex items-center gap-2 text-xs text-slate-600 hover:text-violet-700 hover:underline">
                        <FileText className="w-3.5 h-3.5 text-violet-500 shrink-0" aria-hidden="true" />
                        {b.arquivo_nome}
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
