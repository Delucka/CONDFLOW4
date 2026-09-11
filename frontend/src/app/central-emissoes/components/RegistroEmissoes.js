'use client';
import FiltroVencimento from '@/components/FiltroVencimento';
import { passaVencimento } from '@/lib/vencimento';
import { useState, useEffect, useMemo } from 'react';
import { createClient } from '@/utils/supabase/client';
import { MarcaDaguaCancelada } from '@/components/SeloCancelada';
import ModalCancelarEmissao from './ModalCancelarEmissao';
import { useToast } from '@/components/Toast';
import { useAuth } from '@/lib/auth';
import { getArquivoUrlSeguro } from '@/lib/arquivo';
import { Archive, Search, Eye, RefreshCw, ChevronLeft, ChevronRight, X, Lock, FileText, AlertTriangle, Loader2, Building, Download, FileDown, Trash2, Ban } from 'lucide-react';
import JSZip from 'jszip';
import { saveAs } from 'file-saver';
import VisualizadorConferencia from '@/components/VisualizadorConferencia';
import { ordenarParaExtracao, montarPdfEmissao, montarZipEmissao } from '@/lib/extrairEmissao';
import { apiFetch, apiPost } from '@/lib/api';
import { anexarGrupos } from '@/lib/conjuntoEmissao';
import { condosDaCarteira } from '@/lib/carteira';
import SeloGrupo from './SeloGrupo';

// Dia de vencimento de uma emissão: o do GRUPO quando ela tem grupo (é o que
// sai no boleto); senão, o do cadastro — os dois, se o vencimento é dividido.
const vencDoPacote = (p) => p?.grupo_due_day ?? [p?.condominios?.due_day, p?.condominios?.due_day_2];

