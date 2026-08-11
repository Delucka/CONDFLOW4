'use client';
import { useState, useEffect, useMemo, useCallback } from 'react';
import { createClient } from '@/utils/supabase/client';
import { useAuth } from '@/lib/auth';
import { useToast } from '@/components/Toast';
import { abrirArquivoSeguro } from '@/lib/arquivo';
import { montarZipEmissao } from '@/lib/extrairEmissao';
import { useRevalidarAoVoltar } from '@/lib/useRevalidarAoVoltar';
import SeloGrupo from './SeloGrupo';
import { anexarGrupos } from '@/lib/conjuntoEmissao';
import {
  Printer, Check, Loader2, Inbox, Archive, FileText, Search, RotateCcw,
} from 'lucide-react';

/**
 * Fila de impressão da expedição.
 *
 * O que ela resolve: até aqui, o único marco era o pacote inteiro virar
 * 'expedida'. Grosso demais — um pacote tem vários documentos, a impressão
 * acontece aos poucos, e quem volta de um intervalo não sabe onde parou. Sem
 * marca, o jeito de não imprimir duas vezes é lembrar.
 *
 * A baixa é por DOCUMENTO e não arquiva nada: o arquivo continua ali para
 * reimpressão e consulta. É carimbo, não gaveta.
 */

const FILTROS = [
  { id: 'pendentes', rotulo: 'A imprimir' },
  { id: 'impressos', rotulo: 'Impressos' },
  { id: 'todos',     rotulo: 'Todos' },
];

const fmtData = (iso) => iso
  ? new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })
  : null;

