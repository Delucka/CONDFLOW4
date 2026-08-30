'use client';
import { useState, useEffect, useMemo, useRef } from 'react';
import { createClient } from '@/utils/supabase/client';
import { useRealtime } from '@/lib/realtime';
import { UploadCloud, FileText, CheckCircle, Check, Clock, Loader2, Trash2, Package, ChevronDown, ChevronRight, Send, FolderOpen, Plus, X, FileCheck, Lock, Unlock, ClipboardCheck, StickyNote, AlertCircle, Sparkles, Paperclip, Ban, ShieldCheck, Search, Droplet, GripVertical } from 'lucide-react';
import { safeStorageName } from '@/lib/storage';
import { nomeDocumento } from '@/lib/rotuloDocumento';
import StatusBadge from './StatusBadge';
import { useToast } from '@/components/Toast';
import FilePreviewDrawer from '@/components/FilePreviewDrawer';
import VisualizadorConferencia from '@/components/VisualizadorConferencia';
import { useAuth } from '@/lib/auth';
import { apiPost, apiFetch } from '@/lib/api';
import { abrirArquivoSeguro, getArquivoUrlSeguro } from '@/lib/arquivo';
import { ocrFileToText, parseFaturaOcr, decodeBoletoValor } from '@/lib/ocrClient';
import ModalPreparacao from './ModalPreparacao';
import { mesVigente, anoVigente, mesFechado } from '@/lib/mesVigente';
import { combina } from '@/lib/busca';
import { useRevalidarAoVoltar } from '@/lib/useRevalidarAoVoltar';
import { podeRegistrar, anexarGrupos } from '@/lib/conjuntoEmissao';
import { statusDeVoltaAposCorrecao } from '@/lib/aprovacaoFluxo';
import SeloGrupo from './SeloGrupo';
import SeloCancelada, { AvisoCanceladas, MarcaDaguaCancelada } from '@/components/SeloCancelada';
import TagPrioritario from '@/components/TagPrioritario';
import ComparativoConsumo from './ComparativoConsumo';
import FaturaInlineForm from './FaturaInlineForm';
import RevisaoExtracaoModal from './RevisaoExtracaoModal';
import { nomeArquivoPadrao } from './faturaCampos';
import { FileWarning, AlertTriangle, CalendarClock } from 'lucide-react';
import dynamic from 'next/dynamic';

// Painel de prioridade: só é baixado quando alguém abre. É a mesma tela usada
// no Painel e em Condomínios — uma regra de marcação, não três.
const PainelPrioridades = dynamic(() => import('@/components/PainelPrioridades'), { ssr: false });