export default function RegistroEmissoes({ profile }) {
  const supabase = createClient();
  const { addToast } = useToast();
  const { user } = useAuth();

  const [pacotes, setPacotes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busca, setBusca] = useState('');
  const [filtroVenc, setFiltroVenc] = useState('');   // lib/vencimento.js
  const [competencia, setCompetencia] = useState('');
  const [situacao, setSituacao] = useState('todas');   // todas | registradas | canceladas
  const [pagina, setPagina] = useState(1);
  const ITENS_POR_PAGINA = 10;

  // Modal retificação
  const [showRetifModal, setShowRetifModal] = useState(false);
  const [retifPacote, setRetifPacote] = useState(null);
  const [retifMotivo, setRetifMotivo] = useState('');
  const [retifDescricao, setRetifDescricao] = useState('');
  const [retifSubmitting, setRetifSubmitting] = useState(false);

  // Modal arquivos
  const [showArqModal, setShowArqModal] = useState(false);
  const [arqPacote, setArqPacote] = useState(null);

  // Visualizador com planilha
  const [arquivoAberto, setArquivoAberto] = useState(null);

  // Extração (ZIP com os originais, na ordem)
  const [extraindo, setExtraindo] = useState(null);   // pacote.id em extração
  const [extProg, setExtProg] = useState(null);        // { i, n, nome }
  const [showExtrairModal, setShowExtrairModal] = useState(false);
  const [extCondo, setExtCondo] = useState('');
  const [extComp, setExtComp] = useState('');
  const [extGrupo, setExtGrupo] = useState('');   // id do pacote, quando o mês tem mais de um

  async function fetchRegistradas() {
    setLoading(true);
    try {
      // Traz expedidas (novo fluxo) + registrado+lacrada=true (dados legados antes da migração)
      let query = supabase
        .from('emissoes_pacotes')
        .select('*, condominios(name, due_day, due_day_2)')
        // 'cancelada' entra aqui (0101): a emissão cancelada precisa ficar
        // VISÍVEL, com o motivo, senão cancelar volta a ser o mesmo que apagar
        // — e o erro que motivou o cancelamento se perde.
        .or('status.eq.expedida,status.eq.cancelada,and(status.eq.registrado,lacrada.eq.true)')
        // A ordenação de verdade é feita no cliente (ver `ordenarPorData`
        // abaixo): emissão cancelada pode não ter `lacrada_em`, e ordenar só
        // por ela empurra a cancelada para uma das pontas — no topo se os nulos
        // vierem primeiro, na ÚLTIMA PÁGINA se vierem por último. Nas duas
        // formas, a linha que a pessoa procura não está onde ela olha.
        .order('lacrada_em', { ascending: false, nullsFirst: false });

      // Gerentes veem apenas os condomínios da sua carteira
      if (profile?.role === 'gerente') {
        // condominios.gerente_id referencia gerentes.id, não profiles.id
        const ids = await condosDaCarteira(supabase, profile);
        // `null` = vê tudo (master, departamento, supervisões). Lista vazia é
        // outra coisa: carteira sem condomínio nenhum.
        if (ids) {
          if (ids.length === 0) { setPacotes([]); setLoading(false); return; }
          query = query.in('condominio_id', ids);
        }
      }

      const { data, error } = await query;

      if (error) { addToast('Erro ao carregar registros: ' + error.message, 'error'); return; }

      // Cada linha tem a SUA data: a expedida foi lacrada, a cancelada foi
      // cancelada. Ordenar pelas duas juntas põe cada uma no lugar cronológico
      // certo — que é onde alguém procura "o que aconteceu esta semana".
      const quando = (p) => p.cancelada_em || p.lacrada_em || p.atualizado_em || p.criado_em || '';
      (data || []).sort((a, b) => String(quando(b)).localeCompare(String(quando(a))));

      // Buscar arquivos
      const ids = (data || []).map(p => p.id);
      let arqMap = {};
      if (ids.length > 0) {
        const { data: arquivos } = await supabase
          .from('emissoes_arquivos')
          .select('id, pacote_id, arquivo_nome, arquivo_url, formato, categoria, subtipo, nome_condominio_fatura, vencimento_fatura, valor_fatura, relatorio_empresa, relatorio_tipo_servico, relatorio_data_leitura, relatorio_unidades, relatorio_consumo_total, relatorio_valor_total, extracao_dados_brutos, condominio_id, mes_referencia, ano_referencia')
          .in('pacote_id', ids);
        (arquivos || []).forEach(a => {
          if (!arqMap[a.pacote_id]) arqMap[a.pacote_id] = [];
          arqMap[a.pacote_id].push(a);
        });
      }

      const comGrupo = await anexarGrupos(supabase, data);
      setPacotes(comGrupo.map(p => ({ ...p, arquivos: arqMap[p.id] || [] })));
    } catch (e) { console.error(e); } finally { setLoading(false); }
  }

  useEffect(() => { fetchRegistradas(); }, []);

  const competenciasDisponiveis = useMemo(() => {
    const set = new Set();
    pacotes.forEach(p => set.add(`${String(p.mes_referencia).padStart(2,'0')}/${p.ano_referencia}`));
    return Array.from(set).sort().reverse();
  }, [pacotes]);

  // Condomínios/competências disponíveis pro modal "Extrair emissão"
  const condosDisponiveis = useMemo(() => {
    const m = {};
    pacotes.forEach(p => { if (p.condominio_id) m[p.condominio_id] = p.condominios?.name || 'Condomínio'; });
    return Object.entries(m).map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
  }, [pacotes]);
  const compsDoExtCondo = useMemo(() => {
    const s = new Set();
    pacotes.filter(p => p.condominio_id === extCondo).forEach(p => s.add(`${String(p.mes_referencia).padStart(2,'0')}/${p.ano_referencia}`));
    return Array.from(s).sort().reverse();
  }, [pacotes, extCondo]);

  // As emissões do condomínio+competência escolhidos. Mais de uma = dois grupos.
  const pacotesDoExt = useMemo(() => {
    if (!extCondo || !extComp) return [];
    const [mes, ano] = extComp.split('/');
    return pacotes
      .filter(p => p.condominio_id === extCondo
        && String(p.mes_referencia).padStart(2, '0') === mes
        && String(p.ano_referencia) === ano)
      .sort((a, b) => (a.grupo_due_day ?? 99) - (b.grupo_due_day ?? 99));
  }, [pacotes, extCondo, extComp]);

  // Derivado, não sincronizado por efeito: trocar de condomínio/mês deixa
  // `extGrupo` apontando para um pacote que não está mais na lista, e aí o
  // seletor cai sozinho no primeiro do mês novo.
  const extGrupoEfetivo = pacotesDoExt.some(p => p.id === extGrupo)
    ? extGrupo
    : (pacotesDoExt[0]?.id || '');

  const pacotesFiltrados = useMemo(() => {
    return pacotes.filter(p => {
      if (busca) {
        const nome = (p.condominios?.name || '').toLowerCase();
        if (!nome.includes(busca.toLowerCase())) return false;
      }
      if (competencia) {
        const [mes, ano] = competencia.split('/');
        if (String(p.mes_referencia).padStart(2,'0') !== mes || String(p.ano_referencia) !== ano) return false;
      }
      if (!passaVencimento(p, filtroVenc, vencDoPacote)) return false;
      // Cancelada é rara e some no meio das registradas. Sem um filtro, achar
      // "aquela que foi cancelada mês passado" vira rolagem.
      const ehCanc = (p.status || '').toLowerCase() === 'cancelada';
      if (situacao === 'canceladas' && !ehCanc) return false;
      if (situacao === 'registradas' && ehCanc) return false;
      return true;
    });
  }, [pacotes, busca, competencia, situacao, filtroVenc]);

  const totalCanceladas = useMemo(
    () => pacotes.filter(p => (p.status || '').toLowerCase() === 'cancelada').length,
    [pacotes],
  );

  const totalPaginas = Math.ceil(pacotesFiltrados.length / ITENS_POR_PAGINA);
  const pacotesPaginados = pacotesFiltrados.slice((pagina - 1) * ITENS_POR_PAGINA, pagina * ITENS_POR_PAGINA);
  const temFiltros = busca || competencia || filtroVenc;
  const temVencimento = pacotes.some(x => vencDoPacote(x) != null);
  const canRetif = ['master', 'departamento'].includes(profile?.role);
  const canDelete = profile?.role === 'master';
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);
  const [cancelando, setCancelando] = useState(null);   // pacote a cancelar

  async function handleDelete(pacote) {
    if (confirmDeleteId !== pacote.id) {
      setConfirmDeleteId(pacote.id);
      addToast('Clique novamente para confirmar a exclusão', 'warning');
      setTimeout(() => setConfirmDeleteId(null), 3000);
      return;
    }
    try {
      // Remove arquivos do storage
      if (pacote.arquivos?.length) {
        await supabase.storage.from('emissoes').remove(pacote.arquivos.map(a => a.arquivo_url));
      }
      // Remove dependências antes do pacote (respeita FK).
      // Conferir aqui importa: se um destes falha em silêncio, o delete do
      // pacote estoura logo depois com erro de chave estrangeira — mensagem que
      // não diz nada a quem está na tela.
      const { error: errRetif } = await supabase.from('emissoes_retificacoes').delete().eq('pacote_original_id', pacote.id);
      if (errRetif) throw errRetif;
      const { error: errArqs } = await supabase.from('emissoes_arquivos').delete().eq('pacote_id', pacote.id);
      if (errArqs) throw errArqs;
      const { error } = await supabase.from('emissoes_pacotes').delete().eq('id', pacote.id);
      if (error) throw error;
      setPacotes(prev => prev.filter(p => p.id !== pacote.id));
      setConfirmDeleteId(null);
      addToast('Emissão excluída.', 'success');
    } catch (e) {
      addToast('Erro: ' + e.message, 'error');
    }
  }

  function limparFiltros() { setBusca(''); setCompetencia(''); setPagina(1); }

  async function handleSolicitarRetif() {
    if (!retifMotivo) return addToast('Selecione o motivo', 'error');
    if (retifDescricao.length < 30) return addToast('Descrição precisa ter pelo menos 30 caracteres', 'error');
    setRetifSubmitting(true);
    try {
      const { error } = await supabase.from('emissoes_retificacoes').insert({
        pacote_original_id: retifPacote.id,
        motivo: retifMotivo,
        descricao_detalhada: retifDescricao,
        solicitado_por: profile.id,
      });
      if (error) throw error;
      addToast('Retificação solicitada com sucesso!', 'success');
      setShowRetifModal(false);
      setRetifPacote(null); setRetifMotivo(''); setRetifDescricao('');
    } catch (e) { addToast('Erro: ' + e.message, 'error'); }
    finally { setRetifSubmitting(false); }
  }

  async function openFileUrl(arq, pacote) {
    const url = await getArquivoUrlSeguro(arq.arquivo_url);
    if (!url) return addToast('Erro ao abrir arquivo', 'error');
    setShowArqModal(false);
    setArquivoAberto({
      id: arq.id,
      nome: arq.arquivo_nome,
      url: url,
      processo_id: pacote?.processo_id || null,
      pacote_id: pacote?.id || null,
      pacote_status: pacote?.status || null,
      pacote_nivel: pacote?.nivel_aprovacao || null,
      comentario_correcao: pacote?.comentario_correcao || null,
      correcao_arquivo_url: pacote?.correcao_arquivo_url || null,
      correcao_arquivo_nome: pacote?.correcao_arquivo_nome || null,
      resposta_correcao_comentario: pacote?.resposta_correcao_comentario || null,
      resposta_correcao_arquivo_url: pacote?.resposta_correcao_arquivo_url || null,
      resposta_correcao_arquivo_nome: pacote?.resposta_correcao_arquivo_nome || null,
      resposta_correcao_em: pacote?.resposta_correcao_em || null,
      condominio_id: pacote?.condominio_id,
      mes: pacote?.mes_referencia,
      ano: pacote?.ano_referencia,
      eh_retificacao: pacote?.eh_retificacao || false,
      emitido_por: pacote?.uploaded_by,
      arquivos: pacote?.arquivos || [],
      planilha_snapshot: pacote?.planilha_snapshot || null,
    });
  }

  async function handleDownloadZip(pacote) {
    addToast('Preparando download...', 'info');
    try {
      const zip = new JSZip();
      for (const arq of (pacote.arquivos || [])) {
        const url = await getArquivoUrlSeguro(arq.arquivo_url, { stream: true });   // fetch → same-origin
        if (!url) continue;
        const resp = await fetch(url);
        if (!resp.ok) continue;
        const blob = await resp.blob();
        zip.file(arq.arquivo_nome, blob);
      }
      const content = await zip.generateAsync({ type: 'blob' });
      const nome = `${(pacote.condominios?.name || 'pacote').replace(/\s+/g, '_')}_${String(pacote.mes_referencia).padStart(2,'0')}-${pacote.ano_referencia}.zip`;
      saveAs(content, nome);
      addToast('Download concluído!', 'success');
    } catch (e) {
      addToast('Erro no download: ' + e.message, 'error');
    }
  }

  // Extrai a emissão na ordem de auditoria (1→8), incluindo os anexos das cobranças extras.
  // formato 'pdf' = tudo num arquivo só (padrão) · 'zip' = os arquivos originais, bit a bit.
  async function handleExtrair(pacote, formato = 'pdf') {
    if (!pacote) return;
    setExtraindo(pacote.id);
    setExtProg({ i: 0, n: (pacote.arquivos?.length || 0) + 1, nome: 'preparando…' });
    try {
      // Cobranças incluídas na emissão (item 7) — com os anexos.
      // Prioriza o SNAPSHOT congelado no registro; sem ele (emissões antigas), lê direto
      // da tabela INCLUINDO as 'processada'. O /conferencia esconde as processadas, por
      // isso as cobranças extras não estavam entrando na extração.
      let cobrancas = [];
      try {
        if (Array.isArray(pacote.cobrancas_snapshot) && pacote.cobrancas_snapshot.length) {
          cobrancas = pacote.cobrancas_snapshot;
        } else {
          const { data: rows } = await supabase.from('cobrancas_extras')
            .select('id, description, amount, attachments, status')
            .eq('condominio_id', pacote.condominio_id)
            .eq('mes', pacote.mes_referencia)
            .eq('ano', pacote.ano_referencia)
            .neq('status', 'cancelada').neq('status', 'removida');
          let list = rows || [];
          const incl = pacote.cobrancas_incluidas;
          if (Array.isArray(incl)) list = list.filter(c => incl.includes(c.id));
          cobrancas = list.map(c => ({ id: c.id, descricao: c.description, attachments: c.attachments || [] }));
        }
      } catch { /* segue sem cobranças */ }

      const itens = ordenarParaExtracao(pacote.arquivos || [], cobrancas);
      if (itens.length === 0) { addToast('Essa emissão não tem arquivos pra extrair.', 'warning'); return; }

      const base = `${(pacote.condominios?.name || 'emissao').replace(/[^\w]+/g, '_')}_${String(pacote.mes_referencia).padStart(2,'0')}-${pacote.ano_referencia}`;

      if (formato === 'zip') {
        const { blob, pulados, incluidos } = await montarZipEmissao(itens, (i, n, nome) => setExtProg({ i, n, nome }));
        if (!blob || incluidos === 0) { addToast('Nenhum arquivo pôde ser baixado desta emissão.', 'error'); return; }
        saveAs(blob, `${base}.zip`);
        if (pulados.length) addToast(`${incluidos} documento(s) no ZIP. ${pulados.length} ficaram de fora: ${pulados.slice(0, 3).join('; ')}${pulados.length > 3 ? '…' : ''}`, 'warning');
        else addToast(`Emissão extraída! ${incluidos} documentos, na ordem, com índice.`, 'success');
        return;
      }

      // Padrão: TUDO EM UM ARQUIVO (PDF único, na ordem 1→8).
      // Monta no navegador copiando as páginas (rápido, sem limite de tamanho).
      let blob = null, pulados = [], totalPaginas = 0;
      try {
        ({ blob, pulados, totalPaginas } = await montarPdfEmissao(itens, (i, n, nome) => setExtProg({ i, n, nome })));
      } catch { /* cai no plano B */ }

      // Plano B: se nada entrou, ou se algum documento ficou de fora, monta NO SERVIDOR
      // com o QPDF, que engole PDF que o navegador recusa. Volta por link assinado.
      if (totalPaginas === 0 || pulados.length > 0) {
        try {
          setExtProg({ i: 0, n: 0, nome: 'montando no servidor…' });
          const r = await apiPost(`/api/emissoes/${pacote.id}/extrair-pdf`, {});
          if (r?.url) {
            const resp = await fetch(r.url);
            if (resp.ok) {
              saveAs(await resp.blob(), r.nome || `${base}.pdf`);
              const faltou = r.pulados?.length || 0;
              if (faltou) addToast(`PDF gerado (${r.paginas} páginas). ${faltou} item(ns) ficaram de fora: ${r.pulados.slice(0, 3).join('; ')}${faltou > 3 ? '…' : ''}`, 'warning');
              else addToast(`Emissão extraída! ${r.paginas} páginas num arquivo só.`, 'success');
              return;
            }
          }
        } catch (e2) { /* se o servidor também falhar, usa o que o navegador conseguiu */ }
      }

      if (!blob || totalPaginas === 0) { addToast('Não consegui montar o PDF (nenhum documento pôde ser lido).', 'error'); return; }
      saveAs(blob, `${base}.pdf`);
      if (pulados.length) addToast(`PDF gerado (${totalPaginas} páginas). ${pulados.length} item(ns) ficaram de fora: ${pulados.slice(0, 3).join('; ')}${pulados.length > 3 ? '…' : ''}`, 'warning');
      else addToast(`Emissão extraída! ${totalPaginas} páginas num arquivo só.`, 'success');
    } catch (e) {
      addToast('Erro ao extrair: ' + (e.message || e), 'error');
    } finally {
      setExtraindo(null);
      setExtProg(null);
    }
  }

  function extrairDoModal(formato = 'pdf') {
    if (!extCondo || !extComp) return;
    const pacote = pacotesDoExt.find(p => p.id === extGrupoEfetivo);
    if (!pacote) { addToast('Emissão não encontrada.', 'error'); return; }
    setShowExtrairModal(false);
    handleExtrair(pacote, formato);
  }

  return (
    <div className="space-y-6">
      {/* Header com stats */}
      <div className="grid grid-cols-2 gap-4">
        <div className="p-6 border border-slate-200 rounded-3xl bg-white flex items-center gap-4">
          <div className="w-12 h-12 rounded-2xl bg-emerald-500/10 flex items-center justify-center border border-emerald-500/20">
            <Lock className="w-6 h-6 text-emerald-400" />
          </div>
          <div>
            <p className="text-3xl font-semibold text-slate-900">{pacotes.length}</p>
            <p className="text-[11px] font-medium text-slate-500">Emissões Expedidas</p>
          </div>
        </div>
        <div className="p-6 border border-slate-200 rounded-3xl bg-white flex items-center gap-4">
          <div className="w-12 h-12 rounded-2xl bg-amber-500/10 flex items-center justify-center border border-amber-500/20">
            <RefreshCw className="w-6 h-6 text-amber-400" />
          </div>
          <div>
            <p className="text-3xl font-semibold text-slate-900">{pacotes.filter(p => p.eh_retificacao).length}</p>
            <p className="text-[11px] font-medium text-slate-500">Retificações</p>
          </div>
        </div>
      </div>

      {/* Filtros */}
      <div className="border border-slate-200 rounded-3xl bg-slate-50 p-6">
        <div className="flex flex-wrap gap-4 items-end">
          <div className="flex-1 min-w-[200px]">
            <label className="block text-[10px] font-semibold text-slate-500  mb-2">Buscar Condomínio</label>
            <div className="relative">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
              <input value={busca} onChange={e => { setBusca(e.target.value); setPagina(1); }}
                placeholder="Nome do condomínio..."
                className="w-full bg-slate-50 border border-slate-200 rounded-xl pl-11 pr-4 py-3 text-sm text-slate-900 outline-none focus:border-emerald-500 transition-all placeholder:text-slate-400" />
            </div>
          </div>
          <div className="min-w-[160px]">
            <label className="block text-[10px] font-semibold text-slate-500  mb-2">Competência</label>
            <select value={competencia} onChange={e => { setCompetencia(e.target.value); setPagina(1); }}
              className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm text-slate-900 outline-none focus:border-emerald-500 transition-all appearance-none">
              <option value="" className="bg-white">Todas</option>
              {competenciasDisponiveis.map(c => <option key={c} value={c} className="bg-white">{c}</option>)}
            </select>
          </div>
          <div className="min-w-[160px]">
            <label className="block text-[10px] font-semibold text-slate-500 mb-2">Situação</label>
            <select value={situacao} onChange={e => { setSituacao(e.target.value); setPagina(1); }}
              className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm text-slate-900 outline-none focus:border-emerald-500 transition-all appearance-none">
              <option value="todas" className="bg-white">Todas</option>
              <option value="registradas" className="bg-white">Só registradas</option>
              <option value="canceladas" className="bg-white">
                Só canceladas{totalCanceladas ? ` (${totalCanceladas})` : ''}
              </option>
            </select>
          </div>
          {(temVencimento || filtroVenc) && (
            <div className="min-w-[160px]">
              <label className="block text-[10px] font-semibold text-slate-500 mb-2">Vencimento</label>
              <FiltroVencimento itens={pacotes} value={filtroVenc} pegar={vencDoPacote}
                onChange={v => { setFiltroVenc(v); setPagina(1); }}
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm text-slate-900 outline-none focus:border-emerald-500 transition-all appearance-none" />
            </div>
          )}
          {temFiltros && (
            <button onClick={() => { limparFiltros(); setFiltroVenc(''); }} className="px-4 py-3 rounded-xl bg-slate-50 border border-slate-200 text-xs font-bold text-slate-500 hover:text-slate-900 hover:bg-slate-100 transition-all flex items-center gap-2">
              <X className="w-3 h-3" /> Limpar
            </button>
          )}
        </div>
      </div>

      {/* Tabela */}
      <div className="border border-slate-200 rounded-3xl bg-slate-50 overflow-hidden shadow-2xl">
        <div className="p-6 border-b border-slate-200 flex items-center gap-4 flex-wrap">
          <Archive className="w-5 h-5 text-emerald-400" />
          <h3 className="font-semibold text-slate-900 text-lg">Registro de Emissões Expedidas</h3>
          <span className="text-[10px] font-semibold text-emerald-400  bg-emerald-500/10 px-3 py-1 rounded-full border border-emerald-500/20">
            {pacotesFiltrados.length} registro{pacotesFiltrados.length !== 1 ? 's' : ''}
          </span>
          {pacotes.length > 0 && (
            <button onClick={() => { setExtCondo(''); setExtComp(''); setShowExtrairModal(true); }}
              className="ml-auto px-4 py-2 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-xs font-medium flex items-center gap-2 shadow-lg transition-all">
              <FileDown className="w-4 h-4" /> Extrair emissão
            </button>
          )}
        </div>

        {loading ? (
          <div className="flex flex-col items-center justify-center p-16 gap-3">
            <Loader2 className="w-8 h-8 text-emerald-500 animate-spin" />
            <p className="text-xs text-slate-500 font-medium">Carregando registros...</p>
          </div>
        ) : pacotesFiltrados.length === 0 ? (
          <div className="flex flex-col items-center justify-center p-20 text-center">
            <div className="w-16 h-16 rounded-full bg-slate-50 flex items-center justify-center mb-4 border border-slate-200">
              <Archive className="w-8 h-8 text-slate-400" />
            </div>
            <h4 className="text-slate-900 font-semibold text-lg">Nenhum registro encontrado</h4>
            <p className="text-xs text-slate-500 max-w-[250px] mt-2">
              {temFiltros ? 'Tente ajustar os filtros.' : 'Emissões registradas aparecerão aqui.'}
            </p>
          </div>
        ) : (
          <>
            {/* Header da tabela */}
            <div className="grid grid-cols-[2fr_1fr_1fr_1fr_auto] px-6 py-3 border-b border-slate-200 bg-slate-50">
              {['Condomínio', 'Competência', 'Expedida em', 'Status', 'Ações'].map(h => (
                <span key={h} className="text-[9px] font-semibold text-slate-500 ">{h}</span>
              ))}
            </div>

            {/* Linhas */}
            <div className="divide-y divide-slate-200">
              {pacotesPaginados.map(p => {
                const numArq = p.arquivos?.length || 0;
                const ehCancelada = (p.status || '').toLowerCase() === 'cancelada';
                return (
                  <div key={p.id} className={`tem-marca-dagua relative overflow-hidden grid grid-cols-[2fr_1fr_1fr_1fr_auto] px-6 py-4 items-center transition-colors ${
                    ehCancelada ? 'bg-rose-50/40 hover:bg-rose-50/60' : 'hover:bg-slate-100'}`}>
                    {/* Tarja: a linha inteira precisa gritar "cancelada" antes
                        de alguém ler o texto. Cor de fundo sozinha some numa
                        lista longa. */}
                    {ehCancelada && <span className="absolute left-0 top-0 bottom-0 w-1.5 bg-rose-500 z-10" aria-hidden="true" />}
                    {ehCancelada && <MarcaDaguaCancelada />}
                    <div className="flex items-center gap-3">
                      <div className={`w-9 h-9 rounded-xl flex items-center justify-center border ${
                        ehCancelada ? 'bg-slate-100 border-slate-300' : 'bg-emerald-500/10 border-emerald-500/20'}`}>
                        {ehCancelada
                          ? <Ban className="w-4 h-4 text-slate-500" />
                          : <Building className="w-4 h-4 text-emerald-400" />}
                      </div>
                      <div className="min-w-0">
                        <p className={`font-bold text-sm flex items-center gap-2 flex-wrap ${
                          ehCancelada ? 'text-slate-600' : 'text-slate-900'}`}>
                          {p.condominios?.name}
                          <SeloGrupo pacote={p} />
                          {/* O mês entra no selo porque é a primeira pergunta
                              de quem vê uma cancelada: "de qual mês?". A coluna
                              de competência existe, mas fica longe do nome. */}
                          {ehCancelada && (
                            <span className="inline-flex items-center gap-1 rounded-md bg-rose-600 px-2 py-0.5 text-[10px] font-black uppercase tracking-wider text-white">
                              <Ban className="w-3 h-3" aria-hidden="true" />
                              Cancelada · {String(p.mes_referencia).padStart(2, '0')}/{p.ano_referencia}
                            </span>
                          )}
                        </p>
                        <p className="text-[10px] text-slate-500">1 emissão • {numArq} arquivo{numArq !== 1 ? 's' : ''}</p>
                        {/* O motivo é a razão de a emissão cancelada continuar
                            aqui: sem ele, cancelar seria o mesmo que apagar. */}
                        {ehCancelada && p.cancelamento_motivo && (
                          <p className="mt-1 text-[11px] text-slate-600 border-l-2 border-slate-300 pl-2">
                            <span className="font-semibold">Cancelada</span>
                            {p.cancelada_por_nome ? ` por ${p.cancelada_por_nome}` : ''}
                            {p.cancelada_em ? ` em ${new Date(p.cancelada_em).toLocaleDateString('pt-BR')}` : ''}
                            : {p.cancelamento_motivo}
                            {p.substituida_por && (
                              <span className="block text-[10px] text-violet-600">
                                uma nova emissão foi aberta no lugar
                              </span>
                            )}
                          </p>
                        )}
                      </div>
                    </div>
                    <span className={`text-sm font-bold ${ehCancelada ? 'text-rose-600' : 'text-violet-400'}`}>
                      {String(p.mes_referencia).padStart(2,'0')}/{p.ano_referencia}
                    </span>
                    {/* A coluna é "Expedida em", e a cancelada tem lacre antigo:
                        mostrar essa data crua fazia a linha exibir 17/08 ao
                        lado de um cancelamento do dia 18 — e é pela data do
                        cancelamento que a lista está ordenada. */}
                    <span className="text-xs text-slate-500">
                      {(() => {
                        const dt = ehCancelada ? (p.cancelada_em || p.lacrada_em) : p.lacrada_em;
                        if (!dt) return '—';
                        const txt = new Date(dt).toLocaleDateString('pt-BR', { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit' }).replace(',', ' às');
                        return ehCancelada ? <>cancelada em<br />{txt}</> : txt;
                      })()}
                    </span>
                    <div className="flex items-center gap-2">
                      {/* Era "Expedida" fixo — uma emissão cancelada apareceria
                          como expedida, que é o contrário do que aconteceu. */}
                      {ehCancelada ? (
                        <span className="px-2 py-1 rounded-lg bg-rose-500/10 border border-rose-500/30 text-[9px] font-semibold text-rose-600 flex items-center gap-1">
                          <Ban className="w-3 h-3" /> Cancelada
                        </span>
                      ) : (
                        <span className="px-2 py-1 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-[9px] font-semibold text-emerald-400  flex items-center gap-1">
                          <Lock className="w-3 h-3" /> Expedida
                        </span>
                      )}
                      {p.eh_retificacao && (
                        <span className="px-2 py-1 rounded-lg bg-amber-500/10 border border-amber-500/20 text-[9px] font-semibold text-amber-400 ">Retif.</span>
                      )}
                    </div>
                    <div className="flex gap-2">
                      <button onClick={() => { setArqPacote(p); setShowArqModal(true); }}
                        className="p-2 rounded-lg bg-slate-50 border border-slate-200 text-slate-500 hover:text-violet-400 hover:border-violet-500/30 transition-all" title="Ver arquivos">
                        <Eye className="w-4 h-4" />
                      </button>
                      {(p.arquivos?.length || 0) > 0 && (
                        <button onClick={() => handleExtrair(p)} disabled={extraindo === p.id}
                          className="p-2 rounded-lg bg-slate-50 border border-slate-200 text-slate-500 hover:text-violet-500 hover:border-violet-500/30 transition-all disabled:opacity-50" title="Extrair emissão (PDF único, na ordem, com as cobranças extras)">
                          {extraindo === p.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileDown className="w-4 h-4" />}
                        </button>
                      )}
                      {canRetif && (
                        <button onClick={() => { setRetifPacote(p); setShowRetifModal(true); setRetifMotivo(''); setRetifDescricao(''); }}
                          className="p-2 rounded-lg bg-slate-50 border border-slate-200 text-slate-500 hover:text-amber-400 hover:border-amber-500/30 transition-all" title="Solicitar retificação">
                          <RefreshCw className="w-4 h-4" />
                        </button>
                      )}
                      {/* Cancelar guarda, excluir apaga. As duas existem, e a
                          diferença importa: cancelamento é raro e preserva o
                          histórico do erro; exclusão é para o pacote criado por
                          engano, que não deveria ter existido. */}
                      {canDelete && (p.status || '').toLowerCase() !== 'cancelada' && (
                        <button onClick={() => setCancelando(p)}
                          className="p-2 rounded-lg border bg-slate-50 border-slate-200 text-slate-400 hover:text-rose-500 hover:bg-rose-500/10 hover:border-rose-500/30 transition-all"
                          title="Cancelar emissão (guarda a antiga e abre uma nova)">
                          <Ban className="w-4 h-4" />
                        </button>
                      )}
                      {canDelete && (
                        <button onClick={() => handleDelete(p)}
                          className={`p-2 rounded-lg border transition-all ${confirmDeleteId === p.id ? 'bg-rose-500 border-rose-500 text-white animate-pulse' : 'bg-slate-50 border-slate-200 text-rose-400/50 hover:text-rose-400 hover:bg-rose-500/10 hover:border-rose-500/30'}`}
                          title={confirmDeleteId === p.id ? 'Clique para confirmar' : 'Excluir emissão'}>
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Paginação */}
            {totalPaginas > 1 && (
              <div className="px-6 py-4 border-t border-slate-200 flex items-center justify-between bg-slate-50">
                <span className="text-[10px] font-bold text-slate-500 ">
                  Página {pagina} de {totalPaginas}
                </span>
                <div className="flex gap-2">
                  <button onClick={() => setPagina(p => Math.max(1, p - 1))} disabled={pagina === 1}
                    className="p-2 rounded-lg bg-slate-50 border border-slate-200 text-slate-500 hover:text-slate-900 disabled:opacity-30 transition-all">
                    <ChevronLeft className="w-4 h-4" />
                  </button>
                  <button onClick={() => setPagina(p => Math.min(totalPaginas, p + 1))} disabled={pagina === totalPaginas}
                    className="p-2 rounded-lg bg-slate-50 border border-slate-200 text-slate-500 hover:text-slate-900 disabled:opacity-30 transition-all">
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* ═══ MODAL VER ARQUIVOS ═══ */}
      {showArqModal && arqPacote && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/40 backdrop-blur-sm p-4">
          <div className="bg-white border border-slate-200 rounded-3xl w-full max-w-md p-8 shadow-2xl">
            <div className="flex items-center justify-between mb-6">
              <div>
                <h3 className="text-lg font-semibold text-slate-900">{arqPacote.condominios?.name}</h3>
                <p className="text-[10px] text-emerald-400 font-medium">
                  {String(arqPacote.mes_referencia).padStart(2,'0')}/{arqPacote.ano_referencia} • Lacrada
                </p>
              </div>
              <button onClick={() => setShowArqModal(false)} className="p-2 hover:bg-slate-100 rounded-full text-slate-500 hover:text-slate-900 transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="space-y-2 max-h-[300px] overflow-y-auto">
              {(arqPacote.arquivos || []).length === 0 ? (
                <p className="text-sm text-slate-500 text-center py-8">Nenhum arquivo encontrado.</p>
              ) : arqPacote.arquivos.map(arq => (
                <button key={arq.id} onClick={() => openFileUrl(arq, arqPacote)}
                  className="w-full flex items-center gap-3 px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl hover:border-violet-500/30 hover:bg-violet-500/5 transition-all group text-left">
                  <FileText className="w-4 h-4 text-slate-500 group-hover:text-violet-400 shrink-0" />
                  <span className="text-sm font-bold text-slate-500 group-hover:text-slate-900 truncate">{arq.arquivo_nome}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ═══ VISUALIZADOR COM PLANILHA ═══ */}
      {arquivoAberto && (
        <VisualizadorConferencia
          arquivo={arquivoAberto}
          arquivos={arquivoAberto.arquivos}
          currentUser={user}
          onClose={() => setArquivoAberto(null)}
          onAction={() => { setArquivoAberto(null); fetchRegistradas(); }}
        />
      )}

      {/* ═══ MODAL RETIFICAÇÃO ═══ */}
      {showRetifModal && retifPacote && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/40 backdrop-blur-sm p-4">
          <div className="bg-white border border-slate-200 rounded-3xl w-full max-w-lg p-8 shadow-2xl">
            <div className="flex items-center gap-4 mb-6">
              <div className="w-12 h-12 bg-amber-500/10 border border-amber-500/20 rounded-2xl flex items-center justify-center">
                <RefreshCw className="w-6 h-6 text-amber-400" />
              </div>
              <div>
                <h3 className="text-xl font-semibold text-slate-900">Solicitar Retificação</h3>
                <p className="text-[10px] text-amber-400 font-medium mt-1">
                  {retifPacote.condominios?.name} — {String(retifPacote.mes_referencia).padStart(2,'0')}/{retifPacote.ano_referencia}
                </p>
              </div>
            </div>

            <div className="p-4 bg-amber-500/5 border border-amber-500/20 rounded-2xl mb-6 flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
              <p className="text-xs text-amber-200/60 leading-relaxed">
                Esta ação registrará oficialmente uma solicitação de retificação. O pacote original permanecerá lacrado até aprovação.
              </p>
            </div>

            <div className="space-y-5">
              <div>
                <label className="block text-[10px] font-semibold text-slate-500  mb-2">Motivo</label>
                <select value={retifMotivo} onChange={e => setRetifMotivo(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm text-slate-900 outline-none focus:border-amber-500 transition-all appearance-none">
                  <option value="" className="bg-white">Selecione o motivo...</option>
                  <option value="Cobrança extra esquecida" className="bg-white">Cobrança extra esquecida</option>
                  <option value="Valor incorreto no rateio" className="bg-white">Valor incorreto no rateio</option>
                  <option value="Dado cadastral desatualizado" className="bg-white">Dado cadastral desatualizado</option>
                  <option value="Erro no demonstrativo" className="bg-white">Erro no demonstrativo</option>
                  <option value="Outro" className="bg-white">Outro (descrever)</option>
                </select>
              </div>
              <div>
                <label className="block text-[10px] font-semibold text-slate-500  mb-2">Descrição Detalhada</label>
                <textarea value={retifDescricao} onChange={e => setRetifDescricao(e.target.value)} rows={4}
                  placeholder="Descreva detalhadamente o que precisa ser retificado..."
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl p-4 text-sm text-slate-900 outline-none focus:border-amber-500 transition-all placeholder:text-slate-400" />
                <p className="text-[9px] text-slate-400 mt-1 ml-1 uppercase font-bold tracking-widest">Mínimo 30 caracteres ({retifDescricao.length}/30)</p>
              </div>
            </div>

            <div className="flex gap-3 mt-6">
              <button onClick={() => { setShowRetifModal(false); setRetifPacote(null); }}
                className="flex-1 py-3 rounded-xl text-xs font-medium text-slate-500 hover:text-slate-900 hover:bg-slate-100 transition-colors">
                Cancelar
              </button>
              <button onClick={handleSolicitarRetif} disabled={retifSubmitting || !retifMotivo || retifDescricao.length < 30}
                className="flex-[2] py-3 rounded-xl bg-amber-600 hover:bg-amber-500 text-white font-medium text-xs shadow-lg transition-all disabled:opacity-30 flex items-center justify-center gap-2">
                {retifSubmitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                Solicitar Retificação
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ═══ MODAL EXTRAIR EMISSÃO ═══ */}
      {showExtrairModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/40 backdrop-blur-sm p-4">
          <div className="bg-white border border-slate-200 rounded-3xl w-full max-w-md p-8 shadow-2xl">
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-lg font-semibold text-slate-900 flex items-center gap-2"><FileDown className="w-5 h-5 text-violet-500" /> Extrair emissão</h3>
              <button onClick={() => setShowExtrairModal(false)} className="p-2 hover:bg-slate-100 rounded-full text-slate-500 hover:text-slate-900 transition-colors"><X className="w-5 h-5" /></button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="block text-[10px] font-semibold text-slate-500  mb-2">Condomínio</label>
                <select value={extCondo} onChange={e => { setExtCondo(e.target.value); setExtComp(''); }}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm text-slate-900 outline-none focus:border-violet-500">
                  <option value="">Selecione…</option>
                  {condosDisponiveis.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-[10px] font-semibold text-slate-500  mb-2">Emissão (mês/ano)</label>
                <select value={extComp} onChange={e => setExtComp(e.target.value)} disabled={!extCondo}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm text-slate-900 outline-none focus:border-violet-500 disabled:opacity-50">
                  <option value="">{extCondo ? 'Selecione a competência…' : 'Escolha o condomínio primeiro'}</option>
                  {compsDoExtCondo.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              {/* Condomínio de dois vencimentos tem duas emissões no mesmo mês.
                  Sem escolher, `find` pegava a primeira e a outra nunca saía. */}
              {pacotesDoExt.length > 1 && (
                <div>
                  <label className="block text-[10px] font-semibold text-slate-500 mb-2">Grupo de emissão</label>
                  <select value={extGrupoEfetivo} onChange={e => setExtGrupo(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm text-slate-900 outline-none focus:border-violet-500">
                    {pacotesDoExt.map(p => (
                      <option key={p.id} value={p.id}>
                        {p.grupo_nome || 'Sem grupo'}{p.grupo_due_day ? ` — vence dia ${p.grupo_due_day}` : ''}
                      </option>
                    ))}
                  </select>
                  <p className="mt-1.5 text-[10px] text-slate-500">
                    Este mês tem {pacotesDoExt.length} emissões. Extraia uma de cada vez.
                  </p>
                </div>
              )}
              <button onClick={() => extrairDoModal('zip')} disabled={!extCondo || !extComp}
                className="flex-1 py-2.5 rounded-xl border border-slate-200 text-slate-600 hover:text-slate-900 hover:bg-slate-50 font-medium text-[11px] transition-all disabled:opacity-40 flex items-center justify-center gap-2"
                title="Baixa os arquivos originais separados, sem reprocessar (melhor fidelidade)">
                <Archive className="w-4 h-4" /> Originais (ZIP)
              </button>
              <button onClick={() => extrairDoModal('pdf')} disabled={!extCondo || !extComp}
                className="w-full py-3 rounded-xl bg-violet-600 hover:bg-violet-500 text-white font-medium text-xs shadow-lg transition-all disabled:opacity-40 flex items-center justify-center gap-2">
                <FileDown className="w-4 h-4" /> Extrair tudo em um PDF
              </button>
              <p className="text-[10px] text-slate-400 text-center leading-relaxed">
                Junta os anexos na ordem: emissão → correios → seguros → água → gás → energia → cobranças → rateio.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* ═══ OVERLAY DE PROGRESSO DA EXTRAÇÃO ═══ */}
      {cancelando && (
        <ModalCancelarEmissao
          pacote={cancelando}
          onFechar={() => setCancelando(null)}
          onPronto={() => fetchRegistradas()}
        />
      )}

      {extraindo && extProg && (
        <div className="fixed inset-0 z-[120] flex items-center justify-center bg-slate-900/50 backdrop-blur-sm">
          <div className="bg-white rounded-2xl p-6 shadow-2xl text-center max-w-xs">
            <Loader2 className="w-8 h-8 text-violet-500 animate-spin mx-auto mb-3" />
            <p className="text-sm font-semibold text-slate-900">Montando o arquivo da emissão…</p>
            <p className="text-xs text-slate-500 mt-1 truncate">{extProg.i}/{extProg.n} · {extProg.nome}</p>
          </div>
        </div>
      )}
    </div>
  );
}