export default function Expedicao() {
  const supabase = useMemo(() => createClient(), []);
  const { user } = useAuth();
  const { addToast } = useToast();

  const [pacotes, setPacotes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filtro, setFiltro] = useState('pendentes');
  const [busca, setBusca] = useState('');
  const [marcando, setMarcando] = useState(null);   // id do arquivo (ou 'pacote:<id>')
  const [zipando, setZipando] = useState(null);
  const [prog, setProg] = useState(null);

  const fetchFila = useCallback(async () => {
    setLoading(true);
    try {
      // A expedição começa quando a emissão é registrada. 'expedida' continua na
      // lista: reimpressão e consulta são o motivo de nada sumir daqui.
      const { data, error } = await supabase
        .from('emissoes_pacotes')
        .select('id, condominio_id, mes_referencia, ano_referencia, status, grupo_id, condominios(name)')
        .in('status', ['registrado', 'expedida'])
        .order('ano_referencia', { ascending: false })
        .order('mes_referencia', { ascending: false });
      if (error) throw error;

      const ids = (data || []).map(p => p.id);
      let porPacote = {};
      if (ids.length) {
        const { data: arqs } = await supabase
          .from('emissoes_arquivos')
          .select('id, pacote_id, arquivo_nome, arquivo_url, formato, categoria, subtipo, impresso_em, impresso_por_nome, ordem, criado_em')
          .in('pacote_id', ids)
          .order('ordem', { ascending: true, nullsFirst: false })
          .order('criado_em', { ascending: true });
        (arqs || []).forEach(a => { (porPacote[a.pacote_id] = porPacote[a.pacote_id] || []).push(a); });
      }

      const comGrupo = await anexarGrupos(supabase, data || []);
      setPacotes(comGrupo.map(p => ({ ...p, arquivos: porPacote[p.id] || [] })));
    } catch (e) {
      addToast('Erro ao carregar a fila: ' + (e.message || e), 'error');
      setPacotes([]);
    } finally {
      setLoading(false);
    }
  }, [supabase, addToast]);

  useEffect(() => {
    fetchFila();
    const ch = supabase.channel(`expedicao_${Math.random().toString(36).slice(2)}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'emissoes_arquivos' }, fetchFila)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'emissoes_pacotes' }, fetchFila)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [supabase, fetchFila]);

  useRevalidarAoVoltar(fetchFila);

  // ── Baixa ──
  // Guarda quem carimbou: quando alguém perguntar "isso já saiu?", a resposta
  // tem nome e hora, não "acho que sim".
  async function marcar(arquivos, impresso) {
    const ids = arquivos.map(a => a.id);
    if (!ids.length) return;
    const payload = impresso
      ? { impresso_em: new Date().toISOString(), impresso_por_nome: user?.full_name || user?.email || null }
      : { impresso_em: null, impresso_por_nome: null };

    // Otimista: a fila reage na hora e o banco confirma atrás.
    setPacotes(prev => prev.map(p => ({
      ...p,
      arquivos: p.arquivos.map(a => (ids.includes(a.id) ? { ...a, ...payload } : a)),
    })));

    const { error } = await supabase.from('emissoes_arquivos').update(payload).in('id', ids);
    if (error) {
      addToast('Não consegui dar baixa: ' + error.message, 'error');
      fetchFila();
      return;
    }
    addToast(impresso
      ? `${ids.length} documento${ids.length > 1 ? 's' : ''} marcado${ids.length > 1 ? 's' : ''} como impresso.`
      : 'Voltou para a fila de impressão.', 'success');
  }

  async function abrir(a) {
    const ok = await abrirArquivoSeguro(a.arquivo_url);
    if (!ok) addToast('Não consegui abrir este arquivo.', 'error');
  }

  // ZIP com os originais: imprimir em lote sem abrir um a um. Não dá baixa
  // sozinho — baixar não é imprimir, e supor isso marcaria o que ficou na fila
  // da impressora.
  async function baixarZip(p, lista) {
    if (!lista.length) return;
    setZipando(p.id);
    try {
      const { blob, pulados } = await montarZipEmissao(lista, (i, n, nome) => setProg({ i, n, nome }));
      const { saveAs } = await import('file-saver');
      const base = `${(p.condominios?.name || 'emissao').replace(/[^\w]+/g, '_')}_${String(p.mes_referencia).padStart(2, '0')}-${p.ano_referencia}`;
      saveAs(blob, `${base}_boletos.zip`);
      if (pulados?.length) addToast(`${pulados.length} arquivo(s) não entraram no ZIP.`, 'warning');
    } catch (e) {
      addToast('Erro ao montar o ZIP: ' + (e.message || e), 'error');
    } finally {
      setZipando(null); setProg(null);
    }
  }

  // ── Filtro ──
  const lista = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    return pacotes
      .map(p => {
        const arquivos = p.arquivos.filter(a =>
          filtro === 'todos' ? true : filtro === 'impressos' ? !!a.impresso_em : !a.impresso_em);
        return { ...p, visiveis: arquivos };
      })
      .filter(p => p.visiveis.length > 0)
      .filter(p => !termo || (p.condominios?.name || '').toLowerCase().includes(termo));
  }, [pacotes, filtro, busca]);

  const totalPendentes = useMemo(
    () => pacotes.reduce((s, p) => s + p.arquivos.filter(a => !a.impresso_em).length, 0),
    [pacotes],
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <Printer className="w-5 h-5 text-violet-500" aria-hidden="true" />
          <h3 className="text-base font-semibold text-slate-900">Expedição</h3>
          {totalPendentes > 0 && (
            <span className="rounded-full bg-amber-100 border border-amber-300 px-2 py-0.5 text-[11px] font-bold text-amber-800">
              {totalPendentes} a imprimir
            </span>
          )}
        </div>
        <div className="inline-flex border border-slate-200 rounded-xl overflow-hidden">
          {FILTROS.map(f => (
            <button key={f.id} type="button" onClick={() => setFiltro(f.id)} aria-pressed={filtro === f.id}
              className={`px-3 py-1.5 text-xs transition-colors ${
                filtro === f.id ? 'bg-violet-600 text-white font-semibold' : 'bg-white text-slate-600 hover:bg-slate-100'}`}>
              {f.rotulo}
            </button>
          ))}
        </div>
      </div>

      <div className="relative">
        <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" aria-hidden="true" />
        <input value={busca} onChange={e => setBusca(e.target.value)}
          placeholder="Buscar condomínio…" aria-label="Buscar condomínio"
          className="w-full bg-white border border-slate-200 rounded-xl pl-9 pr-3 py-2.5 text-sm text-slate-800 outline-none focus:border-violet-500" />
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="w-6 h-6 animate-spin text-violet-500" />
        </div>
      ) : lista.length === 0 ? (
        <div className="py-16 text-center">
          <Inbox className="w-12 h-12 text-slate-300 mx-auto mb-3" aria-hidden="true" />
          <p className="text-slate-500 font-medium">
            {filtro === 'pendentes' ? 'Nada na fila de impressão.'
              : filtro === 'impressos' ? 'Nada foi marcado como impresso ainda.'
              : 'Nenhuma emissão registrada.'}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {lista.map(p => {
            const pendentes = p.visiveis.filter(a => !a.impresso_em);
            return (
              <div key={p.id} className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
                <div className="px-4 py-3 bg-slate-50 border-b border-slate-200 flex items-center justify-between gap-3 flex-wrap">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-slate-900 flex items-center gap-2 flex-wrap">
                      {p.condominios?.name || 'Condomínio'}
                      <SeloGrupo pacote={p} />
                    </p>
                    <p className="text-[11px] text-slate-500">
                      {String(p.mes_referencia).padStart(2, '0')}/{p.ano_referencia} · {p.visiveis.length} documento{p.visiveis.length !== 1 ? 's' : ''}
                      {pendentes.length > 0 && <span className="text-amber-700 font-bold"> · {pendentes.length} a imprimir</span>}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button type="button" onClick={() => baixarZip(p, p.visiveis)} disabled={zipando === p.id}
                      title="Baixa os originais num ZIP, para imprimir em lote"
                      className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100 transition-colors disabled:opacity-50">
                      {zipando === p.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Archive className="w-3.5 h-3.5" />}
                      ZIP
                    </button>
                    {pendentes.length > 0 && (
                      <button type="button" onClick={() => marcar(pendentes, true)}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-emerald-700 transition-colors">
                        <Check className="w-3.5 h-3.5" />
                        Dar baixa em {pendentes.length}
                      </button>
                    )}
                  </div>
                </div>

                <div className="divide-y divide-slate-100">
                  {p.visiveis.map(a => (
                    <div key={a.id} className="px-4 py-2.5 flex items-center gap-3 flex-wrap">
                      <button type="button" onClick={() => abrir(a)}
                        title="Abrir para imprimir ou consultar"
                        className="flex items-center gap-2 min-w-0 text-left group">
                        <FileText className="w-4 h-4 text-violet-500 shrink-0" aria-hidden="true" />
                        <span className="text-sm text-slate-800 truncate group-hover:text-violet-700 group-hover:underline">
                          {a.arquivo_nome}
                        </span>
                      </button>

                      {a.impresso_em ? (
                        <span className="ml-auto flex items-center gap-2 shrink-0">
                          <span className="inline-flex items-center gap-1 rounded-md border border-emerald-300 bg-emerald-50 px-1.5 py-0.5 text-[11px] font-bold text-emerald-800"
                                title={a.impresso_por_nome ? `Baixa dada por ${a.impresso_por_nome}` : undefined}>
                            <Check className="w-3 h-3" /> impresso {fmtData(a.impresso_em)}
                          </span>
                          <button type="button" onClick={() => marcar([a], false)}
                            title="Voltar para a fila de impressão"
                            className="p-1 rounded-md text-slate-400 hover:text-violet-600 hover:bg-slate-100 transition-colors">
                            <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
                          </button>
                        </span>
                      ) : (
                        <button type="button" onClick={() => marcar([a], true)} disabled={marcando === a.id}
                          className="ml-auto shrink-0 inline-flex items-center gap-1.5 rounded-lg border border-emerald-300 bg-white px-2.5 py-1 text-[11px] font-bold text-emerald-700 hover:bg-emerald-50 transition-colors">
                          <Check className="w-3.5 h-3.5" /> Marcar impresso
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {prog && (
        <div className="fixed inset-0 z-[120] flex items-center justify-center bg-slate-900/50 backdrop-blur-sm">
          <div className="bg-white rounded-2xl p-6 shadow-2xl text-center max-w-xs">
            <Loader2 className="w-8 h-8 text-violet-500 animate-spin mx-auto mb-3" />
            <p className="text-sm font-semibold text-slate-900">Montando o ZIP…</p>
            <p className="text-xs text-slate-500 mt-1 truncate">{prog.i}/{prog.n} · {prog.nome}</p>
          </div>
        </div>
      )}
    </div>
  );
}