export default function VisaoEmissor({ profile }) {
  // VERSÃO 4.1 - BOTÃO REGISTRAR ESTABILIZADO
  const supabase = createClient();
  const { addToast } = useToast();
  const { user } = useAuth();
  const [arquivoAberto, setArquivoAberto] = useState(null);
  
  const [condominios, setCondominios] = useState([]);
  const [pacotes, setPacotes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [isUploading, setIsUploading] = useState(false);
  const [selectedFile, setSelectedFile] = useState(null);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  
  // Pacote ativo (aberto para edição)
  const [activePacote, setActivePacote] = useState(null);
  const [pacoteArquivos, setPacoteArquivos] = useState([]);
  
  // Form para novo pacote
  const [condoId, setCondoId] = useState('');
  const [mes, setMes] = useState(mesVigente());   // trabalhamos 1 mês à frente
  const [ano, setAno] = useState(anoVigente());

  // Grupos de emissão do condomínio escolhido (0086). Um condomínio com dois
  // vencimentos tem dois grupos, e cada emissão pertence a um deles.
  const [gruposCondo, setGruposCondo] = useState([]);
  const [grupoId, setGrupoId] = useState('');
  const grupoDesejadoRef = useRef(null);   // grupo do pacote que acabou de ser aberto
  const pacoteDesejadoRef = useRef(null); // pacote pedido pela URL (?pacote=), abre quando a lista chegar
  // De qual condomínio os grupos já foram buscados. NÃO dá para usar `grupoId`
  // como sinal de "carregou": condomínio cadastrado depois da 0086 não tem grupo
  // nenhum (o backfill só pegou os que existiam), e aí `grupoId` fica vazio para
  // sempre — quem esperasse por ele esperaria eternamente, sem erro nenhum.
  const [gruposCarregadosDe, setGruposCarregadosDe] = useState(null);

  // Persiste mês/ano: mantém ao sair/voltar; só muda quando o usuário troca.
  // O link do Dashboard (?condo&mes&ano) VENCE o que estava guardado — quem
  // clicou numa linha específica quer aquele condomínio e aquele mês, não o
  // último que estava aberto.
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const qCondo = q.get('condo');
    const qMes = parseInt(q.get('mes') || '', 10);
    const qAno = parseInt(q.get('ano') || '', 10);

    if (qMes >= 1 && qMes <= 12) setMes(qMes);
    else { const m = parseInt(localStorage.getItem('emissor_mes') || '', 10); if (m >= 1 && m <= 12) setMes(m); }

    if (qAno > 2000) setAno(qAno);
    else { const a = parseInt(localStorage.getItem('emissor_ano') || '', 10); if (a > 2000) setAno(a); }

    if (qCondo) setCondoId(qCondo);
    // `?pacote=` vem da Expedição ("ver a emissão que gerou este boleto"). Fica
    // no ref porque os pacotes ainda não chegaram: quem abre é o efeito abaixo,
    // quando a lista carrega.
    pacoteDesejadoRef.current = q.get('pacote') || null;
  }, []);
  useEffect(() => { try { localStorage.setItem('emissor_mes', String(mes)); localStorage.setItem('emissor_ano', String(ano)); } catch {} }, [mes, ano]);

  // Grupos do condomínio escolhido. Trocar de condomínio zera a escolha: um
  // grupo do condomínio A não vale no B.
  useEffect(() => {
    let vivo = true;
    setGrupoId('');
    setGruposCarregadosDe(null);
    if (!condoId) { setGruposCondo([]); return; }
    (async () => {
      const { data } = await supabase
        .from('condominio_grupos')
        .select('id, nome, due_day, ordem')
        .eq('condominio_id', condoId)
        .eq('ativo', true)
        .order('ordem');
      if (!vivo) return;
      const gs = data || [];
      setGruposCondo(gs);
      const desejado = grupoDesejadoRef.current;
      grupoDesejadoRef.current = null;
      if (desejado && gs.some(g => g.id === desejado)) setGrupoId(desejado);
      else if (gs.length) setGrupoId(gs[0].id);
      setGruposCarregadosDe(condoId);   // carregou — mesmo que a lista seja vazia
    })();
    return () => { vivo = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [condoId]);
  
  // Modal de conclusão
  const [showConcluirModal, setShowConcluirModal] = useState(false);
  const [nivelAprovacao, setNivelAprovacao] = useState(1);
  const [confirmDeleteArqId, setConfirmDeleteArqId] = useState(null);
  const [showRegistroModal, setShowRegistroModal] = useState(false);
  const [dataRegistro, setDataRegistro] = useState('');
  // Resposta de correção (gerente reenviando)
  const [respostaCorrecaoFile, setRespostaCorrecaoFile] = useState(null);
  const [respostaCorrecaoComentario, setRespostaCorrecaoComentario] = useState('');
  const [enviandoResposta, setEnviandoResposta] = useState(false);

  // Carteiras expandidas
  const [expandedCarteiras, setExpandedCarteiras] = useState({});
  const [buscaCarteira, setBuscaCarteira] = useState('');
  // Prioridade: clicar na tag abre o painel focado naquele condomínio; o botão
  // da barra abre vazio, para marcar vários.
  const [prioridadesOpen, setPrioridadesOpen] = useState(false);
  const [focoPrioridade, setFocoPrioridade] = useState(null);
  const abrirPrioridadeDe = (condo) => { setFocoPrioridade(condo); setPrioridadesOpen(true); };
  const [situacao, setSituacao] = useState('todos');   // filtro de situação da lista

  // Mapa de status dos processos por condomínio { condoId: { id, status } }
  const [processosMap, setProcessosMap] = useState({});
  const [lockingCondo, setLockingCondo] = useState(null); // id do condo sendo alterado

  // Mapa de etapas de preparação { `${condoId}_${mes}_${ano}`: { etapa, data_fatura, data_relatorio, ... } }
  const [preparacaoMap, setPreparacaoMap] = useState({});
  // Liberação mensal do gerente (edicoes_mensais) por `${condo}_${mes}_${ano}`
  const [edicoesMap, setEdicoesMap] = useState({});
  const [modalPrepCondo, setModalPrepCondo] = useState(null);

  // Mapa de alterações prevista: { `${condoId}_${mes}_${ano}`: [alteracoes...] }
  const [alteracoesPrevMap, setAlteracoesPrevMap] = useState({});

  // Extração automática de PDF (concessionaria/relatorio)
  const [extraindo, setExtraindo] = useState(false);  // overlay "Lendo PDF..."
  const [ocrProg, setOcrProg] = useState(null);       // {p,n} progresso do OCR de scan
  // Modal de revisão (extração com baixa confiança ou empresa não identificada)
  const [revisaoInfo, setRevisaoInfo] = useState(null); // { extracao, categoria, alertas, file }
  // Modal de duplicata detectada
  const [duplicataInfo, setDuplicataInfo] = useState(null); // { alertas, anomalia, pendingFile, pendingMeta }
  const [sancionandoMotivo, setSancionandoMotivo] = useState('');
  const [sancionandoAnexo, setSancionandoAnexo] = useState(null); // File do documento de aprovação
  const [sancionando, setSancionando] = useState(false);
  const [pertencimentoInfo, setPertencimentoInfo] = useState(null); // { alerta, file, categoria } — bloqueio duro, sem sancionamento

  // Cadastro de Seguro Proteção por código de condomínio { "0020": [{cod,tipo,valor}, ...] }
  const [segurosMap, setSegurosMap] = useState({});
  useEffect(() => {
    fetch('/condominios_seguros.json', { cache: 'force-cache' })
      .then(r => (r.ok ? r.json() : {}))
      .then(setSegurosMap)
      .catch(() => {});
  }, []);

  // Características do condomínio (texto livre, editável e auto-salvo na emissão)
  const [caracteristicas, setCaracteristicas] = useState('');
  const [caracSaving, setCaracSaving] = useState('idle'); // idle | saving | saved
  const caracTimerRef = useRef(null);
  useEffect(() => {
    if (!activePacote?.condominio_id) { setCaracteristicas(''); setCaracSaving('idle'); return; }
    const cond = condominios.find(c => c.id === activePacote.condominio_id);
    setCaracteristicas(cond?.caracteristicas || '');
    setCaracSaving('idle');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activePacote?.id]);

  // Observações do GERENTE (issue_notes do processo, escritas na planilha dele) — o
  // emissor precisa ver antes de emitir, pra conferir se há algo. Fallback: condo.obs_emissao.
  const [obsGerente, setObsGerente] = useState('');
  useEffect(() => {
    const cid = activePacote?.condominio_id;
    if (!cid) { setObsGerente(''); return; }
    const cond = condominios.find(c => c.id === cid);
    const fallback = (cond?.obs_emissao || '').trim();
    const sem = (activePacote.mes_referencia <= 6) ? 1 : 2;
    let cancel = false;
    supabase.from('processos').select('issue_notes')
      .eq('condominio_id', cid).eq('year', activePacote.ano_referencia).eq('semester', sem).maybeSingle()
      .then(({ data }) => { if (!cancel) setObsGerente(((data?.issue_notes || '').trim()) || fallback); })
      .catch(() => { if (!cancel) setObsGerente(fallback); });
    return () => { cancel = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activePacote?.id]);

  const salvarCaracteristicas = (val) => {
    setCaracteristicas(val);
    setCaracSaving('saving');
    if (caracTimerRef.current) clearTimeout(caracTimerRef.current);
    caracTimerRef.current = setTimeout(async () => {
      const cid = activePacote?.condominio_id;
      if (!cid) return;
      const { error } = await supabase.from('condominios').update({ caracteristicas: val }).eq('id', cid);
      if (error) { setCaracSaving('idle'); addToast('Erro ao salvar características: ' + error.message, 'error'); return; }
      setCondominios(prev => prev.map(c => (c.id === cid ? { ...c, caracteristicas: val } : c)));
      setCaracSaving('saved');
      setTimeout(() => setCaracSaving(s => (s === 'saved' ? 'idle' : s)), 1500);
    }, 800);
  };

  // Referência do gerente (planilha do mês + cobranças extras) na tela de anexos
  const [confData, setConfData]       = useState(null);  // { planilha, cobrancas_extras }
  const [confLoading, setConfLoading] = useState(false);
  // Recarrega a referência do gerente sob demanda: anexar o documento que
  // faltava numa cobrança muda a lista, e sem isto o cartão continuaria
  // vermelho até alguém fechar e reabrir a emissão.
  const [confReload, setConfReload] = useState(0);
  const [anexandoDoc, setAnexandoDoc] = useState(null);   // id da cobrança em upload
  const [cobrancasSel, setCobrancasSel] = useState(null); // Set de ids selecionados (null = ainda carregando)

  // Form inline para dados manuais da fatura de concessionaria
  const [editandoFaturaId, setEditandoFaturaId] = useState(null);
  const [savingFaturaId, setSavingFaturaId]     = useState(null);

  // Formata valor digitado como R$ (mascara progressiva por centavos)
  function maskValor(raw) {
    const digits = String(raw || '').replace(/\D/g, '');
    if (!digits) return '';
    const cents = parseInt(digits, 10);
    return (cents / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  function parseValor(masked) {
    const s = String(masked || '').replace(/\./g, '').replace(',', '.');
    const n = parseFloat(s);
    return isNaN(n) ? null : n;
  }

  async function salvarDadosFatura(arq, payload) {
    setSavingFaturaId(arq.id);
    try {
      const { error } = await supabase.from('emissoes_arquivos').update({
        nome_condominio_fatura: payload.nome_condominio_fatura || null,
        vencimento_fatura: payload.vencimento_fatura || null,
        // A coluna existe desde a 0041 e um trigger a espelha em
        // `consumos_faturas.proxima_leitura` — o dado fica guardado nos dois
        // lugares sem código extra.
        proxima_leitura_fatura: payload.proxima_leitura_fatura || null,
        valor_fatura: payload.valor_fatura,
        dados_extraidos_em: new Date().toISOString(),
      }).eq('id', arq.id);
      if (error) throw error;
      addToast('Dados salvos!', 'success');
      setEditandoFaturaId(null);
      await fetchArquivosDoPacote(activePacote.id);
    } catch (e) {
      addToast('Erro ao salvar: ' + e.message, 'error');
    } finally {
      setSavingFaturaId(null);
    }
    oferecerPreenchimentoConsumos();
  }

  // ── Preencher consumos (água/gás/energia) na planilha a partir dos anexos ──
  const [consumoPreview, setConsumoPreview] = useState(null); // { linhas:[{rateio_id,nome,servico,atual,novo,aplicar}], mes, ano }
  const [aplicandoConsumo, setAplicandoConsumo] = useState(false);

  async function recarregarConferencia() {
    if (!activePacote?.condominio_id) return;
    try {
      const token = await getAccessToken();
      const resp = await fetch(
        `/api/condominio/${activePacote.condominio_id}/conferencia?mes=${activePacote.mes_referencia}&ano=${activePacote.ano_referencia}&retificacao=false`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      if (resp.ok) setConfData(await resp.json());
    } catch { /* silencioso */ }
  }

  async function oferecerPreenchimentoConsumos({ forcar = false } = {}) {
    if (!activePacote?.condominio_id) return;
    try {
      const d = await apiFetch(`/api/condominio/${activePacote.condominio_id}/consumos-planilha?pacote_id=${activePacote.id}&mes=${activePacote.mes_referencia}&ano=${activePacote.ano_referencia}`);
      const linhas = (d?.linhas || [])
        .map(l => ({ ...l, aplicar: Number(l.atual || 0) !== Number(l.novo) }));
      const semVerba = d?.sem_verba || [];
      // `forcar` vem de quem REMOVEU um anexo: aí a prévia tem de abrir mesmo
      // que não haja o que mudar, porque o que mudou foi para MENOS e a planilha
      // continua com o valor antigo até alguém reaplicar.
      if (!forcar && !linhas.some(l => l.aplicar) && !semVerba.length) return;
      setConsumoPreview({
        linhas, semVerba, verbas: d?.verbas || [], atribuicoes: {},
        mes: activePacote.mes_referencia, ano: activePacote.ano_referencia,
      });
    } catch { /* não atrapalha o anexo */ }
  }

  // Diz de qual verba é uma conta que o sistema não soube resolver, e recarrega
  // a prévia já com ela no lugar certo.
  async function atribuirConta(arquivoId, rateioId) {
    if (!rateioId) return;
    setConsumoPreview(p => ({ ...p, atribuicoes: { ...(p.atribuicoes || {}), [arquivoId]: rateioId } }));
    try {
      await apiPost(`/api/condominio/${activePacote.condominio_id}/consumos-planilha`, {
        mes: consumoPreview.mes, ano: consumoPreview.ano, itens: [],
        atribuicoes: [{ arquivo_id: arquivoId, rateio_id: rateioId }],
      });
      await oferecerPreenchimentoConsumos({ forcar: true });
    } catch (e) {
      addToast('Não consegui guardar a verba: ' + (e.message || ''), 'error');
    }
  }

  // Tira a conta da verba — para quando a fatura foi parar no lugar errado.
  // Ela volta para "de qual verba é?" em vez de sumir.
  async function tirarConta(arquivoId) {
    try {
      const { error } = await supabase.from('emissoes_arquivos')
        .update({ rateio_id: null }).eq('id', arquivoId);
      if (error) throw error;
      await oferecerPreenchimentoConsumos({ forcar: true });
    } catch (e) {
      addToast('Não consegui tirar: ' + (e.message || e), 'error');
    }
  }

  async function aplicarConsumos() {
    if (!consumoPreview) return;
    const itens = consumoPreview.linhas.filter(l => l.aplicar).map(l => ({ rateio_id: l.rateio_id, valor: l.novo }));
    if (!itens.length) { setConsumoPreview(null); return; }
    setAplicandoConsumo(true);
    try {
      const atribuicoes = Object.entries(consumoPreview.atribuicoes || {})
        .map(([arquivo_id, rateio_id]) => ({ arquivo_id, rateio_id }));
      await apiPost(`/api/condominio/${activePacote.condominio_id}/consumos-planilha`, {
        mes: consumoPreview.mes, ano: consumoPreview.ano, itens, atribuicoes,
      });
      addToast('Consumos preenchidos na planilha!', 'success');
      setConsumoPreview(null);
      await recarregarConferencia();
    } catch (e) {
      addToast('Erro ao preencher: ' + (e.message || ''), 'error');
    } finally {
      setAplicandoConsumo(false);
    }
  }

  useEffect(() => {
    fetchDados();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Assinatura compartilhada (lib/realtime.js): uma por tabela na aba inteira.
  // Esta tela sozinha abria seis canais; somada às outras, um único INSERT em
  // `emissoes_pacotes` disparava oito rebuscas ao mesmo tempo.
  useRealtime(['emissoes_pacotes'], () => fetchPacotes());
  useRealtime(['emissoes_arquivos'], () => { if (activePacote) fetchArquivosDoPacote(activePacote.id); });
  useRealtime(['processos'], () => fetchProcessos());
  useRealtime(['emissoes_preparacao'], () => fetchPreparacao());
  useRealtime(['edicoes_mensais'], () => fetchEdicoes());
  useRealtime(['alteracoes_rateio'], () => fetchAlteracoes());

  // Refaz quando mes/ano mudam — os pacotes também, agora que o recorte de mês
  // é feito no banco.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { fetchPacotes(); fetchPreparacao(); fetchAlteracoes(); fetchEdicoes(); }, [mes, ano]);

  // Voltou para a aba: rebusca. O realtime cobre parte, mas não sobrevive à aba
  // dormindo nem cobria tabela fora da publicação (ver 0090).
  useRevalidarAoVoltar(() => {
    fetchPacotes(); fetchPreparacao(); fetchEdicoes(); fetchProcessos();
    if (activePacote) fetchArquivosDoPacote(activePacote.id);
  });

  // Chegando pelo link do Dashboard: abre o pacote daquele condomínio+mês —
  // criando, se ainda não existir. É o que se quer ao clicar na linha: já estar
  // dentro da emissão.
  //
  // `handleCriarOuAbrirPacote` é a MESMA porta do botão "+ Criar", então todas
  // as travas continuam valendo (gerente editando, mês fechado, alteração
  // prevista). Só se espera `grupoId`: sem os grupos carregados, um condomínio
  // de dois vencimentos criaria a emissão sem grupo nenhum.
  //
  // Lembrete do efeito colateral, aceito de propósito: desde a 0088 o rascunho
  // trava as cobranças extras do mês. Cancelar o rascunho devolve.
  const linkJaTratado = useRef(false);
  useEffect(() => {
    if (linkJaTratado.current || loading) return;
    const q = new URLSearchParams(window.location.search);
    const qCondo = q.get('condo');
    if (!qCondo) { linkJaTratado.current = true; return; }
    // Espera o condomínio do link virar o selecionado e a busca de grupos
    // TERMINAR — terminar, não achar algo. Condomínio sem grupo é caso válido.
    if (condoId !== qCondo || gruposCarregadosDe !== qCondo) return;

    linkJaTratado.current = true;
    const achado = pacotes.find(p =>
      p.condominio_id === qCondo && p.mes_referencia === mes && p.ano_referencia === ano);
    if (achado) abrirPacote(achado);
    else handleCriarOuAbrirPacote();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pacotes, condoId, gruposCarregadosDe, loading, mes, ano]);

  // Carrega a referência do gerente (planilha do mês + cobranças extras) ao abrir um pacote
  useEffect(() => {
    if (!activePacote?.condominio_id) { setConfData(null); setCobrancasSel(null); return; }
    let cancel = false;
    (async () => {
      setConfLoading(true);
      try {
        const token = await getAccessToken();
        const resp = await fetch(
          `/api/condominio/${activePacote.condominio_id}/conferencia?mes=${activePacote.mes_referencia}&ano=${activePacote.ano_referencia}&retificacao=false`,
          { headers: { Authorization: `Bearer ${token}` } },
        );
        if (!resp.ok || cancel) return;
        const d = await resp.json();
        if (cancel) return;
        setConfData(d);
        // Cobrança sem documento nunca entra sozinha na seleção.
        //
        // Extra é dinheiro cobrado do condômino, e sem o comprovante ninguém
        // responde "por que estou pagando isso?". Já aconteceu de a mesma
        // cobrança entrar duas vezes — uma com anexo e outra sem — e não haver
        // como saber qual era a boa.
        // Duas travas, pelo mesmo motivo: nao cobrar do condomino o que ainda
        // nao esta resolvido. Sem documento, ninguem sabe por que aquilo esta
        // sendo cobrado; com alteracao pendente, o proprio valor esta sob
        // revisao e ja se sabe que vai mudar.
        const podeEntrar = (c) => (c.attachments || []).length > 0 && !c.alteracao_proposta;
        const ids = (d.cobrancas_extras || []).filter(podeEntrar).map(c => c.id);
        const salvas = activePacote.cobrancas_incluidas;
        // Seleção inicial: o que já foi salvo no pacote, senão todas as que têm
        // documento. Salva antiga sem anexo também é descartada — o que valia
        // ontem não vale agora que a regra existe.
        setCobrancasSel(new Set(Array.isArray(salvas) ? salvas.filter(id => ids.includes(id)) : ids));
      } catch { /* referência é opcional, não bloqueia a emissão */ }
      finally { if (!cancel) setConfLoading(false); }
    })();
    return () => { cancel = true; };
  }, [activePacote?.id, confReload]);

  // O documento que faltou, anexado aqui — na tela onde a falta aparece.
  //
  // A trava de documento obrigatório só vale para cobrança nascida depois
  // dela. As lançadas antes ficaram num beco: não entram na emissão por falta
  // de documento, e não havia onde anexar o documento. São 31 só no mês que
  // está sendo emitido.
  async function anexarDocumentoCobranca(cobranca, file) {
    if (!file) return;
    setAnexandoDoc(cobranca.id);
    try {
      const caminho = `cobrancas_extras/${activePacote.condominio_id}/${Date.now()}_${safeStorageName(file.name)}`;
      const { error: upErr } = await supabase.storage.from('emissoes').upload(caminho, file);
      if (upErr) throw upErr;
      await apiPost(`/api/cobrancas-extras/${cobranca.id}/documento`, { attachments: [caminho] });
      addToast('Documento anexado. A cobrança já pode entrar na emissão.', 'success');
      setConfReload(n => n + 1);
    } catch (err) {
      addToast('Não foi possível anexar: ' + (err?.message || err), 'error');
    } finally {
      setAnexandoDoc(null);
    }
  }

  // ── Conferência de pendências, DENTRO da emissão ──
  // Antes isto era porteiro: sem marcar "pronto p/ emitir" a emissão nem abria.
  // Virou lista de conferência: abre-se a emissão assim que o gerente libera e
  // confere-se o que falta aqui, olhando os anexos que já estão na tela — que é
  // a hora em que dá para saber de verdade.
  const [salvandoPrep, setSalvandoPrep] = useState(null);

  async function marcarPendencia(campo, valor) {
    if (!activePacote) return;
    const chave = `${activePacote.condominio_id}_${activePacote.mes_referencia}_${activePacote.ano_referencia}`;
    const atual = preparacaoMap[chave];
    setSalvandoPrep(campo);
    try {
      const payload = {
        condominio_id: activePacote.condominio_id,
        mes_referencia: activePacote.mes_referencia,
        ano_referencia: activePacote.ano_referencia,
        [campo]: valor,
        atualizado_por: user?.id || null,   // mesmo campo que o ModalPreparacao grava
        atualizado_em: new Date().toISOString(),
      };
      // A etapa acompanha o que foi conferido — deixou de ser digitada à mão.
      const temFatura    = campo === 'data_fatura'    ? !!valor : !!atual?.data_fatura;
      const temRelatorio = campo === 'data_relatorio' ? !!valor : !!atual?.data_relatorio;
      payload.etapa = temFatura && temRelatorio ? 'pronto_para_emitir'
                    : temFatura ? 'aguardando_relatorio'
                    : 'aguardando_fatura';

      const { error } = atual?.id
        ? await supabase.from('emissoes_preparacao').update(payload).eq('id', atual.id)
        : await supabase.from('emissoes_preparacao').insert(payload);
      if (error) throw error;
      await fetchPreparacao();
    } catch (e) {
      addToast('Não consegui salvar a conferência: ' + (e.message || e), 'error');
    } finally {
      setSalvandoPrep(null);
    }
  }

  // ── Ordem manual dos arquivos (0092) ──
  // A ordem de extração é automática por categoria. Serve para a maioria, mas
  // não para todos — e não havia como mudar sem mexer no código. Arrastando,
  // a pessoa define e a ordem dela passa a mandar.
  const [arrastandoId, setArrastandoId] = useState(null);
  const [alvoId, setAlvoId] = useState(null);
  const [salvandoOrdem, setSalvandoOrdem] = useState(false);

  const podeOrdenar = ['rascunho', 'solicitar_correcao'].includes(
    (activePacote?.status || '').toLowerCase(),
  );

  async function soltarNaPosicao(destinoId) {
    setAlvoId(null);
    const origemId = arrastandoId;
    setArrastandoId(null);
    if (!origemId || !destinoId || origemId === destinoId) return;

    const lista = [...pacoteArquivos];
    const de = lista.findIndex(a => a.id === origemId);
    const para = lista.findIndex(a => a.id === destinoId);
    if (de < 0 || para < 0) return;

    const [movido] = lista.splice(de, 1);
    lista.splice(para, 0, movido);

    // Otimista: a lista reordena na hora, e o banco confirma atrás.
    const comOrdem = lista.map((a, i) => ({ ...a, ordem: i + 1 }));
    setPacoteArquivos(comOrdem);

    setSalvandoOrdem(true);
    try {
      // Grava a ordem de TODOS, não só dos dois que se moveram: assim não sobra
      // arquivo com ordem nula no meio, que cairia na regra automática e
      // apareceria fora do lugar.
      for (const a of comOrdem) {
        const { error } = await supabase.from('emissoes_arquivos')
          .update({ ordem: a.ordem }).eq('id', a.id);
        if (error) throw error;
      }
    } catch (e) {
      addToast('Não consegui salvar a ordem: ' + (e.message || e), 'error');
      await fetchArquivosDoPacote(activePacote.id);   // volta ao que está no banco
    } finally {
      setSalvandoOrdem(false);
    }
  }

  // Marca/desmarca uma cobrança e persiste a seleção no pacote
  async function toggleCobranca(id) {
    setCobrancasSel(prev => {
      const next = new Set(prev || []);
      if (next.has(id)) next.delete(id); else next.add(id);
      const arr = Array.from(next);
      supabase.from('emissoes_pacotes').update({ cobrancas_incluidas: arr }).eq('id', activePacote.id)
        .then(({ error }) => { if (error) addToast('Erro ao salvar seleção: ' + error.message, 'error'); });
      return next;
    });
  }

  async function fetchAlteracoes() {
    const { data } = await supabase
      .from('alteracoes_rateio')
      .select('id, condominio_id, mes_referencia, ano_referencia, tipo, data_evento, descricao, status')
      .eq('mes_referencia', mes)
      .eq('ano_referencia', ano)
      .eq('status', 'prevista');
    if (data) {
      const map = {};
      data.forEach(a => {
        const k = `${a.condominio_id}_${a.mes_referencia}_${a.ano_referencia}`;
        if (!map[k]) map[k] = [];
        map[k].push(a);
      });
      setAlteracoesPrevMap(map);
    }
  }

  const jaCarregouRef = useRef(false);

  async function fetchDados() {
    // Spinner de tela cheia SÓ na primeira carga. Antes, todo rebusca acendia o
    // spinner e desmontava a árvore: carteira expandida fechava, rolagem
    // voltava ao topo, filtro parecia "sair de ordem". O dado nem mudava — o
    // que se perdia era o lugar.
    if (!jaCarregouRef.current) setLoading(true);
    try {
      await Promise.all([fetchCondominios(), fetchPacotes(), fetchProcessos(), fetchPreparacao()]);
    } finally {
      jaCarregouRef.current = true;
      setLoading(false);
    }
  }

  // Quantos dias inteiros de espera (0088). Só a data conta.
  function diasDeEspera(iso) {
    if (!iso) return null;
    const d0 = new Date(iso); d0.setHours(0, 0, 0, 0);
    const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
    return Math.max(0, Math.round((hoje - d0) / 86400000));
  }

  async function fetchPreparacao() {
    const { data } = await supabase
      .from('emissoes_preparacao')
      .select('*')
      .eq('mes_referencia', mes)
      .eq('ano_referencia', ano);
    if (data) {
      const map = {};
      data.forEach(p => { map[`${p.condominio_id}_${p.mes_referencia}_${p.ano_referencia}`] = p; });
      setPreparacaoMap(map);
    }
  }

  // Liberação do gerente por condomínio+mês (0034). É ela que destrava a emissão:
  // enquanto o gerente está mexendo na planilha, montar a emissão em cima de
  // números que ainda vão mudar é retrabalho garantido.
  //
  // SEM registro = mês nunca aberto para o gerente = nada pendente, pode emitir.
  // Tratar "sem registro" como bloqueio travaria a base inteira, porque a maioria
  // dos meses nunca passou pela abertura.
  async function fetchEdicoes() {
    const { data } = await supabase
      .from('edicoes_mensais')
      .select('condominio_id, mes_referencia, ano_referencia, status, liberado_em')
      .eq('mes_referencia', mes)
      .eq('ano_referencia', ano);
    const map = {};
    (data || []).forEach(e => { map[`${e.condominio_id}_${e.mes_referencia}_${e.ano_referencia}`] = e; });
    setEdicoesMap(map);
  }

  // O gerente está com a planilha na mão? Só isso trava.
  function gerenteEditando(condoIdAlvo) {
    const st = edicoesMap[`${condoIdAlvo}_${mes}_${ano}`]?.status;
    return st === 'em_edicao' || st === 'reabertura_solicitada';
  }

  async function fetchProcessos() {
    const anoAtual = new Date().getFullYear();
    const semAtual = new Date().getMonth() < 6 ? 1 : 2;
    const { data } = await supabase
      .from('processos')
      .select('id, condominio_id, status')
      .eq('year', anoAtual)
      .eq('semester', semAtual);
    if (data) {
      const map = {};
      data.forEach(p => { map[p.condominio_id] = { id: p.id, status: p.status }; });
      setProcessosMap(map);
    }
  }

  async function fetchCondominios() {
    const { data } = await supabase
      .from('condominios')
      .select('*, gerentes:gerente_id(id, profiles!gerentes_profile_id_fkey(full_name))')
      .order('name');
    if (data) setCondominios(data);
  }

  async function fetchPacotes() {
    // Só o mês exibido. Antes trazia TODO pacote já criado — incluindo os campos
    // de snapshot, que guardam a planilha inteira em JSON por emissão — e a
    // tela usava só um mês. Depois varria `emissoes_arquivos` inteira para
    // contar arquivos por pacote.
    const { data } = await supabase
      .from('emissoes_pacotes')
      .select('*, condominios(name, gerente_id, gerentes:gerente_id(profiles!gerentes_profile_id_fkey(full_name)))')
      .eq('mes_referencia', mes)
      .eq('ano_referencia', ano)
      .order('criado_em', { ascending: false });

    if (data) {
      const ids = data.map(p => p.id);
      const { data: arquivos } = ids.length
        ? await supabase.from('emissoes_arquivos').select('id, pacote_id').in('pacote_id', ids)
        : { data: [] };

      const countMap = {};
      (arquivos || []).forEach(a => {
        countMap[a.pacote_id] = (countMap[a.pacote_id] || 0) + 1;
      });

      const comGrupo = await anexarGrupos(supabase, data);
      setPacotes(comGrupo.map(p => ({ ...p, numArquivos: countMap[p.id] || 0 })));
    }
  }

  async function fetchArquivosDoPacote(pacoteId) {
    const { data } = await supabase
      .from('emissoes_arquivos')
      .select('*')
      .eq('pacote_id', pacoteId)
      // Ordem manual primeiro (0092); quem ainda não foi arrastado (ordem nula)
      // fica no fim, na ordem de chegada. `nullsFirst: false` é o que garante
      // isso — sem ele o Postgres põe NULL no começo em ordem crescente.
      .order('ordem', { ascending: true, nullsFirst: false })
      .order('criado_em', { ascending: true });
    if (data) setPacoteArquivos(data);
  }

  // Toggle cadeado planilha por condomínio
  async function handleToggleLock(condo) {
    const proc = processosMap[condo.id];
    const isLocked = proc?.status === 'Edição finalizada';
    const novoStatus = isLocked ? 'Em edição' : 'Edição finalizada';

    // Optimistic
    setLockingCondo(condo.id);
    setProcessosMap(prev => ({
      ...prev,
      [condo.id]: { ...prev[condo.id], status: novoStatus }
    }));

    try {
      await apiPost(`/api/condominio/${condo.id}/processo/force`, {
        status: novoStatus,
        year: new Date().getFullYear()
      });
      addToast(
        isLocked ? `Planilha de ${condo.name} reaberta` : `Planilha de ${condo.name} bloqueada`,
        isLocked ? 'success' : 'info'
      );
    } catch (err) {
      // Rollback
      setProcessosMap(prev => ({
        ...prev,
        [condo.id]: proc
      }));
      addToast('Erro ao alterar status: ' + err.message, 'error');
    } finally {
      setLockingCondo(null);
    }
  }

  // --- AÇÕES ---

  // Mês encerrado = anterior ao mês de trabalho (mesFechado), a MESMA régua da
  // planilha. Antes era "passou o último dia do mês", que em 05/08 ainda dava
  // agosto como aberto — mas os boletos de agosto foram emitidos em julho e já
  // estão vencendo. Agora agosto para trás fecha, e só setembro (o mês de
  // trabalho) segue aberto.
  const periodoPassado = mesFechado(mes, ano);

  async function handleCriarOuAbrirPacote(e) {
    e?.preventDefault?.();
    if (!condoId) return addToast('Selecione um condomínio', 'error');

    // Desde a 0086 pode haver MAIS DE UM pacote no mesmo condomínio+mês (um por
    // grupo/vencimento). `maybeSingle()` estourava PGRST116 assim que o segundo
    // aparecia — por isso a busca traz a lista e escolhe pelo grupo.
    const { data: doMes, error: errBusca } = await supabase
      .from('emissoes_pacotes')
      .select('*')
      .eq('condominio_id', condoId)
      .eq('mes_referencia', mes)
      .eq('ano_referencia', ano);
    if (errBusca) return addToast('Erro ao procurar pacote: ' + errBusca.message, 'error');

    const lista = doMes || [];
    // Grupo escolhido, ou o único que existe. Pacote antigo tem grupo_id NULL e
    // conta como o primeiro grupo (o "Geral" do backfill).
    const alvo = grupoId || gruposCondo[0]?.id || null;
    const existing = lista.find(p => (p.grupo_id || gruposCondo[0]?.id || null) === alvo) || null;

    if (existing) {
      setActivePacote(existing);
      await fetchArquivosDoPacote(existing.id);
      addToast('Pacote existente aberto para edição.', 'info');
    } else if (periodoPassado) {
      addToast(`Não é possível criar emissão para ${String(mes).padStart(2,'0')}/${ano} — mês já encerrado.`, 'error');
      return;
    } else {
      // A trava é a planilha estar na mão do gerente, não uma etapa marcada à mão.
      // Liberou, abre a emissão — o que falta (fatura, relatório) se confere
      // DENTRO dela, na lista de conferência, antes de mandar para aprovação.
      if (gerenteEditando(condoId)) {
        addToast('O gerente ainda está com a planilha deste mês. A emissão abre quando ele liberar.', 'warning');
        return;
      }
      const { data: novo, error } = await supabase
        .from('emissoes_pacotes')
        .insert({
          condominio_id: condoId,
          mes_referencia: mes,
          ano_referencia: ano,
          status: 'rascunho',
          uploaded_by: profile.id,
          ...(alvo ? { grupo_id: alvo } : {}),
        })
        .select()
        .single();

      if (error) {
        addToast('Erro ao criar pacote: ' + error.message, 'error');
      } else {
        setActivePacote(novo);
        setPacoteArquivos([]);
        addToast('Novo pacote criado! Adicione os arquivos.', 'success');
        fetchPacotes();
      }
    }
  }

  async function sha256OfFile(file) {
    const buf = await file.arrayBuffer();
    const hashBuf = await crypto.subtle.digest('SHA-256', buf);
    return Array.from(new Uint8Array(hashBuf)).map(b => b.toString(16).padStart(2, '0')).join('');
  }

  async function handleUploadArquivo(fileInput, opts = {}) {
    if (!fileInput || !activePacote) return;
    // categoria: 'emissao' | 'concessionaria' | 'outros' | 'relatorio_leitura'
    const categoria = opts.categoria || 'emissao';
    const subtipo   = opts.subtipo || null;
    const extras    = opts.extras || {};  // campos especificos (relatorio_*, etc)
    const skipDuplicataCheck = opts.skipDuplicataCheck || false;

    setIsUploading(true);
    try {
      // 1) Verifica duplicata ANTES de subir o arquivo (so para concessionaria e relatorio)
      let arquivoHash = null;
      if (!skipDuplicataCheck && (categoria === 'concessionaria' || categoria === 'relatorio_leitura')) {
        try {
          arquivoHash = await sha256OfFile(fileInput);
        } catch {}

        const checkBody = {
          tipo: categoria === 'relatorio_leitura' ? 'relatorio' : 'fatura',
          condominio_id: activePacote.condominio_id,
          mes_referencia: mes,
          ano_referencia: ano,
          arquivo_hash: arquivoHash,
        };
        if (categoria === 'concessionaria') {
          checkBody.concessionaria = (subtipo || '').toUpperCase();
          checkBody.leitura_atual = extras.leitura_atual_fatura || null;
          checkBody.proxima_leitura = extras.proxima_leitura_fatura || null;
          checkBody.vencimento = extras.vencimento_fatura || null;
          checkBody.valor = extras.valor_fatura ?? null;
        } else {
          checkBody.empresa = (extras.relatorio_empresa || '').toUpperCase();
          checkBody.tipo_servico = (extras.relatorio_tipo_servico || '').toLowerCase();
          checkBody.consumo_total = extras.relatorio_consumo_total;
          checkBody.numero_unidades = extras.relatorio_unidades;
          checkBody.valor_total = extras.relatorio_valor_total;
        }
        try {
          const check = await apiPost('/api/consumos/check-duplicata-completa', checkBody);
          if (check?.bloqueia) {
            // Abre modal de sancionamento
            setDuplicataInfo({
              alertas: check.alertas || [],
              anomalia: check.anomalia,
              pendingFile: fileInput,
              pendingMeta: { categoria, subtipo, extras, arquivoHash },
            });
            setIsUploading(false);
            return;
          }
          // Alertas amarelos so avisam, nao bloqueiam
          const avisos = (check?.alertas || []).filter(a => a.nivel === 'aviso');
          if (avisos.length > 0) {
            addToast(`⚠ ${avisos[0].mensagem}`, 'warning');
          }
        } catch (e) {
          console.warn('check-duplicata-completa falhou (ignorando):', e?.message);
        }
      }

      // 2) Upload do arquivo
      const extensao = fileInput.name.split('.').pop().toLowerCase();
      const displayName = opts.nomeArquivo || fileInput.name;  // nome padronizado quando houver
      const randomId = Math.random().toString(36).substring(7);
      const filePath = `${activePacote.condominio_id}/${ano}/${mes}/${categoria}/${randomId}_${safeStorageName(displayName)}`;
      const { error: uploadError } = await supabase.storage.from('emissoes').upload(filePath, fileInput);
      if (uploadError) throw uploadError;

      // 3) Insert na tabela emissoes_arquivos
      const insertPayload = {
        condominio_id: activePacote.condominio_id,
        pacote_id: activePacote.id,
        tipo: 'emissao',
        categoria,
        subtipo,
        arquivo_url: filePath,
        arquivo_nome: displayName,
        formato: extensao,
        mes_referencia: mes,
        ano_referencia: ano,
        status: 'pendente',
        uploaded_by: profile.id,
        ...extras,
      };
      if (arquivoHash && !insertPayload.arquivo_hash) insertPayload.arquivo_hash = arquivoHash;
      const { data: inserted, error: dbError } = await supabase
        .from('emissoes_arquivos')
        .insert(insertPayload)
        .select('id')
        .single();

      if (dbError) throw dbError;

      addToast(`${fileInput.name} adicionado!`, 'success');
      await fetchArquivosDoPacote(activePacote.id);
      fetchPacotes();

      // Relatório de leitura já vem com valor → oferece preencher a planilha.
      //
      // A fatura de concessionária também entra: quando o condomínio tem mais
      // de uma verba do mesmo serviço (água do R e do NR, energia das lojas), é
      // aqui que a tela pergunta em qual delas o valor entra. Sem isso, a
      // pergunta só apareceria na próxima vez que alguém abrisse a prévia.
      if (['relatorio_leitura', 'concessionaria'].includes(categoria)) {
        oferecerPreenchimentoConsumos();
      }

      // Para concessionaria: ja deixa o form de dados aberto pra preencher
      if (categoria === 'concessionaria' && inserted?.id) {
        setEditandoFaturaId(inserted.id);
      }
    } catch (err) {
      addToast(`Erro no upload: ${err.message}`, 'error');
    } finally {
      setIsUploading(false);
    }
  }

  async function getAccessToken() {
    const { data: { session } } = await supabase.auth.getSession();
    return session?.access_token || '';
  }

  // Sobe o documento que comprova a APROVAÇÃO da repetição (anexo 'outros') e devolve {url, nome}
  async function uploadAnexoAprovacao(file) {
    const extensao = file.name.split('.').pop().toLowerCase();
    const randomId = Math.random().toString(36).substring(7);
    const displayName = `Aprovacao_repeticao_${file.name}`;
    const filePath = `${activePacote.condominio_id}/${ano}/${mes}/outros/${randomId}_${safeStorageName(displayName)}`;
    const { error: upErr } = await supabase.storage.from('emissoes').upload(filePath, file);
    if (upErr) throw upErr;
    // Sem conferir, este era o defeito do boleto de novo: arquivo no bucket,
    // nenhuma linha apontando para ele, e a função devolvendo {url, nome} como
    // se tivesse dado certo. O anexo que COMPROVA a aprovação da repetição
    // sumiria justamente quando alguém fosse auditar.
    const { error: errAnexo } = await supabase.from('emissoes_arquivos').insert({
      condominio_id: activePacote.condominio_id,
      pacote_id: activePacote.id,
      tipo: 'emissao',
      categoria: 'outros',
      subtipo: 'Aprovação de repetição',
      arquivo_url: filePath,
      arquivo_nome: displayName,
      formato: extensao,
      mes_referencia: mes,
      ano_referencia: ano,
      status: 'pendente',
      uploaded_by: profile.id,
    });
    if (errAnexo) throw errAnexo;
    return { url: filePath, nome: displayName };
  }

  // Converte o dict da extração nos campos (colunas) de emissoes_arquivos
  function mapExtracaoToExtras(extracao, categoria) {
    const { texto_bruto, ...brutos } = extracao || {};
    const base = {
      arquivo_hash: extracao?.arquivo_hash || null,
      extracao_status: extracao?.status || (extracao?.erro ? 'falha' : ((extracao?.confianca || 0) >= 0.8 ? 'sucesso' : 'parcial')),
      extracao_confianca: extracao?.confianca ?? null,
      extracao_dados_brutos: brutos,
      extracao_em: new Date().toISOString(),
    };
    if (categoria === 'concessionaria') {
      return {
        ...base,
        nome_condominio_fatura: extracao?.cliente || null,
        vencimento_fatura: extracao?.vencimento || null,
        // Amarra a conta a sua instalacao: e por ela que o mes seguinte sabe
        // que esta fatura e a da piscina, e nao a do bloco.
        instalacao: extracao?.instalacao || null,
        valor_fatura: extracao?.valor ?? null,
        leitura_atual_fatura: extracao?.leitura_atual || null,
        proxima_leitura_fatura: extracao?.proxima_leitura || null,
        dados_extraidos_em: new Date().toISOString(),
      };
    }
    // relatorio_leitura
    return {
      ...base,
      relatorio_empresa: extracao?.subtipo || null,
      relatorio_tipo_servico: extracao?.tipo_servico || 'agua',
      relatorio_data_leitura: extracao?.data_leitura || null,
      relatorio_unidades: extracao?.numero_unidades ?? null,
      relatorio_consumo_total: extracao?.consumo_total ?? null,
      relatorio_valor_total: extracao?.valor_total ?? null,
    };
  }

  // Detecta duplicata DENTRO do mesmo pacote (instantâneo, sem depender do banco/trigger).
  // Pega o caso "anexei a mesma conta 2x" mesmo antes da sincronização chegar em /consumos.
  function detectarDuplicataLocal(extracao, categoria) {
    const lista = pacoteArquivos || [];
    const hash = extracao?.arquivo_hash;
    // 1) Mesmo arquivo (hash idêntico)
    if (hash) {
      const igual = lista.find(a => a.arquivo_hash && a.arquivo_hash === hash);
      if (igual) return {
        nivel: 'bloqueio', tipo: 'hash_identico',
        mensagem: 'Este mesmo arquivo PDF já foi anexado nesta emissão.',
        detalhes: { arquivo_nome: igual.arquivo_nome },
      };
    }
    // 2) Já existe conta do mesmo serviço no pacote — AVISO, não bloqueio.
    //
    // Condomínio com dois hidrômetros, bloco e casa do zelador, duas
    // instalações: duas contas de SABESP no mesmo mês é situação NORMAL, não
    // erro. Bloquear obrigava a escrever motivo e anexar comprovante de
    // "aprovação da repetição" para lançar uma conta legítima — cerimônia de
    // fraude para trabalho de rotina. Foi o que travou o condomínio 340.
    //
    // A cerimônia continua valendo para o caso 1 (MESMO PDF), que é duplicata
    // de verdade. Aqui basta confirmar que é outra conta.
    //
    // O backend já dizia isso na mensagem dele: "Se for outra instalação/conta,
    // pode anexar normalmente." Era a tela que discordava.
    if (categoria === 'concessionaria') {
      const sub = (extracao?.subtipo || '').toUpperCase();
      const igual = lista.find(a => a.categoria === 'concessionaria' && (a.subtipo || '').toUpperCase() === sub && sub);
      if (igual) return {
        nivel: 'aviso', tipo: 'fatura_ja_existe',
        mensagem: `Já existe uma fatura de ${sub} nesta emissão (${igual.arquivo_nome}). `
          + 'Se esta for de outra instalação, pode anexar — os valores somam.',
        detalhes: { concessionaria: sub, arquivo_nome: igual.arquivo_nome },
      };
    } else if (categoria === 'relatorio_leitura') {
      const emp = (extracao?.subtipo || '').toUpperCase();
      const serv = (extracao?.tipo_servico || 'agua').toLowerCase();
      const igual = lista.find(a => a.categoria === 'relatorio_leitura'
        && (a.relatorio_empresa || '').toUpperCase() === emp && emp
        && (a.relatorio_tipo_servico || 'agua').toLowerCase() === serv);
      if (igual) return {
        nivel: 'aviso', tipo: 'relatorio_ja_existe',
        mensagem: `Já existe um relatório de ${emp} (${serv}) nesta emissão (${igual.arquivo_nome}). `
          + 'Se este for de outro medidor, pode anexar — os valores somam.',
        detalhes: { empresa_leitura: emp, tipo_servico: serv, arquivo_nome: igual.arquivo_nome },
      };
    }
    return null;
  }

  // Fluxo de upload com extração automática (concessionaria + relatorio_leitura).
  // 1) backend lê o PDF e já checa duplicata. 2) bloqueia -> modal sancionamento.
  // 3) confiança baixa / empresa não identificada -> modal de revisão pré-preenchido.
  // 4) confiança alta + sem bloqueio -> anexa direto.
  // ── Fila de anexos ────────────────────────────────────────────────────
  //
  // Cada fatura pode parar num modal (pertencimento, duplicata, revisão), e o
  // modal só resolve quando a pessoa decide. Por isso um `for` com await não
  // serve: ele dispararia os três de uma vez e o último sobrescreveria os
  // outros — que é exatamente o que acontecia quando se escolhia várias contas.
  //
  // A fila guarda o resto e só anda quando o arquivo da vez termina, seja
  // anexado ou descartado.
  const filaRef = useRef([]);
  const [fila, setFila] = useState({ feitos: 0, total: 0 });

  function enfileirarExtracao(files, categoria) {
    const lista = Array.from(files || []);
    if (!lista.length) return;
    filaRef.current = lista.map(f => ({ file: f, categoria }));
    setFila({ feitos: 0, total: lista.length });
    proximoDaFila();
  }

  function proximoDaFila() {
    const proximo = filaRef.current.shift();
    setFila(f => ({ ...f, feitos: f.total - filaRef.current.length - (proximo ? 1 : 0) }));
    if (!proximo) { setFila({ feitos: 0, total: 0 }); return; }
    handleUploadComExtracao(proximo.file, proximo.categoria);
  }

  async function handleUploadComExtracao(file, categoria) {
    // Sem pacote aberto não há onde anexar — mas a fila precisa andar, senão os
    // arquivos seguintes somem sem ninguém saber.
    if (!file || !activePacote) { proximoDaFila(); return; }
    setExtraindo(true);
    try {
      const token = await getAccessToken();
      const formData = new FormData();
      formData.append('file', file);
      const params = new URLSearchParams({
        condominio_id: activePacote.condominio_id,
        mes_referencia: String(mes),
        ano_referencia: String(ano),
      });
      const res = await fetch(`/api/consumos/extrair-pdf?${params}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });
      if (!res.ok) throw new Error(`Falha na leitura do PDF (HTTP ${res.status})`);
      const resp = await res.json();
      let extracao = resp.extracao;
      const { alertas, anomalia, bloqueia } = resp;

      // PDF escaneado (sem texto) -> OCR no navegador decifra a imagem e pré-preenche (você confere na revisão)
      const semCampos = !extracao || (extracao.valor == null && extracao.valor_total == null && !extracao.vencimento);
      if (semCampos && categoria === 'concessionaria') {
        try {
          setOcrProg({ p: 0, n: 1 });
          const bc = await decodeBoletoValor(file);                       // VALOR exato (código de barras)
          const texto = await ocrFileToText(file, (p, n) => setOcrProg({ p, n }));
          const parsed = parseFaturaOcr(texto);                            // vencimento + concessionária (OCR)
          extracao = {
            ...(extracao || {}), ...parsed,
            valor: (bc && bc.valor != null) ? bc.valor : parsed.valor,     // barcode tem prioridade sobre OCR
            subtipo: (extracao && extracao.subtipo) || parsed.subtipo,
            confianca: 0.5, ocr: true, barcode: bc ? bc.barcode : null, erro: null,
          };
        } catch (e) {
          addToast('Não consegui decifrar a imagem — preencha manualmente.', 'warning');
        } finally {
          setOcrProg(null);
        }
      }

      const extras = mapExtracaoToExtras(extracao, categoria);
      const subtipo = extracao?.subtipo
        || (categoria === 'relatorio_leitura' ? extras.relatorio_empresa : null);

      // 0) PERTENCIMENTO — bloqueio duro, sem sancionamento (conta de OUTRO condomínio)
      const alertaPert = (alertas || []).find(a => a.tipo === 'pertencimento');
      if (alertaPert) {
        setPertencimentoInfo({ alerta: alertaPert, file, categoria });
        return;
      }

      // 0.5) Duplicata LOCAL no mesmo pacote (instantânea)
      const localDup = detectarDuplicataLocal(extracao, categoria);
      if (localDup) {
        setDuplicataInfo({
          alertas: [localDup], anomalia: null,
          pendingFile: file, pendingMeta: { categoria, subtipo, extras },
        });
        return;
      }

      // 1) Duplicata bloqueante (banco) -> modal de sancionamento (reusa o existente)
      if (bloqueia) {
        setDuplicataInfo({
          alertas: (alertas || []).filter(a => a.tipo !== 'pertencimento'),
          anomalia,
          pendingFile: file,
          pendingMeta: { categoria, subtipo, extras },
        });
        return;
      }

      // 2) Baixa confiança, não identificou, OU fatura sem a próxima leitura
      //    -> revisão manual pré-preenchida.
      //
      // A data da próxima leitura entrou nesta condição porque ela virou
      // obrigatória: sem ela a conta do mês seguinte não entra na fila de
      // cobrança, e ninguém descobre isso até a emissão travar. Extração com
      // confiança alta que não achou a data ainda precisa de olho humano.
      const faltaLeitura = categoria === 'concessionaria' && !extracao?.proxima_leitura;
      if (!extracao?.subtipo || (extracao?.confianca || 0) < 0.8 || faltaLeitura) {
        setRevisaoInfo({ extracao: extracao || {}, categoria, alertas: alertas || [], file });
        return;
      }

      // 3) Confiança alta + sem bloqueio -> anexa direto
      const nomeArquivo = nomeArquivoPadrao(categoria, subtipo, extracao, file.name,
        condominios.find(c => c.id === activePacote.condominio_id)?.name);
      await handleUploadArquivo(file, { categoria, subtipo, extras, skipDuplicataCheck: true, nomeArquivo });
      if (extracao?.desbloqueado) addToast('🔓 PDF protegido foi desbloqueado automaticamente.', 'info');
      const avisos = (alertas || []).filter(a => a.nivel === 'aviso');
      if (avisos.length) addToast(`⚠ ${avisos[0].mensagem}`, 'warning');
      proximoDaFila();          // anexou sem perguntar nada: segue a fila
    } catch (e) {
      addToast('Erro na leitura do PDF: ' + (e.message || e), 'error');
      proximoDaFila();          // um arquivo ruim não pode travar os outros
    } finally {
      setExtraindo(false);
    }
  }

  // Chamado pelo modal de revisão: usuário confirmou/corrigiu os dados.
  // Reroda a checagem de duplicata com os valores finais (skip = false).
  async function confirmarRevisao(categoria, subtipo, extras, file) {
    setRevisaoInfo(null);
    const nomeArquivo = nomeArquivoPadrao(categoria, subtipo, extras, file.name,
      condominios.find(c => c.id === activePacote?.condominio_id)?.name);
    await handleUploadArquivo(file, { categoria, subtipo, extras, skipDuplicataCheck: false, nomeArquivo });
    proximoDaFila();
  }

  async function handleDeleteArquivo(e, id, path, arq) {
    e.stopPropagation();
    if (confirmDeleteArqId !== id) {
      setConfirmDeleteArqId(id);
      addToast('Clique novamente para confirmar a remoção', 'warning');
      setTimeout(() => setConfirmDeleteArqId(null), 3000);
      return;
    }
    try {
      await supabase.storage.from('emissoes').remove([path]);
      const { error } = await supabase.from('emissoes_arquivos').delete().eq('id', id);
      if (error) {
        addToast('Erro ao excluir: ' + error.message, 'error');
        return;
      }
      setConfirmDeleteArqId(null);
      addToast('Arquivo removido.', 'success');
      await fetchArquivosDoPacote(activePacote.id);
      fetchPacotes();

      // Fatura errada removida: o valor que ela colocou na planilha CONTINUA lá.
      //
      // Apagar o anexo não desfaz o que já foi aplicado — e ninguém lembra
      // disso na hora. Reabrir a prévia é o que fecha o ciclo: ela recalcula a
      // partir do que sobrou e mostra "atual → novo" para reaplicar.
      //
      // `forcar` é obrigatório aqui: sem ele a prévia se cala quando o novo
      // valor não é maior que o atual, que é exatamente o caso de uma remoção.
      const ehConsumo = ['concessionaria', 'relatorio_leitura'].includes(arq?.categoria);
      if (ehConsumo) {
        await oferecerPreenchimentoConsumos({ forcar: true });
      }
    } catch (err) {
      addToast('Erro: ' + err.message, 'error');
    }
  }

  async function handleRegistrar(pacote) {
    setActivePacote(pacote);
    const now = new Date();
    const localNow = new Date(now.getTime() - (now.getTimezoneOffset() * 60000)).toISOString().slice(0, 16);
    setDataRegistro(localNow);
    setShowRegistroModal(true);
  }

  async function confirmarRegistro() {
    if (!dataRegistro) return addToast('Informe a data e hora', 'error');

    const selectedDate = new Date(dataRegistro);
    if (selectedDate < new Date(new Date().getTime() - 60000)) {
      return addToast('Não é permitido registrar no passado', 'error');
    }

    // O conjunto sai junto: registrar só esta deixaria o condômino com metade
    // dos boletos. Num condomínio de vencimento único o conjunto tem uma só e
    // isto nunca bloqueia.
    const { ok, pendentes, error: errConj } = await podeRegistrar(supabase, activePacote);
    if (errConj) return addToast('Não consegui conferir as outras emissões do mês: ' + errConj.message, 'error');
    if (!ok) {
      return addToast(
        `Faltam ${pendentes.length} emissão(ões) deste condomínio em ${String(activePacote.mes_referencia).padStart(2,'0')}/${activePacote.ano_referencia} para aprovar. ` +
        `Os boletos do mês saem juntos — registre quando todas estiverem aprovadas.`,
        'warning',
      );
    }

    // Capturar snapshot da planilha para congelar os valores no momento da emissão
    const { data: { session } } = await supabase.auth.getSession();
    let planilha_snapshot = null;
    if (session?.access_token && activePacote.condominio_id) {
      try {
        const resp = await fetch(
          `/api/condominio/${activePacote.condominio_id}/conferencia?mes=${activePacote.mes_referencia}&ano=${activePacote.ano_referencia}&retificacao=false`,
          { headers: { Authorization: `Bearer ${session.access_token}` } },
        );
        if (resp.ok) {
          const conf = await resp.json();
          if (conf.planilha) {
            planilha_snapshot = {
              ...conf.planilha,
              meses: (conf.planilha.meses || []).filter(m => m.mes === activePacote.mes_referencia),
            };
          }
        }
      } catch { /* snapshot é opcional — não bloqueia o registro */ }
    }

    // Congela as cobranças extras incluídas (com anexos crus) — integridade/auditoria:
    // vira um retrato imutável, não some nem muda se a cobrança for editada/apagada depois.
    let cobrancas_snapshot = null;
    if (activePacote.condominio_id) {
      try {
        const { data: rows } = await supabase.from('cobrancas_extras')
          .select('id, description, amount, mes, ano, unidades, attachments, status, parcela_atual, parcela_total')
          .eq('condominio_id', activePacote.condominio_id)
          .eq('mes', activePacote.mes_referencia)
          .eq('ano', activePacote.ano_referencia)
          .neq('status', 'cancelada');
        let list = rows || [];
        const incl = activePacote.cobrancas_incluidas;
        if (Array.isArray(incl)) list = list.filter((c) => incl.includes(c.id));
        cobrancas_snapshot = list.map((c) => ({
          id: c.id, descricao: c.description || 'Cobrança Extra', valor: Number(c.amount) || 0,
          mes: c.mes, ano: c.ano, unidades: c.unidades, attachments: c.attachments || [],
          // Congela a parcela junto: sem isto a emissão registrada perde
          // o "3/6" e vira uma cobranca avulsa aos olhos de quem audita.
          parcela_atual: c.parcela_atual, parcela_total: c.parcela_total,
        }));
      } catch { /* snapshot é opcional */ }
    }

    const semestre = activePacote.mes_referencia <= 6 ? 1 : 2;
    const { data: processo } = await supabase
      .from('processos')
      .select('id')
      .eq('condominio_id', activePacote.condominio_id)
      .eq('year', activePacote.ano_referencia)
      .eq('semester', semestre)
      .maybeSingle();

    // status = 'registrado' | NÃO lacra (fica visível no painel até ser expedida)
    const { error } = await supabase
      .from('emissoes_pacotes')
      .update({
        status: 'registrado',
        atualizado_em: selectedDate.toISOString(),
        ...(processo?.id ? { processo_id: processo.id } : {}),
        ...(planilha_snapshot ? { planilha_snapshot } : {}),
        ...(cobrancas_snapshot !== null ? { cobrancas_snapshot } : {}),
      })
      .eq('id', activePacote.id);

    if (error) {
      addToast('Erro ao registrar: ' + error.message, 'error');
    } else {
      addToast('Emissão registrada! Aguardando expedição.', 'success');
      setShowRegistroModal(false);
      setActivePacote(null);
      fetchPacotes();
    }
  }

  async function handleCancelarRascunho() {
    if (!activePacote || activePacote.status !== 'rascunho') return;
    const confirma = window.confirm(
      `Tem certeza que deseja CANCELAR o rascunho de ${activePacote.condominios?.name || 'este condomínio'}?\n\n` +
      `Esta ação:\n` +
      `• Apaga o pacote (rascunho)\n` +
      `• Apaga todos os ${pacoteArquivos.length} arquivo${pacoteArquivos.length !== 1 ? 's' : ''} enviado${pacoteArquivos.length !== 1 ? 's' : ''}\n` +
      `• NÃO pode ser desfeita`
    );
    if (!confirma) return;

    try {
      // 1. Apaga arquivos do storage + tabela
      const paths = (pacoteArquivos || []).map(a => a.arquivo_url).filter(Boolean);
      if (paths.length) {
        try { await supabase.storage.from('emissoes').remove(paths); } catch {}
      }
      const { error: errArq } = await supabase
        .from('emissoes_arquivos').delete().eq('pacote_id', activePacote.id);
      if (errArq) throw errArq;

      // 2. Apaga o pacote
      const { error: errPac } = await supabase
        .from('emissoes_pacotes').delete().eq('id', activePacote.id);
      if (errPac) throw errPac;

      addToast('Rascunho cancelado e arquivos removidos.', 'success');
      setActivePacote(null);
      setPacoteArquivos([]);
      fetchPacotes();
    } catch (err) {
      addToast('Erro ao cancelar: ' + (err.message || err), 'error');
    }
  }

  async function handleConcluirPacote() {
    if (pacoteArquivos.length === 0) return addToast('Adicione pelo menos 1 arquivo antes de concluir.', 'warning');
    setShowConcluirModal(true);
  }

  async function handleConcluirRapido(pacote) {
    if (pacote.numArquivos === 0) return addToast('Este pacote está vazio.', 'warning');
    
    // Buscar arquivos do pacote para garantir que o modal tenha a contagem correta
    const { data } = await supabase.from('emissoes_arquivos').select('id').eq('pacote_id', pacote.id);
    setPacoteArquivos(data || []);
    setActivePacote(pacote);
    setShowConcluirModal(true);
  }


  async function confirmarConclusao() {
    const ehRespostaCorrecao = (activePacote?.status || '').toLowerCase() === 'solicitar_correcao';
    // Quando reenvia apos correcao: exige arquivo + comentario
    if (ehRespostaCorrecao) {
      if (!respostaCorrecaoFile) return addToast('Anexe o arquivo corrigido.', 'warning');
      if (!respostaCorrecaoComentario.trim()) return addToast('Descreva o que foi corrigido.', 'warning');
    }

    setEnviandoResposta(true);

    let initialStatus = 'Aguardando Gerente';
    // Nível 1 passa direto para a supervisora
    if (nivelAprovacao === 1) {
      initialStatus = 'Aguardando Supervisor';
    }

    const updatePayload = {
      status: initialStatus,
      nivel_aprovacao: String(nivelAprovacao),
      atualizado_em: new Date().toISOString(),
    };

    // Correção corrigida volta para QUEM PEDIU, não para o começo do fluxo.
    //
    // O código acima recomeça o nível — e o nível vem do modal, não do pacote.
    // Com o modal em 1, o gerente pedia correção, o emissor corrigia, e a
    // emissão pulava direto para a supervisora de contabilidade. Quem apontou o
    // erro nunca via se foi resolvido.
    //
    // O nível do pacote também é preservado: reenviar não é hora de mudar o
    // fluxo de aprovação, é hora de responder a um apontamento.
    if (ehRespostaCorrecao) {
      const volta = await statusDeVoltaAposCorrecao(supabase, activePacote.id);
      if (volta) {
        updatePayload.status = volta;
        delete updatePayload.nivel_aprovacao;
      }
    }

    // Upload da resposta de correcao se aplicavel
    if (ehRespostaCorrecao && respostaCorrecaoFile) {
      try {
        const path = `respostas-correcao/${activePacote.id}/${Date.now()}_${respostaCorrecaoFile.name}`;
        const { error: upErr } = await supabase.storage.from('emissoes').upload(path, respostaCorrecaoFile);
        if (upErr) throw upErr;
        updatePayload.resposta_correcao_arquivo_url = path;
        updatePayload.resposta_correcao_arquivo_nome = respostaCorrecaoFile.name;
        updatePayload.resposta_correcao_comentario = respostaCorrecaoComentario.trim();
        updatePayload.resposta_correcao_em = new Date().toISOString();
      } catch (e) {
        setEnviandoResposta(false);
        return addToast('Erro ao subir arquivo da correção: ' + e.message, 'error');
      }
    }

    const { error } = await supabase
      .from('emissoes_pacotes')
      .update(updatePayload)
      .eq('id', activePacote.id);

    setEnviandoResposta(false);

    if (error) {
      addToast('Erro ao concluir pacote: ' + error.message, 'error');
    } else {
      addToast(ehRespostaCorrecao ? 'Correção enviada para nova aprovação!' : 'Emissão concluída e enviada para aprovação!', 'success');
      setShowConcluirModal(false);
      setActivePacote(null);
      setPacoteArquivos([]);
      setRespostaCorrecaoFile(null);
      setRespostaCorrecaoComentario('');
      fetchPacotes();
    }
  }

  async function openFileUrl(arq) {
    const url = await getArquivoUrlSeguro(arq.arquivo_url);
    if (!url) return addToast('Erro ao gerar link.', 'error');
    if (url) {
      setArquivoAberto({
        id: arq.id,
        nome: arq.arquivo_nome,
        url: url,
        processo_id: activePacote?.processo_id || null,
        pacote_id: activePacote?.id || null,
        pacote_status: activePacote?.status || null,
        pacote_nivel: activePacote?.nivel_aprovacao || null,
        comentario_correcao: activePacote?.comentario_correcao || null,
        correcao_arquivo_url: activePacote?.correcao_arquivo_url || null,
        correcao_arquivo_nome: activePacote?.correcao_arquivo_nome || null,
        resposta_correcao_comentario: activePacote?.resposta_correcao_comentario || null,
        resposta_correcao_arquivo_url: activePacote?.resposta_correcao_arquivo_url || null,
        resposta_correcao_arquivo_nome: activePacote?.resposta_correcao_arquivo_nome || null,
        resposta_correcao_em: activePacote?.resposta_correcao_em || null,
        observacao_aprovacao: activePacote?.observacao_aprovacao || null,
        condominio_id: activePacote?.condominio_id || condoId,
        mes: arq.mes_referencia || activePacote?.mes_referencia,
        ano: arq.ano_referencia || activePacote?.ano_referencia,
        eh_retificacao: activePacote?.eh_retificacao || false,
        emitido_por: profile?.id,
        arquivos: pacoteArquivos || []
      });
    }
  }

  function abrirPacote(pacote) {
    setActivePacote(pacote);
    setCondoId(pacote.condominio_id);
    setMes(pacote.mes_referencia);
    setAno(pacote.ano_referencia);
    // O grupo do pacote vai no ref, não no state: o efeito de condoId recarrega
    // os grupos de forma assíncrona e sobrescreveria um setGrupoId feito aqui.
    // Abrir a emissão do dia 10 tem de mostrar o dia 10, não o primeiro grupo.
    // Os dois: o state resolve quando o condomínio não mudou (o efeito não
    // dispara), o ref resolve quando mudou (o efeito zera e depois restaura).
    grupoDesejadoRef.current = pacote.grupo_id || null;
    if (pacote.grupo_id) setGrupoId(pacote.grupo_id);
    fetchArquivosDoPacote(pacote.id);
  }

  // Abre o pacote pedido na URL assim que ele aparece na lista. Uma vez só: o
  // ref é limpo no primeiro acerto, senão qualquer rebusca reabriria o painel
  // por cima do que a pessoa estivesse fazendo.
  useEffect(() => {
    const alvo = pacoteDesejadoRef.current;
    if (!alvo || !pacotes.length) return;
    const p = pacotes.find(x => x.id === alvo);
    if (!p) return;
    pacoteDesejadoRef.current = null;
    abrirPacote(p);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pacotes]);

  // Agrupar condomínios por carteira
  const carteiras = useMemo(() => {
    // Ordem NUMÉRICA pelo código, dentro de cada carteira. A consulta traz por
    // nome, e alfabético não é o mesmo que numérico: "1000" vem antes de "999",
    // e "0001" antes de "001". Quem percorre a lista de cima a baixo espera a
    // sequência dos códigos.
    const codigoDe = (n) => {
      const m = String(n || '').match(/^\s*0*(\d+)/);
      return m ? parseInt(m[1], 10) : Number.MAX_SAFE_INTEGER;
    };
    const groups = {};
    condominios.forEach(c => {
      const gerente = c.gerentes?.profiles?.full_name || 'Sem Carteira';
      if (!groups[gerente]) groups[gerente] = [];
      groups[gerente].push(c);
    });
    for (const g of Object.keys(groups)) {
      groups[g].sort((a, b) => codigoDe(a.name) - codigoDe(b.name)
        || String(a.name || '').localeCompare(String(b.name || '')));
    }
    return groups;
  }, [condominios]);

  // Precisa vir ANTES de `passaNaSituacao`: `useMemo` executa o corpo na hora,
  // durante o render. Declarado depois, o filtro leria a variável na zona morta
  // temporal e derrubava a tela — não no carregamento, mas no instante em que
  // alguém trocasse o filtro de "Todos" para qualquer outro.
  const pacotesPorCondo = useMemo(() => {
    const map = {};
    pacotes.forEach(p => {
      const key = `${p.condominio_id}_${p.mes_referencia}_${p.ano_referencia}`;
      (map[key] = map[key] || []).push(p);
    });
    // Ordem estável: por dia de vencimento, depois pelo nome do grupo.
    for (const k of Object.keys(map)) {
      map[k].sort((a, b) =>
        (a.grupo_due_day ?? 99) - (b.grupo_due_day ?? 99) ||
        String(a.grupo_nome || '').localeCompare(String(b.grupo_nome || '')));
    }
    return map;
  }, [pacotes]);

  // Filtro por situação, junto da busca. Responde as perguntas que se faz de
  // manhã: o que o gerente já liberou, o que ainda está com ele, o que já virou
  // emissão, e o que tem prazo apertando.
  const temCanceladaNoMes = Object.entries(pacotesPorCondo)
    .some(([k, lista]) => k.endsWith(`_${mes}_${ano}`)
      && (lista || []).some(p => (p.status || '').toLowerCase() === 'cancelada'));

  const SITUACOES = [
    { id: 'todos',     rotulo: 'Todos' },
    { id: 'liberados', rotulo: 'Liberados' },
    { id: 'com_gerente', rotulo: 'Com o gerente' },
    { id: 'sem_emissao', rotulo: 'Sem emissão' },
    { id: 'em_emissao',  rotulo: 'Em emissão' },
    { id: 'prazo',       rotulo: 'Prazo apertando' },
    // Só quando existe alguma no mês: filtro que nunca acha nada ensina que a
    // busca não funciona.
    ...(temCanceladaNoMes ? [{ id: 'canceladas', rotulo: 'Canceladas' }] : []),
  ];

  function passaNaSituacao(condo) {
    if (situacao === 'todos') return true;
    const lista = pacotesPorCondo[`${condo.id}_${mes}_${ano}`] || [];
    const editando = gerenteEditando(condo.id);

    switch (situacao) {
      // "Liberado" = o gerente terminou a planilha do mês e passou para nós.
      // Sem registro em edicoes_mensais não conta: nunca foi aberto para ele,
      // então não houve liberação nenhuma a comemorar.
      case 'liberados':
        return edicoesMap[`${condo.id}_${mes}_${ano}`]?.status === 'edicao_finalizada';
      case 'com_gerente':  return editando;
      case 'sem_emissao':  return lista.length === 0;
      case 'em_emissao':   return lista.length > 0;
      case 'canceladas':   return lista.some(p => (p.status || '').toLowerCase() === 'cancelada');
      case 'prazo': {
        const dia = condo.prazo_expedicao_dia;
        if (!dia) return false;
        const hoje = new Date();
        // Só aperta no mês corrente; em mês futuro a conta não diz nada.
        if (mes !== hoje.getMonth() + 1 || ano !== hoje.getFullYear()) return true;
        return dia - hoje.getDate() <= 3;
      }
      default: return true;
    }
  }

  // Busca (ignora acentos/caixa): casa por nome/código do condomínio OU nome do gerente
  const carteirasFiltradas = useMemo(() => {
    const q = (buscaCarteira || '').trim();
    const out = {};
    Object.entries(carteiras).forEach(([gerente, condos]) => {
      const porSituacao = condos.filter(passaNaSituacao);
      if (!porSituacao.length) return;
      if (!q) { out[gerente] = porSituacao; return; }
      if (combina(q, gerente)) { out[gerente] = porSituacao; return; }   // achou o gerente: leva a carteira toda
      const m = porSituacao.filter(c => combina(q, c.name));
      if (m.length) out[gerente] = m;
    });
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [carteiras, buscaCarteira, situacao, pacotesPorCondo, edicoesMap, mes, ano]);
  const totalEncontrados = useMemo(
    () => Object.values(carteirasFiltradas).reduce((s, arr) => s + arr.length, 0),
    [carteirasFiltradas]
  );

  // Mapa de pacotes por condomínio (mês/ano atual)
  // LISTA por condomínio+mês, não um só. Antes era `map[key] = p`: com duas
  // emissões no mesmo mês (0086) a segunda sobrescrevia a primeira e sumia da
  // tela — o emissor nunca veria que faltava montar a do outro vencimento.

  const toggleCarteira = (name) => {
    setExpandedCarteiras(prev => ({ ...prev, [name]: !prev[name] }));
  };

  if (loading) return <div className="flex justify-center p-12"><Loader2 className="animate-spin w-8 h-8 text-violet-500"/></div>;

  // --- RENDER ---
  return (
    <div className="space-y-8">
      
      {/* ═══ PAINEL DO PACOTE ATIVO ═══ */}
      {activePacote ? (
        <div className={`tem-marca-dagua relative overflow-hidden rounded-2xl md:rounded-3xl p-4 md:p-6 shadow-2xl animate-fade-in ${
          (activePacote.status || '').toLowerCase() === 'cancelada'
            ? 'border border-rose-500/40 bg-rose-500/5'
            : 'border border-violet-500/30 bg-violet-500/5'}`}>
          {/* Painel aberto de uma cancelada: a marca d'água atravessa tudo.
              Aqui é onde se anexa arquivo, e anexar na emissão descartada é o
              erro que o selo sozinho não impede. */}
          {(activePacote.status || '').toLowerCase() === 'cancelada' && <MarcaDaguaCancelada />}
          <div className="relative flex items-center justify-between gap-2 mb-6">
            <div className="flex items-center gap-3 md:gap-4 min-w-0">
              <div className="w-11 h-11 md:w-12 md:h-12 bg-violet-500/20 rounded-xl md:rounded-2xl flex items-center justify-center border border-violet-500/30 shrink-0">
                <Package className="w-5 h-5 md:w-6 md:h-6 text-violet-400" />
              </div>
              <div className="min-w-0">
                <h3 className="text-base md:text-lg font-black text-slate-900 uppercase tracking-tight break-words">
                  {condominios.find(c => c.id === activePacote.condominio_id)?.name || 'Condomínio'}
                </h3>
                <p className="text-xs font-bold text-violet-400 uppercase tracking-widest flex items-center flex-wrap gap-x-3 gap-y-1">
                  Emissão {String(activePacote.mes_referencia).padStart(2,'0')}/{activePacote.ano_referencia} • <StatusBadge status={activePacote.status} />
                  
                  {/* Botão de Registro Rápido no Painel Ativo */}
                  {(activePacote.status || '').toLowerCase() === 'aprovado' && (
                    <button 
                      onClick={() => handleRegistrar(activePacote)} 
                      className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-emerald-600 text-white transition-all shadow-lg shadow-emerald-500/20 font-black text-[9px] uppercase tracking-widest border border-slate-200"
                    >
                      <FileCheck className="w-3.5 h-3.5" />
                      <span>Registrar Agora</span>
                    </button>
                  )}
                </p>
              </div>
            </div>
            {/* Aqui existia um "Ver planilha" que abria outra aba. Saiu: a
                planilha do mês já está NESTE painel, em "Referência do gerente",
                logo abaixo. O botão abria uma segunda aba do sistema inteiro —
                com as suas assinaturas de tempo real e o seu consumo de memória —
                para mostrar o que já estava na tela. */}
            <button
              onClick={() => { setActivePacote(null); setPacoteArquivos([]); }}
              className="p-2 bg-slate-50 hover:bg-slate-100 rounded-xl text-slate-500 hover:text-slate-900 transition-all"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Conferência de pendências — o que antes era a "etapa de preparação" */}
          {(() => {
            const chave = `${activePacote.condominio_id}_${activePacote.mes_referencia}_${activePacote.ano_referencia}`;
            const prep = preparacaoMap[chave];
            const hoje = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
            const itens = [
              { campo: 'data_fatura',    rotulo: 'Fatura recebida',    data: prep?.data_fatura },
              { campo: 'data_relatorio', rotulo: 'Relatório recebido', data: prep?.data_relatorio },
            ];
            const faltam = itens.filter(i => !i.data).length;
            return (
              <div className={`mb-6 rounded-2xl border overflow-hidden ${faltam ? 'border-amber-300 bg-amber-50' : 'border-emerald-200 bg-emerald-50'}`}>
                <div className="px-4 py-2.5 flex items-center gap-2 flex-wrap">
                  <ClipboardCheck className={`w-4 h-4 ${faltam ? 'text-amber-700' : 'text-emerald-700'}`} />
                  <h4 className={`text-[11px] font-black uppercase tracking-widest ${faltam ? 'text-amber-900' : 'text-emerald-900'}`}>
                    {faltam ? `Falta conferir ${faltam} item${faltam > 1 ? 's' : ''}` : 'Tudo conferido'}
                  </h4>
                  <span className="text-[11px] text-slate-600">
                    {faltam
                      ? 'Dá para montar a emissão mesmo assim — mas confira antes de mandar para aprovação.'
                      : 'Fatura e relatório recebidos.'}
                  </span>
                </div>
                <div className="px-4 pb-3 flex flex-wrap gap-2">
                  {itens.map(i => (
                    <button
                      key={i.campo}
                      type="button"
                      disabled={salvandoPrep === i.campo}
                      onClick={() => marcarPendencia(i.campo, i.data ? null : hoje)}
                      title={i.data ? 'Clique para desmarcar' : 'Marcar como recebido hoje'}
                      className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11px] font-bold transition-colors disabled:opacity-50 ${
                        i.data
                          ? 'border-emerald-300 bg-white text-emerald-800 hover:bg-emerald-100'
                          : 'border-amber-300 bg-white text-amber-800 hover:bg-amber-100'
                      }`}
                    >
                      {i.data ? <Check className="w-3.5 h-3.5" /> : <Clock className="w-3.5 h-3.5" />}
                      {i.rotulo}
                      {i.data && (
                        <span className="font-mono font-normal text-slate-500">
                          {new Date(i.data + 'T00:00:00').toLocaleDateString('pt-BR')}
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              </div>
            );
          })()}

          {/* Consumo do mês anterior, como régua para o que está sendo montado */}
          <ComparativoConsumo
            condominioId={activePacote.condominio_id}
            mes={activePacote.mes_referencia}
            ano={activePacote.ano_referencia}
            arquivosAtuais={pacoteArquivos}
          />

          {/* Referência do gerente: planilha do mês + cobranças extras a incluir */}
          <div className="mb-6 rounded-2xl border border-slate-200 bg-white overflow-hidden">
            <div className="px-4 py-2.5 bg-slate-50 border-b border-slate-200 flex items-center gap-2">
              <ClipboardCheck className="w-4 h-4 text-violet-500" />
              <h4 className="text-[11px] font-black uppercase tracking-widest text-slate-600">
                Referência do gerente · {String(activePacote.mes_referencia).padStart(2,'0')}/{activePacote.ano_referencia}
              </h4>
              {confLoading && <Loader2 className="w-3.5 h-3.5 animate-spin text-slate-400 ml-auto" />}
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-2 divide-y lg:divide-y-0 lg:divide-x divide-slate-200">
              {/* Planilha de rateios do mês */}
              <div className="p-4">
                <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2 flex items-center gap-1.5">
                  <FileText className="w-3.5 h-3.5" /> Planilha de rateios
                </p>
                {(() => {
                  const mesAtual = activePacote.mes_referencia;
                  const todosMeses = confData?.planilha?.meses || [];
                  const mesObj = todosMeses.find(m => m.mes === mesAtual);
                  const colunas = (confData?.planilha?.colunas || []).filter(c => c !== 'Condomínio');
                  const valores = mesObj?.valores || {};
                  // Mês anterior (mesmo ano) para grifar verbas que mudaram de valor
                  const mesAntObj = mesAtual > 1 ? todosMeses.find(m => m.mes === mesAtual - 1) : null;
                  const valoresAnt = mesAntObj?.valores || null;
                  const temMesAnterior = valoresAnt && Object.values(valoresAnt).some(v => Number(v) > 0);
                  const fmt = n => Number(n || 0).toLocaleString('pt-BR', {minimumFractionDigits:2, maximumFractionDigits:2});
                  const mudouCol = col => temMesAnterior && Math.abs(Number(valores[col]||0) - Number(valoresAnt[col]||0)) > 0.005;
                  const nomeMesAnt = ['','janeiro','fevereiro','março','abril','maio','junho','julho','agosto','setembro','outubro','novembro','dezembro'][mesAtual - 1] || 'mês anterior';
                  if (!colunas.length) return <p className="text-xs text-slate-400 py-2">{confLoading ? 'Carregando…' : 'Sem planilha para este mês.'}</p>;
                  const nMudou = colunas.filter(mudouCol).length;

                  // Em que parcela esta cada verba neste mes (vem do backend).
                  const parcelas = mesObj?.parcelas || {};
                  // Quando o valor foi digitado, e se foi antes de o mes abrir.
                  const revisao = mesObj?.revisao || {};

                  // Uma linha de verba. Sai igual dentro ou fora de faixa.
                  const linhaVerba = col => {
                    const atual = Number(valores[col] || 0);
                    const ant = valoresAnt ? Number(valoresAnt[col] || 0) : null;
                    const mudou = mudouCol(col);
                    const p = parcelas[col];
                    const rev = revisao[col];
                    return (
                      <div key={col} className={`flex items-center justify-between text-xs py-1 last:border-0 ${mudou ? 'bg-amber-50 -mx-1 px-1.5 py-1.5 rounded-md border border-amber-200' : 'border-b border-slate-100'}`}>
                        <span className={`truncate pr-2 ${mudou ? 'text-amber-900 font-bold' : 'text-slate-600'}`}>
                          {col}
                          {/* A verba parcelada diz em qual parcela esta. A
                              planilha da arrecadacao ja mostrava; aqui, onde a
                              emissao e montada, nao chegava — e e aqui que se
                              percebe que a proxima e a ultima. */}
                          {p?.atual && (
                            <span className="ml-1.5 inline-block align-middle rounded-full border border-violet-200 bg-violet-50 px-1.5 text-[9px] font-bold text-violet-700"
                                  title={`Parcela ${p.atual} de ${p.total}${p.atual === p.total ? ' — esta é a última' : ''}`}>
                              {String(p.atual).padStart(2, '0')}/{String(p.total).padStart(2, '0')}
                            </span>
                          )}
                          {p?.atual && p.atual === p.total && (
                            <span className="ml-1 inline-block align-middle rounded-full border border-amber-300 bg-amber-50 px-1.5 text-[9px] font-bold text-amber-800">
                              última
                            </span>
                          )}
                          {mudou && <span className="ml-1.5 text-[8px] font-black uppercase tracking-wider text-white bg-amber-500 px-1 py-0.5 rounded align-middle">alterado</span>}
                          {/* Valor digitado ANTES de o mês abrir e nunca mais
                              tocado. Sai no boleto igual a um valor conferido
                              ontem, e é justamente essa indistinção que fazia
                              preencher meses adiantado não ser seguro. */}
                          {rev?.previsao === true && (
                            <span className="ml-1.5 inline-block align-middle rounded-full border border-orange-300 bg-orange-50 px-1.5 text-[9px] font-bold text-orange-800"
                              title={rev.em
                                ? `Previsão digitada em ${new Date(rev.em).toLocaleDateString('pt-BR')}, antes de o mês abrir — ninguém revisou depois`
                                : 'Previsão: digitada antes de o mês abrir'}>
                              previsão
                            </span>
                          )}
                        </span>
                        <span className="shrink-0 text-right whitespace-nowrap">
                          {mudou && <span className="font-mono text-[10px] text-amber-400 line-through mr-1.5" title={`${nomeMesAnt}`}>{fmt(ant)}</span>}
                          <span className={`font-mono font-bold ${mudou ? 'text-amber-700' : 'text-slate-800'}`}>R$ {fmt(atual)}</span>
                        </span>
                      </div>
                    );
                  };

                  // Verba parcelada que acabou sai da planilha do mes seguinte.
                  //
                  // Ela nao e apagada: continua no cadastro, e o registro logo
                  // abaixo diz que existiu e em que parcela parou. Some da
                  // lista ativa porque uma verba que terminou nao e para ser
                  // cobrada — e ficar la, zerada, e o jeito mais facil de
                  // alguem digitar um valor nela sem querer.
                  const MESES_CURTO = ['', 'jan', 'fev', 'mar', 'abr', 'mai', 'jun',
                                       'jul', 'ago', 'set', 'out', 'nov', 'dez'];
                  const encerradas = colunas.filter(c => parcelas[c]?.encerrada);
                  const colunasAtivas = colunas.filter(c => !parcelas[c]?.encerrada);

                  // Faixas por grupo (0086). Só quando há mais de um: num condomínio
                  // de vencimento único a faixa seria ruído.
                  const grupos = confData?.planilha?.grupos || [];
                  const colGrupo = confData?.planilha?.colunas_grupo || {};
                  const porGrupo = grupos.length > 1
                    ? grupos.map(g => ({ g, cols: colunasAtivas.filter(c => colGrupo[c] === g.id) })).filter(x => x.cols.length)
                    : null;

                  return (
                    <div className="space-y-1">
                      {(() => {
                        const nPrev = colunas.filter(c => revisao[c]?.previsao === true).length;
                        if (!nPrev) return null;
                        return (
                          <p className="text-[10px] font-bold text-orange-900 bg-orange-50 border border-orange-200 rounded-lg px-2 py-1.5 mb-1.5 flex items-start gap-1.5">
                            <Clock className="w-3 h-3 shrink-0 mt-0.5" />
                            <span>
                              {nPrev} {nPrev > 1 ? 'verbas foram digitadas' : 'verba foi digitada'} antes de o mês abrir e ninguém revisou depois.
                              Confira com o gerente antes de emitir.
                            </span>
                          </p>
                        );
                      })()}
                      {nMudou > 0 && (
                        <p className="text-[10px] font-bold text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-2 py-1.5 mb-1.5 flex items-center gap-1.5">
                          <span className="text-amber-500 text-sm leading-none">⚠</span>
                          {nMudou} {nMudou > 1 ? 'verbas mudaram' : 'verba mudou'} de valor vs {nomeMesAnt} — destacadas em amarelo.
                        </p>
                      )}

                      {porGrupo ? porGrupo.map(({ g, cols }) => {
                        // O grupo DESTA emissão vem marcado: quem monta precisa saber
                        // quais verbas entram neste boleto, e quais são do outro.
                        const ehDaEmissao = activePacote.grupo_id
                          ? g.id === activePacote.grupo_id
                          : g.id === grupos[0].id;
                        const totalGrupo = cols.reduce((s, c) => s + Number(valores[c] || 0), 0);
                        return (
                          // Sem modificador de opacidade nas cores: `bg-violet-50/40`
                          // vira outra classe e escapa do override de tema escuro do
                          // globals.css, ficando um bloco claro no fundo escuro.
                          <div key={g.id} className={`rounded-lg border mb-2 ${ehDaEmissao ? 'border-violet-300 bg-violet-50' : 'border-slate-200 bg-slate-50'}`}>
                            <div className={`flex items-center justify-between gap-2 px-2 py-1.5 border-b ${ehDaEmissao ? 'border-violet-200' : 'border-slate-200'}`}>
                              <span className="flex items-center gap-1.5 min-w-0">
                                <span className={`text-[10px] font-black uppercase tracking-widest truncate ${ehDaEmissao ? 'text-violet-700' : 'text-slate-500'}`}>
                                  {g.nome}{g.due_day ? ` · vence dia ${g.due_day}` : ''}
                                </span>
                                {ehDaEmissao && (
                                  <span className="shrink-0 text-[8px] font-black uppercase tracking-wider text-white bg-violet-600 px-1.5 py-0.5 rounded">
                                    esta emissão
                                  </span>
                                )}
                              </span>
                              <span className={`font-mono text-[11px] font-bold shrink-0 ${ehDaEmissao ? 'text-violet-700' : 'text-slate-500'}`}>
                                R$ {fmt(totalGrupo)}
                              </span>
                            </div>
                            <div className="px-2 py-1">{cols.map(linhaVerba)}</div>
                          </div>
                        );
                      }) : colunasAtivas.map(linhaVerba)}

                      <div className="flex items-center justify-between text-xs pt-2 mt-1">
                        <span className="font-black uppercase tracking-widest text-[10px] text-slate-500">Total do mês{porGrupo ? ' (todos os grupos)' : ''}</span>
                        <span className="font-mono font-black text-emerald-600">R$ {fmt(mesObj?.total)}</span>
                      </div>

                      {/* O registro do que acabou.
                          Ela saiu da planilha, mas alguem vai perguntar "e o
                          fundo de obras?" — e a resposta tem de estar aqui, com
                          a parcela em que parou e o mes. Sem isto, sumir da
                          lista seria indistinguivel de ter sido apagada. */}
                      {encerradas.length > 0 && (
                        <div className="mt-2 rounded-lg border border-slate-200 bg-slate-50 px-2 py-1.5">
                          <p className="text-[9px] font-black uppercase tracking-widest text-slate-500 mb-1">
                            Parcelamento encerrado — fora desta emissão
                          </p>
                          {encerradas.map(c => {
                            const p = parcelas[c];
                            return (
                              <div key={c} className="flex items-center justify-between gap-2 text-[11px] text-slate-500">
                                <span className="truncate line-through">{c}</span>
                                <span className="shrink-0 font-mono">
                                  terminou na {String(p.ultima_parcela).padStart(2, '0')}/{String(p.total).padStart(2, '0')}
                                  {p.mes_da_ultima >= 1 && p.mes_da_ultima <= 12 ? ` · ${MESES_CURTO[p.mes_da_ultima]}` : ''}
                                </span>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })()}
              </div>
              {/* Cobranças extras do mês — selecionáveis */}
              <div className="p-4">
                <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2 flex items-center gap-1.5">
                  <Plus className="w-3.5 h-3.5" /> Cobranças extras · marque as que entram
                </p>
                {(() => {
                  const cobrancas = confData?.cobrancas_extras || [];
                  if (!cobrancas.length) return <p className="text-xs text-slate-400 py-2">{confLoading ? 'Carregando…' : 'Nenhuma cobrança extra lançada neste mês.'}</p>;
                  const sel = cobrancasSel || new Set();
                  return (
                    <div className="space-y-1.5">
                      {cobrancas.map(c => {
                        const semDoc = !(c.attachments?.length > 0);
                        const emRevisao = !!c.alteracao_proposta;
                        const travada = semDoc || emRevisao;
                        const checked = sel.has(c.id) && !travada;
                        return (
                          <label key={c.id}
                            title={semDoc ? 'Sem documento anexado — não pode entrar na emissão'
                                   : emRevisao ? 'Alteração pendente de aprovação — não entra até alguém decidir'
                                   : undefined}
                            className={`flex items-center gap-2.5 px-2.5 py-2 rounded-lg border transition-colors ${
                              semDoc ? 'bg-rose-50/60 border-rose-200 cursor-not-allowed'
                                : emRevisao ? 'bg-amber-50 border-amber-300 cursor-not-allowed'
                                : checked ? 'bg-violet-50 border-violet-200 cursor-pointer'
                                : 'bg-slate-50 border-slate-200 hover:border-slate-300 cursor-pointer'}`}>
                            <input type="checkbox" checked={checked} disabled={travada}
                              onChange={() => !travada && toggleCobranca(c.id)}
                              className="w-4 h-4 accent-violet-600 shrink-0 disabled:opacity-40" />
                            <div className="flex-1 min-w-0">
                              {/* A cobrança sem documento é a que mais precisa
                                  ser lida — é a que trava a emissão. Deixá-la
                                  no cinza mais fraco a tornava a linha menos
                                  legível da tela. */}
                              <p className={`text-xs font-bold truncate ${
                                checked ? 'text-slate-800' : semDoc ? 'text-slate-700' : 'text-slate-500'}`}>{c.descricao}</p>
                              {/* Parcelamento: a 3ª de 6 é outra coisa que uma
                                  cobrança avulsa de mesmo valor. Antes isso só
                                  existia embutido no texto da descrição. */}
                              {c.parcela_total > 1 && (
                                <p className="mt-0.5 inline-flex items-center gap-1 rounded-md border border-violet-200 bg-violet-50 px-1.5 py-0.5 text-[10px] font-medium text-violet-700"
                                   title={`Parcelamento de ${c.parcela_total} vezes. Esta é a ${c.parcela_atual}ª.`}>
                                  Parcela {c.parcela_atual}/{c.parcela_total}
                                  {c.parcela_atual === c.parcela_total && <span className="font-normal opacity-70">· última</span>}
                                </p>
                              )}
                              {c.unidades && (
                                <p className="text-[10px] text-violet-600 font-bold truncate">🏠 unid.: {c.unidades}</p>
                              )}
                              {emRevisao && (
                                <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                                  <span className="text-[10px] font-bold text-amber-700 inline-flex items-center gap-1">
                                    <Clock className="w-2.5 h-2.5" /> alteração aguardando aprovação
                                  </span>
                                  {c.alteracao_motivo && (
                                    <span className="text-[10px] text-slate-500 truncate max-w-[220px]" title={c.alteracao_motivo}>
                                      {c.alteracao_motivo}
                                    </span>
                                  )}
                                </span>
                              )}
                              {semDoc ? (
                                <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                                  <span className="text-[10px] font-bold text-rose-600 inline-flex items-center gap-1">
                                    <Ban className="w-2.5 h-2.5" /> sem documento — não entra na emissão
                                  </span>
                                  <label
                                    onClick={e => e.stopPropagation()}
                                    className="inline-flex cursor-pointer items-center gap-1 rounded-md border border-rose-400 bg-white px-1.5 py-0.5 text-[10px] font-black uppercase tracking-wider text-rose-700 hover:bg-rose-100">
                                    {anexandoDoc === c.id
                                      ? <><Loader2 className="w-2.5 h-2.5 animate-spin" /> enviando…</>
                                      : <><Paperclip className="w-2.5 h-2.5" /> anexar documento</>}
                                    <input
                                      type="file"
                                      accept="application/pdf,image/*,.doc,.docx,.xls,.xlsx"
                                      disabled={anexandoDoc === c.id}
                                      onClick={e => e.stopPropagation()}
                                      onChange={e => {
                                        const f = e.target.files?.[0] || null;
                                        e.target.value = '';
                                        anexarDocumentoCobranca(c, f);
                                      }}
                                      className="hidden" />
                                  </label>
                                </span>
                              ) : (
                                <a href={c.attachments[0]} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()}
                                  className="text-[10px] text-violet-500 hover:underline inline-flex items-center gap-1">
                                  <Paperclip className="w-2.5 h-2.5" /> anexo
                                </a>
                              )}
                            </div>
                            <span className="font-mono text-xs font-bold text-slate-700 shrink-0">R$ {Number(c.valor || 0).toLocaleString('pt-BR', {minimumFractionDigits:2, maximumFractionDigits:2})}</span>
                          </label>
                        );
                      })}
                      {cobrancas.some(c => !(c.attachments?.length > 0)) && (
                        <p className="text-[10px] text-rose-600 leading-relaxed pt-1">
                          Cobrança sem documento não entra na emissão. Se ela é legítima, anexe o
                          comprovante em Lançar Cobranças; se foi lançada por engano, cancele por lá.
                        </p>
                      )}
                      <div className="flex items-center justify-between text-xs pt-2">
                        <span className="font-black uppercase tracking-widest text-[10px] text-slate-500">
                          {sel.size} de {cobrancas.filter(c => c.attachments?.length > 0).length} selecionadas
                        </span>
                        <span className="font-mono font-black text-emerald-600">
                          R$ {cobrancas.filter(c => sel.has(c.id)).reduce((s,c)=>s+Number(c.valor||0),0).toLocaleString('pt-BR', {minimumFractionDigits:2, maximumFractionDigits:2})}
                        </span>
                      </div>
                    </div>
                  );
                })()}
              </div>
            </div>
          </div>

          {/* Seguro Proteção do condomínio (cadastro) */}
          {(() => {
            const ativoCond = condominios.find(c => c.id === activePacote.condominio_id);
            const codigo = (ativoCond?.name || '').match(/\d{1,5}/)?.[0]?.padStart(4, '0');
            const seguros = (codigo && segurosMap[codigo]) || [];
            if (!seguros.length) return null;
            return (
              <div className="mb-6 rounded-2xl border border-violet-500/25 bg-violet-500/5 p-4">
                <div className="flex items-center gap-2 mb-3">
                  <ShieldCheck className="w-4 h-4 text-violet-500" />
                  <span className="text-[10px] font-black uppercase tracking-widest text-violet-700">Seguro Proteção</span>
                  <span className="text-[10px] text-slate-400">· incluir na emissão</span>
                </div>
                <div className="flex flex-wrap gap-2">
                  {seguros.map((s, i) => (
                    <span key={i} className="inline-flex items-center gap-2 px-3 py-1.5 rounded-xl bg-white border border-slate-200 text-xs">
                      <span className="font-bold text-slate-800">{s.tipo}</span>
                      <span className="text-slate-300">·</span>
                      <span className="text-slate-500">cód <span className="font-mono font-bold text-slate-700">{s.cod}</span></span>
                      <span className="text-slate-300">·</span>
                      <span className="font-mono font-black text-emerald-600">R$ {Number(s.valor).toLocaleString('pt-BR', {minimumFractionDigits:2, maximumFractionDigits:2})}</span>
                      <span className="text-[10px] text-slate-400">/unid.</span>
                    </span>
                  ))}
                </div>
              </div>
            );
          })()}

          {/* Observações do GERENTE (da planilha dele) — destaque p/ o emissor conferir */}
          {obsGerente && (
            <div className="mb-4 rounded-2xl border-2 border-amber-400/70 bg-amber-50 p-4">
              <div className="flex items-center gap-2 mb-1.5">
                <AlertCircle className="w-4 h-4 text-amber-600" />
                <span className="text-[10px] font-black uppercase tracking-widest text-amber-700">Observações do gerente (da planilha)</span>
              </div>
              <p className="text-sm text-slate-800 whitespace-pre-wrap leading-relaxed">{obsGerente}</p>
            </div>
          )}

          {/* Características do condomínio — editável, auto-salva, sempre visível */}
          <div className="mb-6 rounded-2xl border border-slate-200 bg-white p-4">
            <div className="flex items-center gap-2 mb-2">
              <StickyNote className="w-4 h-4 text-violet-500" />
              <span className="text-[10px] font-black uppercase tracking-widest text-slate-600">Características do condomínio</span>
              <span className="text-[10px] text-slate-400">· salvas automaticamente</span>
              <span className="ml-auto text-[10px] font-bold">
                {caracSaving === 'saving' ? <span className="text-amber-500">salvando…</span>
                  : caracSaving === 'saved' ? <span className="text-emerald-600">✓ salvo</span> : null}
              </span>
            </div>
            <textarea
              value={caracteristicas}
              onChange={e => salvarCaracteristicas(e.target.value)}
              placeholder="Especificações deste condomínio: regras de rateio, salão de festas, observações de cobrança, instalações de água/energia, etc. Salva conforme você digita."
              rows={4}
              className="w-full bg-slate-50 border border-slate-200 rounded-xl p-3 text-sm text-slate-800 outline-none focus:border-violet-500 resize-y placeholder-slate-400 leading-relaxed"
            />
          </div>

          {/* Lista de Arquivos do Pacote */}
          {podeOrdenar && pacoteArquivos.length > 1 && (
            <div className="mb-2 flex items-center gap-2 text-[11px] text-slate-500">
              <GripVertical className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
              <span>
                Arraste para definir a ordem em que os arquivos entram no PDF da emissão.
              </span>
              {salvandoOrdem && <span className="text-violet-500 font-bold">salvando…</span>}
            </div>
          )}
          <div className="space-y-3 mb-6">
            {pacoteArquivos.length === 0 ? (
              <div className="text-center py-8 border border-dashed border-slate-200 rounded-2xl">
                <FileText className="w-10 h-10 text-slate-400 mx-auto mb-2" />
                <p className="text-slate-500 text-sm">Nenhum arquivo adicionado ainda.</p>
              </div>
            ) : (
              pacoteArquivos.map((arq, idx) => {
                const catColor = arq.categoria === 'concessionaria' ? 'orange'
                              : arq.categoria === 'outros'          ? 'slate'
                              : 'violet';
                const catLabel = arq.categoria === 'concessionaria' ? (arq.subtipo || 'Concessionária')
                              : arq.categoria === 'outros'          ? (arq.subtipo || 'Outros')
                              : 'Emissão';
                const arrastando = arrastandoId === arq.id;
                const eAlvo = alvoId === arq.id && !arrastando;
                return (
                <div key={arq.id}
                  draggable={podeOrdenar}
                  onDragStart={() => setArrastandoId(arq.id)}
                  onDragEnd={() => { setArrastandoId(null); setAlvoId(null); }}
                  onDragOver={(e) => { if (podeOrdenar && arrastandoId) { e.preventDefault(); setAlvoId(arq.id); } }}
                  onDragLeave={() => setAlvoId(a => (a === arq.id ? null : a))}
                  onDrop={(e) => { e.preventDefault(); soltarNaPosicao(arq.id); }}
                  className={`p-4 bg-white border rounded-2xl transition-colors group ${
                    arrastando ? 'opacity-40 border-violet-400'
                    : eAlvo ? 'border-violet-500 border-dashed bg-violet-50'
                    : 'border-slate-200 hover:bg-slate-100'
                  }`}>
                  <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    {podeOrdenar && (
                      // A alça é o único ponto arrastável visualmente anunciado.
                      // O número é a ordem em que este arquivo entra no PDF.
                      <span className="flex items-center gap-1.5 shrink-0 cursor-grab active:cursor-grabbing select-none"
                            title="Arraste para mudar a ordem do PDF">
                        <GripVertical className="w-4 h-4 text-slate-400" aria-hidden="true" />
                        <span className="w-5 text-center text-[11px] font-black text-slate-500 tabular-nums">{idx + 1}</span>
                      </span>
                    )}
                    <div className={`w-10 h-10 bg-${catColor}-500/10 rounded-xl flex items-center justify-center border border-${catColor}-500/20`}>
                      <FileText className={`w-5 h-5 text-${catColor}-400`} />
                    </div>
                    <div>
                      <div className="flex items-center gap-2 mb-0.5">
                        <span className={`text-[9px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded bg-${catColor}-500/10 text-${catColor}-300 border border-${catColor}-500/30`}>
                          {catLabel}
                        </span>
                      </div>
                      {/* O passo da auditoria no lugar do nome cru do arquivo.
                          `RelControleConsumos (80).pdf` nao diz o que aquilo e;
                          `4 · Agua — relatorio de leitura` diz, e diz tambem em
                          que ordem ele entra. O nome original fica embaixo, para
                          quem precisar casar com o arquivo que baixou. */}
                      <p className="text-sm font-bold text-slate-900 truncate max-w-[250px]" title={arq.arquivo_nome}>{nomeDocumento(arq)}</p>
                      <p className="text-[10px] text-slate-500 truncate max-w-[250px]" title={arq.arquivo_nome}>{arq.arquivo_nome}</p>
                      <p className="text-[10px] text-slate-500 uppercase tracking-widest">{arq.formato} • {new Date(arq.criado_em).toLocaleString('pt-BR')}</p>
                      {arq.categoria === 'concessionaria' && editandoFaturaId !== arq.id && (
                        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px]">
                          {arq.nome_condominio_fatura ? (
                            <span className="text-amber-300/90"><span className="text-amber-500/60">cliente:</span> {arq.nome_condominio_fatura}</span>
                          ) : null}
                          {arq.vencimento_fatura ? (
                            <span className="text-amber-300/90"><span className="text-amber-500/60">venc:</span> {new Date(arq.vencimento_fatura + 'T12:00:00').toLocaleDateString('pt-BR')}</span>
                          ) : null}
                          {arq.valor_fatura != null ? (
                            <span className="text-amber-300/90 font-bold"><span className="text-amber-500/60 font-normal">total:</span> R$ {Number(arq.valor_fatura).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                          ) : null}
                          {/* Próxima leitura: é ela que diz quando a conta do mês
                              seguinte chega. Fica em destaque porque é a data
                              pela qual se cobra o responsável — o resto da linha
                              é conferência, esta é agenda. */}
                          {arq.proxima_leitura_fatura ? (
                            <span className="inline-flex items-center gap-1 rounded-md border border-violet-300 bg-violet-50 px-1.5 py-0.5 font-semibold text-violet-700"
                                  title="Data da próxima leitura informada na fatura">
                              <CalendarClock className="w-3 h-3" aria-hidden="true" />
                              próxima leitura {new Date(arq.proxima_leitura_fatura + 'T12:00:00').toLocaleDateString('pt-BR')}
                            </span>
                          ) : null}
                          {['rascunho', 'solicitar_correcao'].includes(activePacote.status) && (
                            <button
                              onClick={() => setEditandoFaturaId(arq.id)}
                              className="text-[10px] text-amber-400/70 hover:text-amber-300 underline decoration-dotted"
                            >
                              {arq.valor_fatura != null ? 'editar dados' : '+ preencher dados'}
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button 
                      onClick={() => openFileUrl(arq)}
                      className="p-2 bg-slate-50 border border-slate-200 rounded-lg text-slate-500 hover:text-violet-400 hover:border-violet-500/30 transition-all"
                      title="Visualizar"
                    >
                      <FileText className="w-4 h-4" />
                    </button>
                    {['rascunho', 'solicitar_correcao'].includes(activePacote.status) && (
                      <button 
                        onClick={(e) => handleDeleteArquivo(e, arq.id, arq.arquivo_url, arq)}
                        className={`p-2 rounded-lg border transition-all ${
                          confirmDeleteArqId === arq.id 
                            ? 'bg-rose-500 border-rose-500 text-white animate-pulse' 
                            : 'bg-slate-50 border-slate-200 text-slate-500 hover:text-rose-400 hover:border-rose-500/30'
                        }`}
                        title={confirmDeleteArqId === arq.id ? 'Clique novamente para confirmar' : 'Remover'}
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                  </div>

                  {/* Form inline de dados manuais da fatura */}
                  {arq.categoria === 'concessionaria' && editandoFaturaId === arq.id && (
                    <FaturaInlineForm
                      arq={arq}
                      condoNome={activePacote.condominio_nome || activePacote.nome_condominio || ''}
                      maskValor={maskValor}
                      parseValor={parseValor}
                      saving={savingFaturaId === arq.id}
                      onCancel={() => setEditandoFaturaId(null)}
                      onSave={(payload) => salvarDadosFatura(arq, payload)}
                    />
                  )}
                </div>
                );
              })
            )}
          </div>

          {/* Ações do Pacote */}
          {['rascunho', 'solicitar_correcao'].includes((activePacote.status || '').toLowerCase()) && (
            <div className="space-y-3">
              {/* 4 zonas de upload por categoria */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {/* EMISSÃO (violeta) */}
                <div className="relative border-2 border-dashed border-violet-500/20 hover:border-violet-500/60 rounded-2xl p-4 text-center cursor-pointer transition-all bg-violet-500/5 group">
                  <input type="file" multiple disabled={isUploading}
                    className="absolute inset-0 opacity-0 cursor-pointer"
                    accept=".pdf,.jpg,.jpeg,.png,.xlsx,.xls"
                    onChange={async e => {
                      const files = Array.from(e.target.files || []);
                      for (const f of files) { await handleUploadArquivo(f, { categoria: 'emissao' }); }
                      e.target.value = '';
                    }}
                  />
                  <div className="flex flex-col items-center gap-1 text-violet-400 group-hover:text-violet-300">
                    <FileText className="w-5 h-5" />
                    <span className="text-[10px] font-black uppercase tracking-widest">+ Emissão</span>
                    <span className="text-[9px] text-violet-500/70">Boleto/PDF principal</span>
                  </div>
                </div>

                {/* CONCESSIONÁRIA (laranja) — extração automática do PDF */}
                <div className="relative border-2 border-dashed border-amber-500/20 hover:border-amber-500/60 rounded-2xl p-4 text-center cursor-pointer transition-all bg-amber-500/5 group">
                  <input type="file" multiple disabled={isUploading || extraindo}
                    className="absolute inset-0 opacity-0 cursor-pointer disabled:cursor-wait"
                    accept=".pdf,.jpg,.jpeg,.png"
                    onChange={e => {
                      // Array.from ANTES de limpar o value: `e.target.files` é
                      // uma FileList viva do input, e zerar o value esvazia ela.
                      // Copiando para array, os File sobrevivem à limpeza.
                      const files = Array.from(e.target.files || []);
                      e.target.value = '';
                      enfileirarExtracao(files, 'concessionaria');
                    }}
                  />
                  <div className="flex flex-col items-center gap-1 text-amber-400 group-hover:text-amber-300">
                    <Package className="w-5 h-5" />
                    <span className="text-[10px] font-black uppercase tracking-widest">+ Concessionária</span>
                    <span className="text-[9px] text-amber-500/70 flex items-center gap-1"><Sparkles className="w-2.5 h-2.5" /> SABESP / COMGAS / ENEL</span>
                  </div>
                </div>

                {/* RELATÓRIO DE LEITURA (azul) — extração automática do PDF */}
                <div className="relative border-2 border-dashed border-violet-500/20 hover:border-violet-500/60 rounded-2xl p-4 text-center cursor-pointer transition-all bg-violet-500/5 group">
                  <input type="file" multiple disabled={isUploading || extraindo}
                    className="absolute inset-0 opacity-0 cursor-pointer disabled:cursor-wait"
                    accept=".pdf"
                    onChange={e => {
                      const files = Array.from(e.target.files || []);   // ver o comentário acima
                      e.target.value = '';
                      enfileirarExtracao(files, 'relatorio_leitura');
                    }}
                  />
                  <div className="flex flex-col items-center gap-1 text-violet-400 group-hover:text-violet-300">
                    <ClipboardCheck className="w-5 h-5" />
                    <span className="text-[10px] font-black uppercase tracking-widest">+ Relatório</span>
                    <span className="text-[9px] text-violet-500/70 flex items-center gap-1"><Sparkles className="w-2.5 h-2.5" /> Leitura individualizada</span>
                  </div>
                </div>

                {/* OUTROS (cinza) */}
                <div className="relative border-2 border-dashed border-slate-500/20 hover:border-slate-400/60 rounded-2xl p-4 text-center cursor-pointer transition-all bg-slate-500/5 group">
                  <input type="file" multiple disabled={isUploading}
                    className="absolute inset-0 opacity-0 cursor-pointer"
                    accept=".pdf,.jpg,.jpeg,.png,.xlsx,.xls,.doc,.docx"
                    onChange={async e => {
                      const files = Array.from(e.target.files || []);
                      const subtipo = window.prompt('Descreva este anexo (ex: Ata da reunião):', '');
                      for (const f of files) { await handleUploadArquivo(f, { categoria: 'outros', subtipo: subtipo || null }); }
                      e.target.value = '';
                    }}
                  />
                  <div className="flex flex-col items-center gap-1 text-slate-400 group-hover:text-slate-700">
                    <FolderOpen className="w-5 h-5" />
                    <span className="text-[10px] font-black uppercase tracking-widest">+ Outros</span>
                    <span className="text-[9px] text-slate-500/70">Atas e outros docs</span>
                  </div>
                </div>
              </div>

              {/* Vagas fixas por tipo — categoria 'outros' + subtipo FIXO (a extração usa isso pra achar cada item na ordem certa) */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                {[
                  { label: 'Correios', sub: 'Correios' },
                  { label: 'Seguro', sub: 'Seguro' },
                  { label: 'Salão de festas', sub: 'Salão de festas' },
                  { label: 'Relatório de Rateio', sub: 'Relatório de Rateio' },
                ].map(({ label, sub }) => (
                  <div key={sub} className="relative border border-dashed border-slate-300 hover:border-violet-400 rounded-xl p-2.5 text-center cursor-pointer transition-all bg-white group">
                    <input type="file" multiple disabled={isUploading}
                      className="absolute inset-0 opacity-0 cursor-pointer"
                      accept=".pdf,.jpg,.jpeg,.png"
                      onChange={async e => {
                        const files = Array.from(e.target.files || []);
                        for (const f of files) { await handleUploadArquivo(f, { categoria: 'outros', subtipo: sub }); }
                        e.target.value = '';
                      }}
                    />
                    <span className="text-[10px] font-black uppercase tracking-widest text-slate-500 group-hover:text-violet-500">+ {label}</span>
                  </div>
                ))}
              </div>

              {/* Botões de ação do rascunho */}
              <div className="flex flex-col sm:flex-row gap-3 justify-end">
                <button
                  onClick={handleCancelarRascunho}
                  className="px-6 py-3 bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/30 text-rose-400 hover:text-rose-300 rounded-2xl font-black uppercase tracking-widest text-xs transition-all active:scale-95 flex items-center justify-center gap-2"
                  title="Apaga o rascunho e todos os arquivos enviados"
                >
                  <Trash2 className="w-4 h-4" />
                  Cancelar Rascunho
                </button>
                <button
                  onClick={handleConcluirPacote}
                  className="px-8 py-3 bg-emerald-600 hover:bg-emerald-500 text-white rounded-2xl font-black uppercase tracking-widest text-xs transition-all shadow-xl shadow-emerald-600/20 active:scale-95 flex items-center justify-center gap-2"
                >
                  <Send className="w-4 h-4" />
                  {activePacote.status === 'solicitar_correcao' ? 'Reenviar Correção' : 'Concluir e Enviar'}
                </button>
              </div>
            </div>
          )}

          {activePacote.status === 'solicitar_correcao' && activePacote.comentario_correcao && (
            <div className="p-4 bg-rose-500/10 border border-rose-500/20 rounded-2xl text-sm text-rose-300 mt-4 space-y-2">
              <div>
                <span className="font-black text-rose-400 text-xs uppercase tracking-widest block mb-1">Correção Solicitada:</span>
                {activePacote.comentario_correcao}
              </div>
              {activePacote.correcao_arquivo_url && (
                <button
                  onClick={async () => {
                    const ok = await abrirArquivoSeguro(activePacote.correcao_arquivo_url);
                    if (!ok) addToast('Erro ao abrir anexo', 'error');
                  }}
                  className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-rose-500/20 hover:bg-rose-500/30 border border-rose-500/40 text-rose-200 text-[11px] font-bold">
                  📎 {activePacote.correcao_arquivo_nome || 'Ver anexo da correção'}
                </button>
              )}
            </div>
          )}
        </div>
      ) : (
        /* ═══ FORMULÁRIO CRIAR/ABRIR PACOTE ═══ */
        <div className="border border-slate-200 rounded-2xl md:rounded-3xl bg-slate-50 p-4 md:p-6 shadow-xl">
          <h3 className="font-black text-slate-900 text-base md:text-lg mb-6 flex items-center gap-2">
            <UploadCloud className="text-violet-400 w-5 h-5"/>
            Nova Emissão / Abrir Existente
          </h3>
          <form onSubmit={handleCriarOuAbrirPacote} className="grid grid-cols-1 md:grid-cols-4 gap-4 items-end">
            <div className="md:col-span-2">
              <label className="block text-xs font-bold text-slate-500 uppercase tracking-widest mb-1.5">Condomínio</label>
              <select
                value={condoId} onChange={e => setCondoId(e.target.value)}
                className="w-full bg-white border border-slate-200 rounded-xl px-4 py-3 text-sm text-slate-900 outline-none focus:border-violet-500" required
              >
                <option value="">Selecione...</option>
                {condominios.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-500 uppercase tracking-widest mb-1.5">Mês / Ano</label>
              <div className="flex gap-2">
                <input type="number" min="1" max="12" value={mes} onChange={e => setMes(parseInt(e.target.value))}
                  className="w-1/2 bg-white border border-slate-200 rounded-xl px-3 py-3 text-sm text-slate-900" />
                <input type="number" value={ano} onChange={e => setAno(parseInt(e.target.value))}
                  className="w-1/2 bg-white border border-slate-200 rounded-xl px-3 py-3 text-sm text-slate-900" />
              </div>
            </div>
            <div>
              <button type="submit"
                title={periodoPassado ? 'Mês encerrado — só permite abrir pacote já existente' : 'Criar ou abrir pacote'}
                className={`w-full py-3 rounded-xl font-black uppercase tracking-widest text-xs shadow-lg transition-all flex items-center justify-center gap-2 ${
                  periodoPassado
                    ? 'bg-slate-50 border border-slate-200 text-slate-500'
                    : 'bg-violet-600 hover:bg-violet-500 text-white'
                }`}>
                <FolderOpen className="w-4 h-4" />
                {periodoPassado ? 'Apenas Abrir' : 'Abrir Pacote'}
              </button>
            </div>

            {/* Só aparece em condomínio com mais de um vencimento (26 de 303). Nos
                demais o grupo é único e escolher não faz sentido. */}
            {gruposCondo.length > 1 && (
              <div className="md:col-span-4">
                <label htmlFor="emissao-grupo" className="block text-xs font-bold text-slate-500 uppercase tracking-widest mb-1.5">
                  Grupo de emissão
                </label>
                <select
                  id="emissao-grupo"
                  value={grupoId}
                  onChange={e => setGrupoId(e.target.value)}
                  className="w-full bg-white border border-slate-200 rounded-xl px-4 py-3 text-sm text-slate-900 outline-none focus:border-violet-500"
                >
                  {gruposCondo.map(g => (
                    <option key={g.id} value={g.id}>
                      {g.nome}{g.due_day ? ` — vence dia ${g.due_day}` : ''}
                    </option>
                  ))}
                </select>
                <p className="mt-1.5 text-[11px] text-slate-500">
                  Este condomínio tem {gruposCondo.length} vencimentos. Cada grupo gera a sua emissão —
                  e nenhuma é registrada enquanto todas do mês não estiverem aprovadas.
                </p>
              </div>
            )}
          </form>
          {periodoPassado && (
            <div className="mt-4 flex items-center gap-2 px-4 py-2.5 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-300 text-[11px]">
              <Lock className="w-3.5 h-3.5 shrink-0" />
              <span><strong>{String(mes).padStart(2,'0')}/{ano}</strong> já passou — só é possível abrir pacotes existentes. Novas emissões só podem ser criadas para o mês atual ou meses futuros.</span>
            </div>
          )}
        </div>
      )}

      {/* ═══ VISÃO POR CARTEIRA ═══ */}
      <div className="space-y-4">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <h3 className="font-black text-slate-900 text-lg flex items-center gap-2">
            <Clock className="text-violet-400 w-5 h-5"/>
            Emissões por Carteira — {String(mes).padStart(2,'0')}/{ano}
          </h3>
          {periodoPassado && (
            <span className="px-3 py-1.5 rounded-lg bg-rose-500/10 border border-rose-500/30 text-rose-300 text-[10px] font-black uppercase tracking-widest flex items-center gap-1.5">
              <Lock className="w-3 h-3" /> Período encerrado · só leitura
            </span>
          )}
        </div>

        {/* Busca por condomínio (nome/código) ou carteira/gerente */}
        <div className="relative">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            value={buscaCarteira}
            onChange={e => setBuscaCarteira(e.target.value)}
            placeholder="Buscar condomínio (nome ou código) ou gerente…"
            className="w-full bg-white border border-slate-200 rounded-xl pl-11 pr-10 py-3 text-sm text-slate-800 outline-none focus:border-violet-500 placeholder-slate-400 shadow-sm"
          />
          <div className="flex flex-wrap gap-1.5 mb-3">
          {SITUACOES.map(f => (
            <button key={f.id} type="button" onClick={() => setSituacao(f.id)} aria-pressed={situacao === f.id}
              className={`rounded-lg border px-2.5 py-1 text-[11px] font-medium transition-colors ${
                situacao === f.id
                  ? 'border-violet-600 bg-violet-600 text-white'
                  : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-100'}`}>
              {f.rotulo}
            </button>
          ))}
          {/* Marcar prioridade sem sair de Fazer Emissões — é aqui que se
              descobre que um condomínio tem prazo, montando a emissão dele. */}
          <button type="button" onClick={() => abrirPrioridadeDe(null)}
            className="ml-auto rounded-lg border border-rose-300 bg-rose-50 px-2.5 py-1 text-[11px] font-medium text-rose-700 hover:bg-rose-100 transition-colors">
            <AlertTriangle className="w-3 h-3 inline -mt-0.5 mr-1" />Prioridade
          </button>
        </div>

        {buscaCarteira && (
            <button type="button" onClick={() => setBuscaCarteira('')} title="Limpar busca"
              className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700">
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
        {buscaCarteira && (
          <p className="text-[11px] text-slate-500 -mt-2 px-1">
            {totalEncontrados} {totalEncontrados === 1 ? 'condomínio encontrado' : 'condomínios encontrados'} em {Object.keys(carteirasFiltradas).length} {Object.keys(carteirasFiltradas).length === 1 ? 'carteira' : 'carteiras'}
          </p>
        )}

        {Object.keys(carteirasFiltradas).length === 0 && (
          <div className="text-center py-10 text-slate-500 text-sm border border-dashed border-slate-200 rounded-2xl">
            Nenhum condomínio ou carteira encontrado para “{buscaCarteira}”.
          </div>
        )}

        {Object.entries(carteirasFiltradas).map(([gerente, condos]) => {
          const isExpanded = buscaCarteira ? true : (expandedCarteiras[gerente] !== false); // busca força expandir
          return (
            <div key={gerente} className="border border-slate-200 rounded-2xl bg-white overflow-hidden">
              <button
                onClick={() => toggleCarteira(gerente)}
                className="w-full flex items-center justify-between p-4 hover:bg-slate-100 transition-colors"
              >
                <div className="flex items-center gap-3">
                  {isExpanded ? <ChevronDown className="w-4 h-4 text-violet-400" /> : <ChevronRight className="w-4 h-4 text-slate-500" />}
                  <span className="text-sm font-black text-slate-900 uppercase tracking-widest">{gerente}</span>
                  <span className="text-[10px] font-bold text-slate-500 bg-slate-50 px-2 py-0.5 rounded-full">{condos.length} condos</span>
                </div>
              </button>

              {isExpanded && (
                <div className="border-t border-slate-200">
                  {condos.map(condo => {
                    const key = `${condo.id}_${mes}_${ano}`;
                    const listaPacotes = pacotesPorCondo[key] || [];
                    const pacote = listaPacotes[0];   // existe? (o resto vem da lista)
                    const prep = preparacaoMap[`${condo.id}_${mes}_${ano}`];
                    // Alterações previstas (AGO/AGE/Reunião) BLOQUEIAM criação do pacote
                    const altsPrevistas = alteracoesPrevMap[`${condo.id}_${mes}_${ano}`] || [];
                    const temAltPrevista = altsPrevistas.length > 0;
                    // Gate: a planilha estar na mão do gerente. A etapa de preparação
                    // deixou de travar — virou registro do que falta, conferido dentro
                    // da emissão. Abrir cedo não faz mal: o que impede de MANDAR para
                    // aprovação é a conferência lá dentro, não a porta de entrada.
                    const editandoAgora = gerenteEditando(condo.id);
                    const canCreate = !temAltPrevista && (!editandoAgora || !!pacote);

                    // A cancelada é uma linha entre outras 55. Quem abre o mês
                    // para anexar precisa saber ANTES de agir que aquele
                    // condomínio já teve uma emissão descartada — o motivo dela
                    // costuma ser exatamente o que se vai repetir sem querer.
                    const canceladasDoCondo = listaPacotes.filter(
                      p => (p.status || '').toLowerCase() === 'cancelada'
                    );

                    return (
                      <div key={condo.id} className="border-b border-slate-200 last:border-b-0">
                      {canceladasDoCondo.length > 0 && (
                        <div className="px-4 pt-2.5 sm:px-6">
                          <AvisoCanceladas canceladas={canceladasDoCondo} onVer={abrirPacote} />
                        </div>
                      )}
                      <div className={`flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 px-4 sm:px-6 py-3 transition-colors ${
                        temAltPrevista ? 'bg-amber-500/[0.05] hover:bg-amber-500/[0.08]'
                          : !pacote && !editandoAgora ? 'bg-emerald-500/[0.04] hover:bg-emerald-500/[0.07]'
                          : 'hover:bg-slate-100'
                      }`}>
                        <div className="flex items-center gap-3 flex-wrap">
                          <span className="text-sm font-bold text-slate-700 truncate max-w-[75vw] sm:max-w-[280px]">{condo.name}</span>
                          <TagPrioritario condo={condo} mes={mes} ano={ano} onEditar={abrirPrioridadeDe} />
                          {condo.due_day && <span className="text-[10px] text-slate-400 font-medium">venc. dia {condo.due_day}{condo.due_day_2 ? ` e ${condo.due_day_2}` : ''}</span>}
                          {temAltPrevista && (
                            <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-amber-500/20 border border-amber-500/40 text-amber-300 text-[9px] font-black uppercase tracking-widest animate-pulse"
                                  title={altsPrevistas.map(a => `${a.tipo} em ${new Date(a.data_evento + 'T00:00:00').toLocaleDateString('pt-BR')}${a.descricao ? ' — ' + a.descricao : ''}`).join('\n')}>
                              <FileWarning className="w-3 h-3" />
                              {altsPrevistas.length === 1
                                ? `${altsPrevistas[0].tipo} em ${new Date(altsPrevistas[0].data_evento + 'T00:00:00').toLocaleDateString('pt-BR')}`
                                : `${altsPrevistas.length} alterações previstas`}
                            </span>
                          )}
                        </div>
                        <div className={`flex flex-wrap gap-2 sm:justify-end ${listaPacotes.length > 1 ? 'flex-col items-stretch sm:items-end' : 'items-center'}`}>
                          {pacote ? (
                            // Uma faixa de ações por emissão. Com um vencimento só
                            // (a maioria) é exatamente a linha de antes.
                            listaPacotes.map(p => (
                              <div key={p.id} className="flex items-center gap-2 flex-wrap sm:justify-end">
                                <SeloGrupo pacote={p} />
                                <span className="text-[10px] font-bold text-slate-500">{p.numArquivos || 0} arquivo{(p.numArquivos || 0) !== 1 ? 's' : ''}</span>
                                <StatusBadge status={p.status} />
                                {/* Motivo curto na linha; o texto inteiro no title.
                                    Quem vai anexar precisa saber que aquela
                                    emissão foi descartada ANTES de subir arquivo
                                    nela. */}
                                <SeloCancelada pacote={p} mostrarMotivo={false} />
                                {((p.status || '').toLowerCase() === 'rascunho' || (p.status || '').toLowerCase() === 'solicitar_correcao') && (
                                  <button
                                    onClick={() => handleConcluirRapido(p)}
                                    className="p-1.5 bg-emerald-600/20 hover:bg-emerald-600/40 border border-emerald-500/30 rounded-lg text-emerald-400 transition-all"
                                    title="Enviar para Aprovação"
                                  >
                                    <Send className="w-3 h-3" />
                                  </button>
                                )}
                                {(() => {
                                  const statusLower = (p.status || '').toLowerCase();
                                  const estaAprovado = statusLower === 'aprovado';
                                  const roleAutorizado = profile?.role === 'master' || profile?.role === 'departamento';
                                  if (!estaAprovado || !roleAutorizado) return null;

                                  // O conjunto sai junto: com uma irmã ainda em fluxo o
                                  // botão fica desligado, em vez de o clique ser recusado.
                                  const faltam = listaPacotes.filter(
                                    o => o.id !== p.id && !['aprovado', 'registrado', 'expedida'].includes((o.status || '').toLowerCase())
                                  ).length;

                                  return (
                                    <button
                                      onClick={() => handleRegistrar(p)}
                                      disabled={faltam > 0}
                                      title={faltam > 0
                                        ? `Aguardando ${faltam} emissão(ões) deste mês — os boletos saem juntos`
                                        : 'Registrar emissão'}
                                      className={`flex items-center gap-2 px-3 py-1.5 rounded-xl transition-all font-black text-[9px] uppercase tracking-widest border ${
                                        faltam > 0
                                          ? 'bg-slate-100 text-slate-400 border-slate-200 cursor-not-allowed'
                                          : 'bg-emerald-600 text-white shadow-lg shadow-emerald-500/20 border-slate-200'
                                      }`}
                                    >
                                      <FileCheck className="w-3.5 h-3.5" />
                                      <span>{faltam > 0 ? 'Aguardando conjunto' : 'Registrar'}</span>
                                    </button>
                                  );
                                })()}
                                <button
                                  onClick={() => abrirPacote(p)}
                                  className="px-3 py-1.5 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-lg text-[10px] font-black text-violet-400 uppercase tracking-widest transition-all"
                                >
                                  Abrir
                                </button>
                              </div>
                            ))
                          ) : null}

                          {/* Condomínio de dois vencimentos com uma emissão só: sem
                              este aviso, a do segundo grupo simplesmente é esquecida —
                              não há nada na lista que a cobre. */}
                          {pacote && condo.due_day_2 && listaPacotes.length < 2 && !periodoPassado && (
                            <button
                              type="button"
                              onClick={() => { setCondoId(condo.id); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
                              title={`Este condomínio também vence dia ${condo.due_day_2}. Abrir o formulário para criar a emissão desse grupo.`}
                              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-amber-50 border border-amber-300 text-amber-800 text-[10px] font-bold hover:bg-amber-100 transition-all"
                            >
                              <Plus className="w-3 h-3" />
                              Falta a emissão do dia {condo.due_day_2}
                            </button>
                          )}

                          {!pacote && (periodoPassado ? (
                            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest italic">— sem pacote —</span>
                          ) : (
                            <>
                              {/* Etapa de preparação pré-emissão */}
                              {(() => {
                                const prep = preparacaoMap[`${condo.id}_${mes}_${ano}`];
                                const etapa = prep?.etapa;
                                const dataStr = etapa === 'aguardando_fatura' && prep?.data_fatura
                                  ? new Date(prep.data_fatura + 'T00:00:00').toLocaleDateString('pt-BR')
                                  : etapa === 'aguardando_relatorio' && prep?.data_relatorio
                                    ? new Date(prep.data_relatorio + 'T00:00:00').toLocaleDateString('pt-BR')
                                    : null;
                                return (
                                  <>
                                    {etapa && (
                                      <span className="hidden md:inline-flex items-center gap-1.5">
                                        <StatusBadge status={etapa} />
                                        {/* Há quanto tempo espera e quantas vezes foi cobrado:
                                            visível na lista, sem precisar abrir nada. */}
                                        {(() => {
                                          const dias = diasDeEspera(prep?.aguardando_desde);
                                          const n = (prep?.cobrancas || []).length;
                                          if (dias === null && !n) return null;
                                          const tenso = dias !== null && dias >= 5;
                                          return (
                                            <span className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-bold ${
                                              tenso ? 'border-amber-300 bg-amber-50 text-amber-800' : 'border-slate-200 bg-slate-50 text-slate-600'}`}
                                              title={`Aguardando há ${dias ?? '?'} dia(s)${n ? ` · cobrado ${n}×` : ' · nunca cobrado'}`}>
                                              <Clock className="w-3 h-3" />
                                              {dias === 0 ? 'hoje' : `${dias}d`}
                                              {n > 0 && <span className="opacity-70">· {n}×</span>}
                                            </span>
                                          );
                                        })()}
                                        {dataStr && <span className="text-[10px] font-bold text-slate-500">{dataStr}</span>}
                                        {prep?.notas && (
                                          <span className="relative group/notas">
                                            <button
                                              type="button"
                                              className="w-5 h-5 flex items-center justify-center rounded bg-violet-500/10 border border-violet-500/20 text-violet-400 hover:bg-violet-500/20 transition-all"
                                              aria-label="Ver observações"
                                            >
                                              <StickyNote className="w-3 h-3" />
                                            </button>
                                            <span className="absolute right-0 top-full mt-1 z-50 hidden group-hover/notas:block w-64 p-3 bg-white border border-violet-500/30 rounded-xl shadow-2xl shadow-violet-500/10 pointer-events-none">
                                              <span className="block text-[9px] font-black text-violet-400 uppercase tracking-widest mb-1">Observações</span>
                                              <span className="block text-xs text-slate-800 whitespace-pre-wrap leading-relaxed">{prep.notas}</span>
                                            </span>
                                          </span>
                                        )}
                                      </span>
                                    )}
                                    {/* Quem manda agora é a liberação do gerente. */}
                                    {editandoAgora && (
                                      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-amber-50 border border-amber-300 text-amber-800 text-[10px] font-bold"
                                            title="A emissão abre assim que o gerente liberar o mês">
                                        <Lock className="w-3 h-3" />
                                        Gerente ainda editando
                                      </span>
                                    )}
                                    <button
                                      onClick={() => setModalPrepCondo(condo)}
                                      title="Anotar o que falta (fatura, relatório) e abrir/reabrir o mês para o gerente"
                                      className="flex items-center gap-1.5 px-2.5 py-1.5 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-lg text-[10px] font-black text-slate-600 uppercase tracking-widest transition-all"
                                    >
                                      <ClipboardCheck className="w-3 h-3" />
                                      {etapa ? 'Pendências' : 'Anotar'}
                                    </button>
                                  </>
                                );
                              })()}
                              <button
                                onClick={() => {
                                  if (temAltPrevista) {
                                    addToast(
                                      `Alteração prevista (${altsPrevistas[0].tipo}). Confirme com o gerente se já ocorreu antes de emitir.`,
                                      'warning'
                                    );
                                    return;
                                  }
                                  if (!canCreate) {
                                    addToast('O gerente ainda está com a planilha deste mês. A emissão abre quando ele liberar.', 'warning');
                                    setModalPrepCondo(condo);
                                    return;
                                  }
                                  setCondoId(condo.id);
                                  handleCriarOuAbrirPacote();
                                }}
                                title={
                                  temAltPrevista
                                    ? `BLOQUEADO: alteração prevista (${altsPrevistas[0].tipo}). Gerente precisa marcar como realizada/cancelada.`
                                    : !canCreate ? 'O gerente ainda está editando a planilha deste mês' : 'Criar pacote de emissão'
                                }
                                className={`px-3 py-1.5 border rounded-lg text-[10px] font-black uppercase tracking-widest transition-all ${
                                  canCreate
                                    ? 'bg-emerald-500/10 hover:bg-emerald-500/20 border-emerald-500/30 text-emerald-400'
                                    : 'bg-slate-50 border-slate-200 text-slate-400 cursor-not-allowed opacity-60'
                                }`}
                              >
                                + Criar
                              </button>
                            </>
                          ))}
                        </div>
                      </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* ═══ MODAL DE CONCLUSÃO ═══ */}
      {showConcluirModal && (() => {
        const ehRespostaCorrecao = (activePacote?.status || '').toLowerCase() === 'solicitar_correcao';
        return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/40 backdrop-blur-sm p-4 animate-fade-in">
          <div className="bg-white border border-slate-200 rounded-3xl w-full max-w-lg p-8 shadow-2xl max-h-[92vh] overflow-y-auto">
            <div className={`w-16 h-16 ${ehRespostaCorrecao ? 'bg-amber-500/10 border-amber-500/20' : 'bg-emerald-500/10 border-emerald-500/20'} border rounded-full flex items-center justify-center mx-auto mb-6`}>
              {ehRespostaCorrecao ? <Send className="w-8 h-8 text-amber-400" /> : <CheckCircle className="w-8 h-8 text-emerald-400" />}
            </div>
            <h3 className="text-xl font-black text-slate-900 text-center mb-2">
              {ehRespostaCorrecao ? 'Reenviar com correção' : 'Concluir Emissão'}
            </h3>
            <p className="text-sm text-slate-500 text-center mb-6">
              {pacoteArquivos.length} arquivo{pacoteArquivos.length !== 1 ? 's' : ''} neste pacote.
            </p>

            {/* Bloco de resposta de correcao */}
            {ehRespostaCorrecao && (
              <div className="mb-6 p-4 rounded-2xl bg-amber-500/5 border border-amber-500/30 space-y-3">
                {/* Lembrete do que foi pedido */}
                {activePacote?.comentario_correcao && (
                  <div className="text-[11px] text-amber-300/80 italic border-l-2 border-amber-500/40 pl-3">
                    <span className="font-black text-amber-400 uppercase tracking-widest block mb-0.5 not-italic">Foi pedido:</span>
                    {activePacote.comentario_correcao}
                  </div>
                )}

                <div>
                  <label className="text-[10px] font-black uppercase tracking-widest text-amber-400 block mb-1.5">Arquivo da correção <span className="text-rose-400">*</span></label>
                  {respostaCorrecaoFile ? (
                    <div className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg bg-amber-500/10 border border-amber-500/30">
                      <span className="text-xs text-amber-200 truncate flex items-center gap-2">
                        <FileText className="w-4 h-4 shrink-0" />
                        {respostaCorrecaoFile.name}
                        <span className="text-[10px] text-amber-400/60">({(respostaCorrecaoFile.size/1024).toFixed(0)} KB)</span>
                      </span>
                      <button onClick={() => setRespostaCorrecaoFile(null)} className="text-amber-300 hover:text-slate-900 text-xs font-bold">Remover</button>
                    </div>
                  ) : (
                    <input type="file" accept="application/pdf,image/*,.doc,.docx,.xls,.xlsx"
                      onChange={(e) => setRespostaCorrecaoFile(e.target.files?.[0] || null)}
                      className="block w-full text-xs text-amber-200 file:mr-2 file:py-1.5 file:px-3 file:rounded-md file:border-0 file:text-xs file:font-bold file:bg-amber-500/15 file:text-amber-300 hover:file:bg-amber-500/25" />
                  )}
                </div>

                <div>
                  <label className="text-[10px] font-black uppercase tracking-widest text-amber-400 block mb-1.5">O que foi corrigido <span className="text-rose-400">*</span></label>
                  <textarea
                    value={respostaCorrecaoComentario}
                    onChange={(e) => setRespostaCorrecaoComentario(e.target.value)}
                    rows={3}
                    placeholder="Ex: Corrigi o valor do fundo de obras conforme solicitado e ajustei o rateio do mês de junho."
                    className="w-full bg-slate-100 border border-amber-500/30 rounded-lg px-3 py-2 text-sm text-amber-100 placeholder-amber-500/40 outline-none focus:border-amber-500/60 resize-y" />
                </div>
              </div>
            )}

            {!ehRespostaCorrecao && (
            <p className="text-[10px] font-black uppercase tracking-widest text-slate-500 mb-3">Escolha o nível de aprovação</p>
            )}

            {!ehRespostaCorrecao && (
            <div className="space-y-3 mb-8">
              <button
                onClick={() => setNivelAprovacao(1)}
                className={`w-full p-4 rounded-2xl border-2 text-left transition-all ${
                  nivelAprovacao === 1
                    ? 'border-violet-600 bg-violet-600/10 '
                    : 'border-slate-200 bg-slate-50 hover:border-slate-200'
                }`}
              >
                <div className="flex items-center gap-3">
                  <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${nivelAprovacao === 1 ? 'border-violet-500' : 'border-gray-600'}`}>
                    {nivelAprovacao === 1 && <div className="w-2.5 h-2.5 rounded-full bg-violet-500" />}
                  </div>
                  <div>
                    <p className="font-bold text-slate-900">Nível 1 - Sem consumos</p>
                    <p className="text-xs text-slate-500">Passa direto para a Supervisora</p>
                  </div>
                </div>
              </button>

              <button
                onClick={() => setNivelAprovacao(2)}
                className={`w-full p-4 rounded-2xl border-2 text-left transition-all ${
                  nivelAprovacao === 2
                    ? 'border-violet-600 bg-violet-600/10 '
                    : 'border-slate-200 bg-slate-50 hover:border-slate-200'
                }`}
              >
                <div className="flex items-center gap-3">
                  <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${nivelAprovacao === 2 ? 'border-violet-500' : 'border-gray-600'}`}>
                    {nivelAprovacao === 2 && <div className="w-2.5 h-2.5 rounded-full bg-violet-500" />}
                  </div>
                  <div>
                    <p className="font-bold text-slate-900">Nível 2 - Alteração sem consumo</p>
                    <p className="text-xs text-slate-500">Passa por Gerente ➔ Supervisora da Contabilidade</p>
                  </div>
                </div>
              </button>

              <button
                onClick={() => setNivelAprovacao(3)}
                className={`w-full p-4 rounded-2xl border-2 text-left transition-all ${
                  nivelAprovacao === 3
                    ? 'border-violet-600 bg-violet-600/10 '
                    : 'border-slate-200 bg-slate-50 hover:border-slate-200'
                }`}
              >
                <div className="flex items-center gap-3">
                  <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${nivelAprovacao === 3 ? 'border-violet-500' : 'border-gray-600'}`}>
                    {nivelAprovacao === 3 && <div className="w-2.5 h-2.5 rounded-full bg-violet-500" />}
                  </div>
                  <div>
                    <p className="font-bold text-slate-900">Nível 3 - Fração</p>
                    <p className="text-xs text-slate-500">Passa por Gerente ➔ Supervisora da Contabilidade</p>
                  </div>
                </div>
              </button>

              <button
                onClick={() => setNivelAprovacao(4)}
                className={`w-full p-4 rounded-2xl border-2 text-left transition-all ${
                  nivelAprovacao === 4
                    ? 'border-violet-600 bg-violet-600/10 '
                    : 'border-slate-200 bg-slate-50 hover:border-slate-200'
                }`}
              >
                <div className="flex items-center gap-3">
                  <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${nivelAprovacao === 4 ? 'border-violet-500' : 'border-gray-600'}`}>
                    {nivelAprovacao === 4 && <div className="w-2.5 h-2.5 rounded-full bg-violet-500" />}
                  </div>
                  <div>
                    <p className="font-bold text-slate-900">Nível 4 - Com empresas terceirizadas</p>
                    <p className="text-xs text-slate-500">Passa por Gerente ➔ Supervisor dos Gerentes ➔ Supervisora</p>
                  </div>
                </div>
              </button>
            </div>
            )}

            <div className="flex gap-3">
              <button
                onClick={() => { setShowConcluirModal(false); setRespostaCorrecaoFile(null); setRespostaCorrecaoComentario(''); }}
                disabled={enviandoResposta}
                className="flex-1 py-3 rounded-xl text-xs font-bold uppercase tracking-widest text-slate-500 hover:text-slate-900 hover:bg-slate-100 transition-colors disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                onClick={confirmarConclusao}
                disabled={enviandoResposta}
                className={`flex-[2] py-3 rounded-xl text-slate-900 font-black uppercase tracking-widest text-xs shadow-lg transition-all disabled:opacity-50 flex items-center justify-center gap-2 ${
                  ehRespostaCorrecao ? 'bg-amber-600 hover:bg-amber-500' : 'bg-emerald-600 hover:bg-emerald-500'
                }`}
              >
                {enviandoResposta ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                {ehRespostaCorrecao ? 'Reenviar para aprovação' : 'Confirmar e Enviar'}
              </button>
            </div>
          </div>
        </div>
        );
      })()}

      <FilePreviewDrawer 
        isOpen={isDrawerOpen} 
        onClose={() => setIsDrawerOpen(false)} 
        file={selectedFile} 
      />

      {arquivoAberto && (
        <VisualizadorConferencia
          arquivo={arquivoAberto}
          arquivos={arquivoAberto.arquivos}
          currentUser={user}
          onClose={() => setArquivoAberto(null)}
          onAction={() => { setArquivoAberto(null); fetchPacotes(); }}
        />
      )}

      <PainelPrioridades
        open={prioridadesOpen}
        onClose={() => { setPrioridadesOpen(false); setFocoPrioridade(null); }}
        condominios={condominios}
        foco={focoPrioridade}
        onSalvo={() => fetchDados()}
      />

      {modalPrepCondo && (
        <ModalPreparacao
          condo={modalPrepCondo}
          mes={mes}
          ano={ano}
          onClose={() => setModalPrepCondo(null)}
          onSaved={() => { fetchPreparacao(); fetchProcessos(); }}
        />
      )}

      {/* ═══ OVERLAY: LENDO PDF ═══ */}
      {extraindo && (
        <div className="fixed inset-0 z-[210] flex items-center justify-center bg-slate-900/40 backdrop-blur-sm">
          <div className="bg-white border border-violet-500/30 rounded-2xl px-8 py-6 shadow-2xl flex flex-col items-center gap-3">
            <Sparkles className="w-8 h-8 text-violet-400 animate-pulse" />
            <p className="text-sm font-black text-slate-900 uppercase tracking-widest">{ocrProg ? 'Decifrando a imagem (OCR)…' : 'Lendo PDF…'}</p>
            {fila.total > 1 && (
              <p className="text-[11px] font-bold text-violet-600">conta {Math.min(fila.feitos + 1, fila.total)} de {fila.total}</p>
            )}
            <p className="text-[11px] text-slate-500">{ocrProg ? `Página ${ocrProg.p} de ${ocrProg.n} · no seu navegador, sem créditos` : 'Extraindo dados automaticamente'}</p>
          </div>
        </div>
      )}

      {/* ═══ MODAL DE REVISÃO DE EXTRAÇÃO ═══ */}
      {revisaoInfo && (
        <RevisaoExtracaoModal
          info={revisaoInfo}
          onCancel={() => { setRevisaoInfo(null); proximoDaFila(); }}
          onConfirm={confirmarRevisao}
        />
      )}

      {/* ═══ MODAL DE DUPLICATA / SANCIONAMENTO ═══ */}
      {duplicataInfo && (() => {
        // Nenhum alerta de bloqueio = é só "existe outra conta do mesmo serviço".
        // Nesse caso não faz sentido pedir motivo nem comprovante: basta confirmar.
        const soAviso = (duplicataInfo.alertas || []).length > 0
          && (duplicataInfo.alertas || []).every(a => a.nivel !== 'bloqueio');
        return (
        <div className="fixed inset-0 z-[110] flex items-center justify-center bg-slate-900/40 backdrop-blur-sm p-4 animate-fade-in">
          <div className={`bg-white border rounded-3xl w-full max-w-2xl p-6 shadow-2xl max-h-[92vh] overflow-y-auto ${soAviso ? "border-amber-400/40" : "border-rose-500/30"}`}>
            <div className="flex items-center gap-3 mb-4">
              <div className={`w-12 h-12 rounded-xl border flex items-center justify-center shrink-0 ${soAviso ? 'bg-amber-500/10 border-amber-500/30' : 'bg-rose-500/10 border-rose-500/30'}`}>
                <AlertCircle className={`w-6 h-6 ${soAviso ? 'text-amber-500' : 'text-rose-400'}`} />
              </div>
              <div>
                <h3 className="text-lg font-black text-slate-900">
                  {soAviso ? 'Já existe conta deste serviço' : 'Possível duplicata detectada'}
                </h3>
                <p className="text-[11px] text-slate-500">
                  {soAviso
                    ? 'Se for de outra instalação ou medidor, pode anexar — os valores somam.'
                    : 'Esta emissão não pode prosseguir sem confirmação.'}
                </p>
              </div>
            </div>

            {/* Lista de alertas */}
            <div className="space-y-2 mb-4">
              {(duplicataInfo.alertas || []).map((a, i) => (
                <div key={i} className={`px-3 py-2 rounded-lg border ${a.nivel === 'bloqueio' ? 'bg-rose-500/5 border-rose-500/30' : 'bg-amber-500/5 border-amber-500/30'}`}>
                  <p className={`text-[10px] font-black uppercase tracking-widest mb-1 ${a.nivel === 'bloqueio' ? 'text-rose-400' : 'text-amber-400'}`}>{a.nivel === 'bloqueio' ? '🚫 Bloqueio' : '⚠ Aviso'} · {a.tipo.replace(/_/g, ' ')}</p>
                  <p className="text-xs text-slate-800">{a.mensagem}</p>
                  {a.detalhes && (
                    <p className="text-[10px] text-slate-500 mt-1 font-mono">
                      {a.detalhes.condominios?.name && `${a.detalhes.condominios.name} · `}
                      {a.detalhes.mes_referencia && `${String(a.detalhes.mes_referencia).padStart(2, '0')}/${a.detalhes.ano_referencia}`}
                      {a.detalhes.concessionaria && ` · ${a.detalhes.concessionaria}`}
                      {a.detalhes.empresa_leitura && ` · ${a.detalhes.empresa_leitura} (${a.detalhes.tipo_servico})`}
                    </p>
                  )}
                </div>
              ))}
            </div>

            {/* Side-by-side se houver mes anterior */}
            {duplicataInfo.anomalia?.previous && (
              <div className="bg-white border border-slate-700 rounded-xl p-3 mb-4">
                <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2">Comparação com mês anterior</p>
                <div className="grid grid-cols-2 gap-3 text-xs">
                  <div>
                    <p className="text-slate-500">Mês anterior:</p>
                    <pre className="text-slate-700 font-mono text-[10px] whitespace-pre-wrap mt-1">{JSON.stringify(duplicataInfo.anomalia.previous, null, 2)}</pre>
                  </div>
                  <div>
                    <p className="text-slate-500">Campos iguais: <span className="text-rose-300 font-bold">{(duplicataInfo.anomalia.campos_iguais || []).join(', ') || '—'}</span></p>
                    {duplicataInfo.anomalia.variacao_pct !== null && duplicataInfo.anomalia.variacao_pct !== undefined && (
                      <p className="text-slate-500 mt-1">Variação valor: <span className={`font-bold ${Math.abs(duplicataInfo.anomalia.variacao_pct) < 5 ? 'text-rose-300' : 'text-emerald-300'}`}>{duplicataInfo.anomalia.variacao_pct.toFixed(1)}%</span></p>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* Sancionamento — exige MOTIVO + ANEXO de aprovação da repetição.
                Só para duplicata DE VERDADE (mesmo PDF). Segunda conta do mesmo
                serviço é rotina e passa com um clique. */}
            {!soAviso && (
            <>
            <div className="mb-4">
              <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 block mb-1.5">
                Motivo da repetição <span className="text-rose-400">*</span>
              </label>
              <textarea value={sancionandoMotivo} onChange={e => setSancionandoMotivo(e.target.value)} rows={3}
                placeholder="Ex: A concessionária reemitiu a mesma fatura por erro deles. Confirmei por telefone."
                className="w-full bg-slate-100 border border-slate-300 rounded-lg p-3 text-sm text-slate-800 outline-none focus:border-rose-500/60 placeholder-slate-400 resize-y" />
            </div>
            <div className="mb-4">
              <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 block mb-1.5">
                Anexo da aprovação da repetição <span className="text-rose-400">*</span>
              </label>
              <label className="flex items-center gap-3 px-3 py-2.5 rounded-lg border border-dashed border-slate-300 bg-slate-50 cursor-pointer hover:border-rose-400 transition-colors">
                <Paperclip className="w-4 h-4 text-slate-400 shrink-0" />
                <span className="text-xs text-slate-600 truncate flex-1">
                  {sancionandoAnexo ? sancionandoAnexo.name : 'Selecionar documento que comprova a aprovação…'}
                </span>
                {sancionandoAnexo && <Check className="w-4 h-4 text-emerald-500 shrink-0" />}
                <input type="file" className="hidden" accept=".pdf,.png,.jpg,.jpeg,.doc,.docx"
                  onChange={e => setSancionandoAnexo(e.target.files?.[0] || null)} />
              </label>
            </div>
            </>
            )}
            <div className="flex justify-end gap-2">
              <button onClick={() => { setDuplicataInfo(null); setSancionandoMotivo(''); setSancionandoAnexo(null); proximoDaFila(); }} disabled={sancionando}
                className="px-4 py-2 rounded-lg text-xs font-bold bg-slate-100 text-slate-700 hover:bg-slate-200 disabled:opacity-50">
                Cancelar upload
              </button>
              <button disabled={sancionando || (!soAviso && (!sancionandoMotivo.trim() || !sancionandoAnexo))}
                onClick={async () => {
                  if (!soAviso && (!sancionandoMotivo.trim() || !sancionandoAnexo)) return;
                  setSancionando(true);
                  try {
                    const meta = duplicataInfo.pendingMeta;

                    // Aviso simples (outra instalação do mesmo serviço): anexa e
                    // pronto. Não há repetição a sancionar — são duas contas
                    // legítimas, e o backend soma as duas.
                    if (soAviso) {
                      await handleUploadArquivo(duplicataInfo.pendingFile, { ...meta, skipDuplicataCheck: true });
                      setDuplicataInfo(null);
                      addToast('Conta anexada. Os valores das duas somam na planilha.', 'success');
                      proximoDaFila();
                      return;
                    }

                    // 1) Sobe o documento que comprova a aprovação da repetição
                    const anexo = await uploadAnexoAprovacao(sancionandoAnexo);
                    // 2) Sobe a fatura/relatório repetido
                    await handleUploadArquivo(duplicataInfo.pendingFile, { ...meta, skipDuplicataCheck: true });
                    // 3) Sanciona o registro em consumos (motivo + anexo)
                    const ehRelatorio = meta.categoria === 'relatorio_leitura';
                    await apiPost('/api/consumos/sancionar-repeticao', {
                      tipo: ehRelatorio ? 'relatorio' : 'fatura',
                      condominio_id: activePacote.condominio_id,
                      mes_referencia: mes,
                      ano_referencia: ano,
                      concessionaria: !ehRelatorio ? (meta.subtipo || '').toUpperCase() : null,
                      empresa: ehRelatorio ? (meta.subtipo || '').toUpperCase() : null,
                      tipo_servico: ehRelatorio ? (meta.extras?.relatorio_tipo_servico || 'agua') : null,
                      motivo: sancionandoMotivo.trim(),
                      anexo_url: anexo.url,
                      anexo_nome: anexo.nome,
                    });
                    addToast('Repetição sancionada com anexo de aprovação.', 'success');
                    setDuplicataInfo(null); setSancionandoMotivo(''); setSancionandoAnexo(null);
                    proximoDaFila();
                  } catch (e) {
                    addToast('Erro: ' + e.message, 'error');
                  } finally {
                    setSancionando(false);
                  }
                }}
                className={`px-5 py-2 rounded-lg text-xs font-bold text-white disabled:opacity-50 flex items-center gap-2 ${soAviso ? 'bg-violet-600 hover:bg-violet-700' : 'bg-rose-600 hover:bg-rose-500'}`}>
                {sancionando ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle className="w-4 h-4" />}
                {soAviso ? 'É outra conta — anexar' : 'Confirmar repetição e prosseguir'}
              </button>
            </div>
          </div>
        </div>
        );
      })()}

      {/* ═══ MODAL DE PERTENCIMENTO — BLOQUEIO DURO (conta de outro condomínio) ═══ */}
      {pertencimentoInfo && (
        <div className="fixed inset-0 z-[120] flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4 animate-fade-in">
          <div className="bg-white border border-rose-500/40 rounded-3xl w-full max-w-lg p-6 shadow-2xl">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-12 h-12 rounded-xl bg-rose-500/10 border border-rose-500/30 flex items-center justify-center shrink-0">
                <Ban className="w-6 h-6 text-rose-500" />
              </div>
              <div>
                <h3 className="text-lg font-black text-slate-900">Conta de outro condomínio</h3>
                <p className="text-[11px] text-rose-500/90 font-bold">Não é permitido anexar — retire esta conta.</p>
              </div>
            </div>

            <div className="bg-rose-500/5 border border-rose-500/30 rounded-xl px-4 py-3 mb-4">
              <p className="text-sm text-slate-800">{pertencimentoInfo.alerta?.mensagem}</p>
              {pertencimentoInfo.alerta?.detalhes && (
                <div className="mt-2 flex flex-col gap-0.5 text-[11px] text-slate-500">
                  {pertencimentoInfo.alerta.detalhes.cliente && (
                    <span><span className="text-slate-400">cliente na conta:</span> <strong className="text-slate-700">{pertencimentoInfo.alerta.detalhes.cliente}</strong></span>
                  )}
                  {pertencimentoInfo.alerta.detalhes.condominio_correto && (
                    <span><span className="text-slate-400">pertence a:</span> <strong className="text-rose-600">{pertencimentoInfo.alerta.detalhes.condominio_correto}</strong></span>
                  )}
                </div>
              )}
            </div>

            <p className="text-[11px] text-slate-500 mb-4">
              A emissão <strong>não pode prosseguir</strong> com uma fatura de outro condomínio.
              Selecione o arquivo correto deste condomínio e tente novamente.
            </p>

            <div className="flex justify-end">
              <button onClick={() => { setPertencimentoInfo(null); proximoDaFila(); }}
                className="px-5 py-2 rounded-lg text-xs font-bold bg-rose-600 text-white hover:bg-rose-500 flex items-center gap-2">
                <X className="w-4 h-4" /> Entendi, vou retirar a conta
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ═══ MODAL DE REGISTRO ═══ */}
      {showRegistroModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/40 backdrop-blur-sm p-4">
          <div className="bg-white border border-slate-200 rounded-3xl w-full max-w-md p-8 shadow-2xl">
            <div className="w-16 h-16 bg-violet-500/10 border border-violet-500/20 rounded-full flex items-center justify-center mx-auto mb-6">
              <FileCheck className="w-8 h-8 text-violet-400" />
            </div>
            <h3 className="text-xl font-black text-slate-900 text-center mb-2">Registrar Emissão</h3>
            <p className="text-sm text-slate-500 text-center mb-8">
              Confirme a data e hora oficial do registro.
            </p>

            <div className="mb-8">
              <label className="block text-xs font-bold text-slate-500 uppercase tracking-widest mb-2">Data e Hora do Registro</label>
              <input
                type="datetime-local"
                value={dataRegistro}
                onChange={(e) => setDataRegistro(e.target.value)}
                min={new Date(new Date().getTime() - (new Date().getTimezoneOffset() * 60000)).toISOString().slice(0, 16)}
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-slate-900 outline-none focus:border-violet-500 transition-all"
              />
            </div>

            <div className="flex gap-3">
              <button 
                onClick={() => { setShowRegistroModal(false); setActivePacote(null); }}
                className="flex-1 py-3 rounded-xl text-xs font-bold uppercase tracking-widest text-slate-500 hover:text-slate-900 hover:bg-slate-100 transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={confirmarRegistro}
                className="flex-[2] py-3 rounded-xl bg-violet-600 hover:bg-violet-500 text-white font-black uppercase tracking-widest text-xs shadow-lg transition-all"
              >
                Confirmar Registro
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Prévia: preencher consumos na planilha a partir dos anexos ── */}
      {consumoPreview && (
        <div className="fixed inset-0 z-[230] flex items-center justify-center bg-slate-900/50 backdrop-blur-md p-4" onClick={() => setConsumoPreview(null)}>
          <div className="bg-white border border-slate-200 rounded-2xl shadow-2xl w-full max-w-lg" onClick={e => e.stopPropagation()}>
            <div className="px-5 py-4 border-b border-slate-200 flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-violet-500/10 border border-violet-500/30 flex items-center justify-center"><Droplet className="w-4 h-4 text-violet-500" /></div>
              <div>
                <h3 className="text-base font-bold text-slate-900">Preencher consumos na planilha</h3>
                <p className="text-[10px] text-slate-500 uppercase tracking-widest">{String(consumoPreview.mes).padStart(2,'0')}/{consumoPreview.ano} · valores dos relatórios/contas anexados</p>
              </div>
            </div>
            <div className="p-4 space-y-2 max-h-[55vh] overflow-y-auto">
              {/* Contas sem verba definida: o condomínio tem duas verbas para o
                  mesmo serviço (gás do prédio e da piscina, por exemplo) e o
                  sistema não tem como adivinhar de qual é cada fatura. Perguntar
                  uma vez é melhor do que somar as duas e errar todo mês. */}
              {(consumoPreview.semVerba || []).length > 0 && (
                <div className="rounded-xl border border-amber-300 bg-amber-50 p-3 space-y-2">
                  <p className="text-[11px] font-bold text-amber-900">
                    De qual verba é cada conta?
                  </p>
                  {consumoPreview.semVerba.map((c) => (
                    <div key={c.arquivo_id} className="flex items-center gap-2 flex-wrap">
                      <span className="text-[11px] text-slate-700 truncate max-w-[240px]" title={c.nome}>
                        {c.nome}
                      </span>
                      {c.instalacao && (
                        <span className="text-[10px] text-slate-500 font-mono">inst. {c.instalacao}</span>
                      )}
                      <span className="font-mono text-[11px] font-bold text-slate-700">
                        R$ {Number(c.valor).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2})}
                      </span>
                      <select
                        value={consumoPreview.atribuicoes?.[c.arquivo_id] || ''}
                        onChange={e => atribuirConta(c.arquivo_id, e.target.value)}
                        className="ml-auto bg-white border border-amber-300 rounded-lg px-2 py-1 text-[11px] text-slate-800 outline-none focus:border-violet-500">
                        <option value="">Escolha a verba…</option>
                        {(consumoPreview.verbas || [])
                          .filter(v => v.servico === c.servico)
                          .map(v => <option key={v.rateio_id} value={v.rateio_id}>{v.nome}</option>)}
                      </select>
                    </div>
                  ))}
                  <p className="text-[10px] text-amber-800">
                    A escolha fica guardada: no mês que vem, a fatura desta mesma instalação já vem certa.
                  </p>
                </div>
              )}

              {consumoPreview.linhas.map((l, i) => (
                <div key={l.rateio_id} className={`px-3 py-2.5 rounded-xl border transition-colors ${l.aplicar ? 'border-violet-300 bg-violet-50' : 'border-slate-200'}`}>
                  <div className="flex items-center gap-3">
                    <input type="checkbox" checked={l.aplicar}
                      onChange={e => setConsumoPreview(p => ({ ...p, linhas: p.linhas.map((x, j) => j === i ? { ...x, aplicar: e.target.checked } : x) }))}
                      className="w-4 h-4 accent-violet-600 shrink-0" />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-bold text-slate-800 truncate">{l.nome}</p>
                      <p className="text-[11px] text-slate-500">
                        atual <span className="font-mono">R$ {Number(l.atual||0).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2})}</span>
                        <span className="mx-1 text-slate-400">→</span>
                      </p>
                    </div>
                    {/* Valor editável: a fatura pode vir errada, pode ter crédito,
                        pode haver acerto combinado com o síndico. Quem monta a
                        emissão precisa poder corrigir sem ir na planilha. */}
                    <div className="shrink-0 flex items-center gap-1">
                      <span className="text-[11px] text-slate-500">R$</span>
                      <input
                        value={l.novoMask ?? Number(l.novo).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2})}
                        onChange={e => {
                          const mask = maskValor(e.target.value);
                          setConsumoPreview(p => ({ ...p, linhas: p.linhas.map((x, j) =>
                            j === i ? { ...x, novoMask: mask, novo: parseValor(mask) ?? 0, editado: true, aplicar: true } : x) }));
                        }}
                        inputMode="numeric"
                        className={`w-28 text-right font-mono text-sm rounded-lg border px-2 py-1 outline-none focus:border-violet-500 ${
                          l.editado ? 'border-amber-400 bg-amber-50 text-amber-900' : 'border-slate-200 bg-white text-emerald-700'}`} />
                    </div>
                  </div>

                  {(l.contas || []).length > 0 && (
                    <ul className="mt-1.5 pl-7 space-y-0.5">
                      {l.contas.map((c, k) => (
                        <li key={k} className="text-[10px] text-slate-500 flex items-center gap-1.5">
                          <span className="text-slate-400">{l.contas.length > 1 ? '+' : '·'}</span>
                          <span className="truncate max-w-[240px]" title={c.nome}>{c.nome}</span>
                          {c.instalacao && <span className="font-mono text-slate-400">inst. {c.instalacao}</span>}
                          <span className="font-mono text-slate-600">
                            R$ {Number(c.valor).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2})}
                          </span>
                          {c.herdado && (
                            <span className="text-[9px] text-violet-600" title="Verba herdada da fatura do mês passado, na mesma instalação">
                              herdado
                            </span>
                          )}
                          <button type="button" onClick={() => tirarConta(c.arquivo_id)}
                            title="Tirar esta conta desta verba"
                            className="text-slate-300 hover:text-rose-500 transition-colors">
                            <X className="w-3 h-3" />
                          </button>
                        </li>
                      ))}
                      {l.editado && (
                        <li className="text-[10px] text-amber-700 italic">
                          valor alterado à mão — as contas acima somam R$ {(l.contas.reduce((s2,c)=>s2+Number(c.valor||0),0)).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2})}
                        </li>
                      )}
                    </ul>
                  )}
                </div>
              ))}
            </div>
            <div className="px-5 py-3 border-t border-slate-200 flex items-center justify-end gap-2">
              <button onClick={() => setConsumoPreview(null)} className="px-4 py-2 rounded-xl text-xs font-bold text-slate-600 hover:bg-slate-100">Agora não</button>
              <button onClick={aplicarConsumos} disabled={aplicandoConsumo || !consumoPreview.linhas.some(l => l.aplicar)}
                className="px-4 py-2 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-xs font-black uppercase tracking-widest disabled:opacity-60 flex items-center gap-2">
                {aplicandoConsumo && <Loader2 className="w-3.5 h-3.5 animate-spin" />} Aplicar selecionados
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
