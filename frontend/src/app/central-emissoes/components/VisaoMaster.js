'use client';
import { useState, useEffect, useMemo } from 'react';
import { createClient } from '@/utils/supabase/client';
import {
  CheckCircle, FileText, ExternalLink, Activity, Loader2, Trash2, Package, XCircle,
  User, ShieldCheck, Send, X, FileCheck, Building, Edit, ChevronLeft, ChevronRight,
  Lock, Send as SendIcon, Rocket, Upload, AlertTriangle,
} from 'lucide-react';
import StatusBadge from './StatusBadge';
import { useToast } from '@/components/Toast';
import FilePreviewDrawer from '@/components/FilePreviewDrawer';
import VisualizadorConferencia from '@/components/VisualizadorConferencia';
import { useAuth } from '@/lib/auth';

const MESES = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];

export default function VisaoMaster() {
  const supabase = createClient();
  const { addToast } = useToast();
  const { profile, user } = useAuth();
  const [arquivoAberto, setArquivoAberto] = useState(null);

  const [pacotes, setPacotes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedFile, setSelectedFile] = useState(null);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);
  const [orphans, setOrphans] = useState([]);
  const [confirmDeleteOrphanId, setConfirmDeleteOrphanId] = useState(null);
  const [showConcluirModal, setShowConcluirModal] = useState(false);
  const [activePacote, setActivePacote] = useState(null);
  const [nivelAprovacao, setNivelAprovacao] = useState(1);
  const [showRegistroModal, setShowRegistroModal] = useState(false);
  const [dataRegistro, setDataRegistro] = useState('');
  const [filtroAtivo, setFiltroAtivo] = useState(null);

  // ── Mês ativo ─────────────────────────────────────────────────────────────
  const hoje = new Date();
  const [mesAtivo, setMesAtivo] = useState(hoje.getMonth() + 1);
  const [anoAtivo, setAnoAtivo]  = useState(hoje.getFullYear());

  function navMes(dir) {
    let m = mesAtivo + dir, a = anoAtivo;
    if (m > 12) { m = 1;  a++; }
    if (m < 1)  { m = 12; a--; }
    setMesAtivo(m);
    setAnoAtivo(a);
    setFiltroAtivo(null);
  }

  // ── Fechar / Expedir Mês ──────────────────────────────────────────────────
  const [showFecharMesModal, setShowFecharMesModal] = useState(false);
  const [dataFechamento, setDataFechamento]         = useState('');
  const [fechandoMes, setFechandoMes]               = useState(false);

  // ── Expedir individual (modal com upload) ─────────────────────────────────
  const [showExpedirModal, setShowExpedirModal]     = useState(false);
  const [pacoteExpedir, setPacoteExpedir]           = useState(null);
  const [dataExpedicao, setDataExpedicao]           = useState('');
  const [arquivosExpedir, setArquivosExpedir]       = useState([]);   // File[]
  const [statusUpload, setStatusUpload]             = useState({});   // {name: 'pending'|'uploading'|'done'|'error'}
  const [expedindo, setExpedindo]                   = useState(false);
  const [dragOver, setDragOver]                     = useState(false);

  // ── Derivados ─────────────────────────────────────────────────────────────
  const pacotesDoMes = useMemo(
    () => pacotes.filter(p => p.mes_referencia === mesAtivo && p.ano_referencia === anoAtivo),
    [pacotes, mesAtivo, anoAtivo],
  );

  // Pacotes ativos no painel = tudo do mês exceto as já expedidas (estado final)
  const pacotesAtivos = useMemo(
    () => pacotesDoMes.filter(p => (p.status || '').toLowerCase() !== 'expedida'),
    [pacotesDoMes],
  );

  // Prontos para registrar = aprovados
  const prontosParaRegistro = useMemo(
    () => pacotesAtivos.filter(p => (p.status || '').toLowerCase() === 'aprovado'),
    [pacotesAtivos],
  );

  // Prontos para expedir = registrados (visíveis no painel, aguardando expedição)
  const prontosParaExpedir = useMemo(
    () => pacotesAtivos.filter(p => (p.status || '').toLowerCase() === 'registrado'),
    [pacotesAtivos],
  );

  const stats = useMemo(() => ({
    total:            pacotesAtivos.length,
    rascunho:         pacotesAtivos.filter(p => (p.status||'').toLowerCase() === 'rascunho').length,
    aprovado:         pacotesAtivos.filter(p => (p.status||'').toLowerCase() === 'aprovado').length,
    registrado:       pacotesAtivos.filter(p => (p.status||'').toLowerCase() === 'registrado').length,
    gerente:          pacotesAtivos.filter(p => { const s=(p.status||'').toLowerCase(); return s.includes('gerente')||s==='pendente'; }).length,
    supGerente:       pacotesAtivos.filter(p => { const s=(p.status||'').toLowerCase(); return s.includes('chefe')||s.includes('sup. gerentes'); }).length,
    supContabilidade: pacotesAtivos.filter(p => (p.status||'').toLowerCase().includes('supervisor')).length,
  }), [pacotesAtivos]);

  const pacotesFiltrados = useMemo(() => {
    if (!filtroAtivo) return pacotesAtivos;
    return pacotesAtivos.filter(p => {
      const s = (p.status || '').toLowerCase();
      if (filtroAtivo === 'pendente_gerente')           return s.includes('gerente') || s === 'pendente';
      if (filtroAtivo === 'pendente_sup_gerentes')      return s.includes('chefe') || s.includes('sup. gerentes');
      if (filtroAtivo === 'pendente_sup_contabilidade') return s.includes('supervisor');
      return s === filtroAtivo;
    });
  }, [pacotesAtivos, filtroAtivo]);

  // ── Fetch ─────────────────────────────────────────────────────────────────
  useEffect(() => {
    fetchPacotes();
    const channel = supabase.channel('master_pacotes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'emissoes_pacotes' }, fetchPacotes)
      .subscribe();
    return () => supabase.removeChannel(channel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function fetchPacotes() {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('emissoes_pacotes')
        .select('*, condominios(name)')
        .order('criado_em', { ascending: false });

      if (error) { addToast('Erro ao carregar pacotes: ' + error.message, 'error'); return; }

      if (data) {
        const { data: arquivos } = await supabase
          .from('emissoes_arquivos')
          .select('id, pacote_id, arquivo_nome, arquivo_url, formato')
          .not('pacote_id', 'is', null);

        const arqMap = {};
        (arquivos || []).forEach(a => {
          if (!arqMap[a.pacote_id]) arqMap[a.pacote_id] = [];
          arqMap[a.pacote_id].push(a);
        });

        setPacotes(data.map(p => ({ ...p, arquivos: arqMap[p.id] || [] })));

        const { data: orphanData } = await supabase
          .from('emissoes_arquivos')
          .select('*, condominios(name)')
          .is('pacote_id', null);
        setOrphans(orphanData || []);
      }
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }

  // ── Helper: snapshot da planilha ──────────────────────────────────────────
  async function fetchSnapshot(pacote, token) {
    if (!token || !pacote.condominio_id) return null;
    try {
      const resp = await fetch(
        `/api/condominio/${pacote.condominio_id}/conferencia?mes=${pacote.mes_referencia}&ano=${pacote.ano_referencia}&retificacao=false`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      if (!resp.ok) return null;
      const conf = await resp.json();
      if (!conf.planilha) return null;
      return {
        ...conf.planilha,
        meses: (conf.planilha.meses || []).filter(m => m.mes === pacote.mes_referencia),
      };
    } catch { return null; }
  }

  // ── Ações ─────────────────────────────────────────────────────────────────
  async function handleAprovar(pacote) {
    const fluxos = {
      1: { default: 'aprovado' },
      2: { 'Aguardando Gerente': 'Aguardando Supervisor', 'Aguardando Supervisor': 'aprovado' },
      3: { 'Aguardando Gerente': 'Aguardando Supervisor', 'Aguardando Supervisor': 'aprovado' },
      4: { 'Aguardando Gerente': 'Aguardando Chefe', 'Aguardando Chefe': 'Aguardando Supervisor', 'Aguardando Supervisor': 'aprovado' },
    };
    const fluxoId = Number(pacote.nivel_aprovacao) || 1;
    const nextStatus = fluxos[fluxoId]?.[pacote.status] ?? fluxos[fluxoId]?.default ?? 'aprovado';

    const { error } = await supabase.from('emissoes_pacotes')
      .update({ status: nextStatus, atualizado_em: new Date().toISOString() })
      .eq('id', pacote.id);

    if (error) addToast('Erro ao processar aprovação', 'error');
    else { addToast(nextStatus === 'aprovado' ? 'Pacote aprovado!' : `Enviado para: ${nextStatus}`, 'success'); fetchPacotes(); }
  }

  async function handleConcluirRapido(pacote) { setActivePacote(pacote); setShowConcluirModal(true); }

  async function confirmarConclusao() {
    const initialStatus = nivelAprovacao === 1 ? 'Aguardando Supervisor' : 'Aguardando Gerente';
    const { error } = await supabase.from('emissoes_pacotes')
      .update({ status: initialStatus, nivel_aprovacao: String(nivelAprovacao), atualizado_em: new Date().toISOString() })
      .eq('id', activePacote.id);
    if (error) addToast('Erro ao enviar', 'error');
    else { addToast('Emissão enviada para aprovação!', 'success'); setShowConcluirModal(false); setActivePacote(null); fetchPacotes(); }
  }

  // Registrar: captura snapshot e marca como "registrado" (fica no painel)
  async function handleRegistrar(pacote) {
    setActivePacote(pacote);
    const now = new Date();
    setDataRegistro(new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 16));
    setShowRegistroModal(true);
  }

  async function confirmarRegistro() {
    if (!dataRegistro) return addToast('Informe a data e hora', 'error');
    const selectedDate = new Date(dataRegistro);
    if (selectedDate < new Date(Date.now() - 60000)) return addToast('Não é permitido registrar no passado', 'error');

    const { data: { session } } = await supabase.auth.getSession();
    const planilha_snapshot = await fetchSnapshot(activePacote, session?.access_token);

    const semestre = activePacote.mes_referencia <= 6 ? 1 : 2;
    const { data: processo } = await supabase.from('processos').select('id')
      .eq('condominio_id', activePacote.condominio_id)
      .eq('year', activePacote.ano_referencia)
      .eq('semester', semestre)
      .maybeSingle();

    // status = 'registrado' | NÃO lacra ainda (fica visível no painel)
    const { error } = await supabase.from('emissoes_pacotes').update({
      status: 'registrado',
      atualizado_em: selectedDate.toISOString(),
      ...(processo?.id ? { processo_id: processo.id } : {}),
      ...(planilha_snapshot ? { planilha_snapshot } : {}),
    }).eq('id', activePacote.id);

    if (error) addToast('Erro ao registrar: ' + error.message, 'error');
    else { addToast('Emissão registrada! Expedir para arquivar.', 'success'); setShowRegistroModal(false); setActivePacote(null); fetchPacotes(); }
  }

  // Expedir individual: abre modal com data/hora + upload de boletos
  function handleExpedir(pacote) {
    setPacoteExpedir(pacote);
    const now = new Date();
    setDataExpedicao(new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 16));
    setArquivosExpedir([]);
    setStatusUpload({});
    setShowExpedirModal(true);
  }

  function adicionarArquivos(files) {
    const novos = Array.from(files).filter(
      f => !arquivosExpedir.some(e => e.name === f.name && e.size === f.size)
    );
    setArquivosExpedir(prev => [...prev, ...novos]);
  }

  function removerArquivo(idx) {
    setArquivosExpedir(prev => prev.filter((_, i) => i !== idx));
  }

  async function confirmarExpedir() {
    if (!dataExpedicao) return addToast('Informe a data e hora', 'error');
    setExpedindo(true);
    const selectedDate = new Date(dataExpedicao);

    // Upload de cada arquivo
    const novoStatus = {};
    for (const file of arquivosExpedir) {
      novoStatus[file.name] = 'uploading';
      setStatusUpload({ ...novoStatus });
      try {
        const ext      = file.name.split('.').pop().toLowerCase();
        const safeName = `${Date.now()}_${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
        const filePath = `${pacoteExpedir.condominio_id}/${pacoteExpedir.id}/${safeName}`;

        const { error: upErr } = await supabase.storage
          .from('emissoes')
          .upload(filePath, file, { upsert: false });

        if (upErr) throw upErr;

        await supabase.from('emissoes_arquivos').insert({
          pacote_id:     pacoteExpedir.id,
          condominio_id: pacoteExpedir.condominio_id,
          arquivo_nome:  file.name,
          arquivo_url:   filePath,
          formato:       ext,
          status:        'expedida',
        });

        novoStatus[file.name] = 'done';
      } catch (e) {
        novoStatus[file.name] = 'error';
        addToast(`Erro ao subir "${file.name}": ${e.message}`, 'error');
      }
      setStatusUpload({ ...novoStatus });
    }

    // Atualiza o pacote para expedida
    const { error } = await supabase.from('emissoes_pacotes').update({
      status:      'expedida',
      lacrada:     true,
      lacrada_em:  selectedDate.toISOString(),
      atualizado_em: selectedDate.toISOString(),
    }).eq('id', pacoteExpedir.id);

    setExpedindo(false);
    if (error) {
      addToast('Erro ao expedir', 'error');
    } else {
      const qtd = arquivosExpedir.length;
      addToast(`Expedida${qtd > 0 ? ` com ${qtd} arquivo${qtd > 1 ? 's' : ''}` : ''}!`, 'success');
      setShowExpedirModal(false);
      setPacoteExpedir(null);
      setArquivosExpedir([]);
      fetchPacotes();
    }
  }

  // Expedir Mês: lacra todos os "registrado" do mês de uma vez
  function abrirFecharMes() {
    const now = new Date();
    setDataFechamento(new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 16));
    setShowFecharMesModal(true);
  }

  async function confirmarFechamentoMes() {
    if (!dataFechamento) return addToast('Informe a data', 'error');
    setFechandoMes(true);

    const selectedDate = new Date(dataFechamento);
    let ok = 0;
    for (const pacote of prontosParaExpedir) {
      const { error } = await supabase.from('emissoes_pacotes').update({
        status: 'expedida',
        lacrada: true,
        lacrada_em: selectedDate.toISOString(),
        atualizado_em: selectedDate.toISOString(),
      }).eq('id', pacote.id);
      if (!error) ok++;
    }

    setFechandoMes(false);
    setShowFecharMesModal(false);
    addToast(`${ok} emissão(ões) expedida(s) e arquivada(s)!`, 'success');
    fetchPacotes();
  }

  async function handleRejeitar(pacote) {
    const reason = prompt('Motivo da correção:');
    if (!reason) return;
    await supabase.from('emissoes_pacotes')
      .update({ status: 'solicitar_correcao', comentario_correcao: reason, atualizado_em: new Date().toISOString() })
      .eq('id', pacote.id);
    fetchPacotes();
    addToast('Correção solicitada.', 'info');
  }

  const handleDelete = async (e, id) => {
    e.stopPropagation();
    if (confirmDeleteId !== id) {
      setConfirmDeleteId(id);
      addToast('Clique novamente para confirmar a exclusão', 'warning');
      setTimeout(() => setConfirmDeleteId(null), 3000);
      return;
    }
    try {
      const pacote = pacotes.find(p => p.id === id);
      if (pacote?.arquivos?.length) await supabase.storage.from('emissoes').remove(pacote.arquivos.map(a => a.arquivo_url));
      // Remove dependências antes do pacote (respeita FK)
      await supabase.from('emissoes_retificacoes').delete().eq('pacote_original_id', id);
      await supabase.from('emissoes_arquivos').delete().eq('pacote_id', id);
      const { error } = await supabase.from('emissoes_pacotes').delete().eq('id', id);
      if (error) throw error;
      setPacotes(prev => prev.filter(p => p.id !== id));
      setConfirmDeleteId(null);
      addToast('Pacote excluído com sucesso', 'success');
    } catch (err) { addToast('Falha: ' + err.message, 'error'); }
  };

  const handleDeleteOrphan = async (e, arqId, path) => {
    e.stopPropagation();
    if (confirmDeleteOrphanId !== arqId) {
      setConfirmDeleteOrphanId(arqId);
      addToast('Clique novamente para excluir o arquivo legado', 'warning');
      setTimeout(() => setConfirmDeleteOrphanId(null), 3000);
      return;
    }
    try {
      if (path) await supabase.storage.from('emissoes').remove([path]);
      const { error } = await supabase.from('emissoes_arquivos').delete().eq('id', arqId);
      if (error) throw error;
      setOrphans(prev => prev.filter(o => o.id !== arqId));
      setConfirmDeleteOrphanId(null);
      addToast('Arquivo legado removido', 'success');
      fetchPacotes();
    } catch (err) { addToast('Falha: ' + err.message, 'error'); }
  };

  async function openFileUrl(arq, pacote) {
    const { data, error } = await supabase.storage.from('emissoes').createSignedUrl(arq.arquivo_url, 300);
    if (error) return addToast('Erro ao abrir arquivo.', 'error');
    if (data?.signedUrl) {
      setArquivoAberto({
        id: arq.id,
        nome: arq.arquivo_nome,
        url: data.signedUrl,
        processo_id: pacote.processo_id || null,
        condominio_id: pacote.condominio_id,
        mes: pacote.mes_referencia,
        ano: pacote.ano_referencia,
        eh_retificacao: pacote.eh_retificacao || false,
        emitido_por: pacote.uploaded_by,
        arquivos: pacote.arquivos || [],
        planilha_snapshot: pacote.planilha_snapshot || null,
      });
    }
  }

  if (loading) return <div className="flex justify-center p-12"><Loader2 className="animate-spin w-8 h-8 text-violet-500"/></div>;

  return (
    <div className="space-y-8">

      {/* ── Navegação de Mês ── */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button onClick={() => navMes(-1)} className="p-2 rounded-xl bg-white/5 border border-white/10 text-gray-400 hover:text-white hover:bg-white/10 transition-all">
            <ChevronLeft className="w-5 h-5" />
          </button>
          <div className="px-6 py-2.5 bg-[#0a0a0f] border border-white/10 rounded-xl min-w-[160px] text-center">
            <span className="text-white font-black text-lg">{MESES[mesAtivo - 1]} {anoAtivo}</span>
            {mesAtivo === hoje.getMonth() + 1 && anoAtivo === hoje.getFullYear() && (
              <span className="ml-2 text-[9px] font-black uppercase tracking-widest text-cyan-400 bg-cyan-500/10 border border-cyan-500/20 px-1.5 py-0.5 rounded-full">Atual</span>
            )}
          </div>
          <button onClick={() => navMes(1)} className="p-2 rounded-xl bg-white/5 border border-white/10 text-gray-400 hover:text-white hover:bg-white/10 transition-all">
            <ChevronRight className="w-5 h-5" />
          </button>
        </div>

        {/* Botão Expedir Mês — aparece quando há emissões registradas prontas para expedir */}
        {prontosParaExpedir.length > 0 && (profile?.role === 'master' || profile?.role === 'departamento') && (
          <button onClick={abrirFecharMes}
            className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-gradient-to-r from-emerald-600 to-cyan-600 text-white font-black text-[11px] uppercase tracking-widest shadow-[0_0_20px_rgba(16,185,129,0.3)] hover:from-emerald-500 hover:to-cyan-500 transition-all border border-white/10">
            <Rocket className="w-4 h-4" />
            Expedir Mês — {prontosParaExpedir.length} emissão{prontosParaExpedir.length !== 1 ? 'ões' : ''}
          </button>
        )}
      </div>

      {/* ── Cards de Métricas ── */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-7 gap-4">
        {[
          { label: 'Total no Mês',       value: stats.total,            icon: Building,    color: 'text-gray-400',    bg: 'bg-white/5',             filter: null                           },
          { label: 'Em edição',          value: stats.rascunho,         icon: Edit,        color: 'text-blue-400',    bg: 'bg-blue-500/10',         filter: 'rascunho'                     },
          { label: 'Aguard. Registro',   value: stats.aprovado,         icon: CheckCircle, color: 'text-violet-400',  bg: 'bg-violet-500/10',       filter: 'aprovado'                     },
          { label: 'Registrada',         value: stats.registrado,       icon: FileCheck,   color: 'text-cyan-400',    bg: 'bg-cyan-500/10',         filter: 'registrado'                   },
          { label: 'Com o Gerente',      value: stats.gerente,          icon: User,        color: 'text-pink-400',    bg: 'bg-pink-500/10',         filter: 'pendente_gerente'             },
          { label: 'Com o Sup. Gerente', value: stats.supGerente,       icon: Activity,    color: 'text-amber-400',   bg: 'bg-amber-500/10',        filter: 'pendente_sup_gerentes'        },
          { label: 'Sup. Contabilidade', value: stats.supContabilidade, icon: ShieldCheck, color: 'text-orange-400',  bg: 'bg-orange-500/10',       filter: 'pendente_sup_contabilidade'   },
        ].map((stat, i) => (
          <button key={i}
            onClick={() => setFiltroAtivo(filtroAtivo === stat.filter ? null : stat.filter)}
            className={`p-6 border rounded-3xl bg-[#0a0a0f] flex flex-col justify-center gap-2 transition-all text-left group ${
              filtroAtivo === stat.filter
                ? 'border-blue-500 shadow-[0_0_15px_rgba(59,130,246,0.3)] ring-2 ring-blue-500/20'
                : 'border-white/10 hover:border-white/20'
            } ${stat.bg}`}
          >
            <div className="flex items-center gap-3">
              <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 mix-blend-lighten ${stat.bg} group-hover:scale-110 transition-transform`}>
                <stat.icon className={`w-5 h-5 ${stat.color}`} />
              </div>
              <p className="text-3xl font-black text-white leading-none">{stat.value}</p>
            </div>
            <p className="text-[9px] font-black uppercase tracking-widest text-gray-500 mt-1">{stat.label}</p>
          </button>
        ))}
      </div>

      {/* ── Lista do mês ── */}
      <div className="border border-white/10 rounded-3xl bg-white/5 overflow-hidden shadow-2xl">
        <div className="p-6 border-b border-white/10 flex items-center gap-4">
          <h3 className="font-black text-white text-lg flex items-center gap-2">
            <Activity className="text-cyan-400 w-5 h-5"/>
            FLUXO — {MESES[mesAtivo - 1]}/{anoAtivo}
          </h3>
          {filtroAtivo && (
            <div className="flex items-center gap-2 bg-blue-500/10 border border-blue-500/20 px-3 py-1 rounded-full">
              <span className="text-[10px] font-black text-blue-400 uppercase tracking-widest">
                Filtro: {filtroAtivo.replace(/_/g, ' ')}
              </span>
              <button onClick={() => setFiltroAtivo(null)} className="p-1 hover:bg-blue-500/20 rounded-full transition-colors">
                <X className="w-3 h-3 text-blue-400" />
              </button>
            </div>
          )}
        </div>

        <div className="divide-y divide-white/5">
          {pacotesFiltrados.length === 0 ? (
            <div className="px-6 py-12 text-center text-gray-500 text-sm">
              {pacotesAtivos.length === 0
                ? `Nenhuma emissão em ${MESES[mesAtivo - 1]}/${anoAtivo}.`
                : 'Nenhum pacote nesta categoria.'}
            </div>
          ) : pacotesFiltrados.map(pacote => {
            const numArq      = pacote.arquivos?.length || 0;
            const statusLower = (pacote.status || '').toLowerCase();
            const isRegistrado = statusLower === 'registrado';
            const roleAutorizado = profile?.role === 'master' || profile?.role === 'departamento';

            return (
              <div key={pacote.id} className={`hover:bg-white/[0.02] transition-colors ${isRegistrado ? 'border-l-2 border-cyan-500/30' : ''}`}>
                <div className="px-6 py-4 flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${isRegistrado ? 'bg-cyan-500/10' : 'bg-white/5'}`}>
                      <Package className={`w-5 h-5 ${isRegistrado ? 'text-cyan-400' : 'text-violet-400'}`} />
                    </div>
                    <div>
                      <p className="font-bold text-white text-sm">{pacote.condominios?.name}</p>
                      <p className="text-[10px] text-gray-500">
                        {String(pacote.mes_referencia).padStart(2,'0')}/{pacote.ano_referencia} • {numArq} arquivo{numArq !== 1 ? 's' : ''}
                        {isRegistrado && pacote.planilha_snapshot && (
                          <span className="ml-2 text-cyan-500">• 🔒 planilha congelada</span>
                        )}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-3">
                    <StatusBadge status={pacote.status} />

                    <div className="flex gap-1">
                      {/* Registrar (aprovado → registrado) */}
                      {statusLower === 'aprovado' && roleAutorizado && (
                        <button onClick={() => handleRegistrar(pacote)}
                          className="flex items-center gap-2 px-4 py-2 rounded-xl bg-gradient-to-r from-violet-500 to-blue-500 text-white hover:from-violet-400 hover:to-blue-400 transition-all shadow-lg font-black text-[10px] uppercase tracking-widest border border-white/10">
                          <FileCheck className="w-4 h-4" />
                          Registrar
                        </button>
                      )}

                      {/* Expedir (registrado → expedida → histórico) */}
                      {isRegistrado && roleAutorizado && (
                        <button onClick={() => handleExpedir(pacote)}
                          className="flex items-center gap-2 px-4 py-2 rounded-xl bg-gradient-to-r from-emerald-500 to-cyan-500 text-white hover:from-emerald-400 hover:to-cyan-400 transition-all shadow-lg font-black text-[10px] uppercase tracking-widest border border-white/10">
                          <Rocket className="w-4 h-4" />
                          Expedir
                        </button>
                      )}

                      {/* Solicitar correção */}
                      {statusLower !== 'registrado' && statusLower !== 'rascunho' && statusLower !== 'aprovado' && statusLower !== 'expedida' && (
                        <button onClick={() => handleRejeitar(pacote)} className="p-2 rounded-lg bg-white/5 text-rose-400 hover:bg-rose-500/20 transition-all" title="Solicitar Correção">
                          <XCircle className="w-4 h-4" />
                        </button>
                      )}

                      {/* Enviar para aprovação (rascunho / correção) */}
                      {(statusLower === 'rascunho' || statusLower === 'solicitar_correcao') && (
                        <button onClick={() => handleConcluirRapido(pacote)} className="p-2 rounded-lg bg-emerald-600/20 text-emerald-400 hover:bg-emerald-600/40 border border-emerald-500/30 transition-all" title="Enviar para Aprovação">
                          <SendIcon className="w-4 h-4" />
                        </button>
                      )}

                      {/* Aprovar manualmente (em fluxo de aprovação) */}
                      {statusLower !== 'registrado' && statusLower !== 'aprovado' && statusLower !== 'rascunho' && statusLower !== 'solicitar_correcao' && (
                        <button onClick={() => handleAprovar(pacote)} className="p-2 rounded-lg bg-emerald-600 text-white hover:bg-emerald-500 transition-all" title="Aprovação">
                          <CheckCircle className="w-4 h-4" />
                        </button>
                      )}
                    </div>

                    <button onClick={(e) => handleDelete(e, pacote.id)}
                      className={`p-2 rounded-lg transition-all ${confirmDeleteId === pacote.id ? 'bg-rose-500 text-white animate-pulse' : 'bg-white/5 text-rose-400/50 hover:text-rose-400 hover:bg-rose-500/10'}`}
                      title={confirmDeleteId === pacote.id ? 'Clique para confirmar' : 'Excluir'}>
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                {numArq > 0 && (
                  <div className="px-6 pb-4 flex flex-wrap gap-2">
                    {pacote.arquivos.map(arq => (
                      <button key={arq.id} onClick={() => openFileUrl(arq, pacote)}
                        className="flex items-center gap-2 px-3 py-1.5 bg-[#0a0a0f] border border-white/10 rounded-lg hover:border-cyan-500/30 hover:bg-cyan-500/5 transition-all group text-xs">
                        <FileText className="w-3 h-3 text-gray-500 group-hover:text-cyan-400" />
                        <span className="font-bold text-gray-400 group-hover:text-white truncate max-w-[120px]">{arq.arquivo_nome}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Arquivos Órfãos ── */}
      {orphans.length > 0 && (
        <div className="border border-rose-500/20 rounded-3xl bg-rose-500/5 overflow-hidden shadow-xl">
          <div className="p-6 border-b border-rose-500/10 flex items-center justify-between">
            <h3 className="font-black text-white text-lg flex items-center gap-2">
              <FileText className="text-rose-400 w-5 h-5"/>Arquivos Órfãos / Legados
            </h3>
            <span className="text-[10px] font-bold text-rose-400/60 uppercase tracking-widest bg-rose-500/10 px-3 py-1 rounded-full border border-rose-500/20">
              Não pertencem a pacotes
            </span>
          </div>
          <div className="divide-y divide-rose-500/5">
            {orphans.map(arq => (
              <div key={arq.id} className="px-6 py-4 flex items-center justify-between hover:bg-rose-500/[0.02] transition-colors">
                <div className="flex items-center gap-4">
                  <div className="w-10 h-10 rounded-xl bg-rose-500/10 flex items-center justify-center">
                    <FileText className="w-5 h-5 text-rose-400" />
                  </div>
                  <div>
                    <p className="font-bold text-white text-sm">{arq.arquivo_nome}</p>
                    <p className="text-[10px] text-gray-500 uppercase tracking-widest">
                      {arq.condominios?.name || 'Condomínio não identificado'} • {new Date(arq.criado_em).toLocaleDateString()}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <StatusBadge status={arq.status} />
                  <button onClick={() => openFileUrl(arq, { status: 'none' })} className="p-2 rounded-lg bg-white/5 text-gray-400 hover:text-white" title="Visualizar">
                    <ExternalLink className="w-4 h-4" />
                  </button>
                  <button onClick={(e) => handleDeleteOrphan(e, arq.id, arq.arquivo_url)}
                    className={`p-2 rounded-lg transition-all ${confirmDeleteOrphanId === arq.id ? 'bg-rose-500 text-white animate-pulse' : 'bg-white/5 text-rose-400/50 hover:text-rose-400 hover:bg-rose-500/10'}`}
                    title="Excluir Permanentemente">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <FilePreviewDrawer isOpen={isDrawerOpen} onClose={() => setIsDrawerOpen(false)} file={selectedFile} />

      {arquivoAberto && (
        <VisualizadorConferencia
          arquivo={arquivoAberto}
          arquivos={arquivoAberto.arquivos}
          currentUser={user}
          onClose={() => setArquivoAberto(null)}
          onAction={() => { setArquivoAberto(null); fetchPacotes(); }}
        />
      )}

      {/* ═══ MODAL EXPEDIR INDIVIDUAL ═══ */}
      {showExpedirModal && pacoteExpedir && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="bg-[#0a0a0f] border border-white/10 rounded-3xl w-full max-w-lg shadow-2xl flex flex-col max-h-[90vh]">

            {/* Header */}
            <div className="flex items-center justify-between px-8 pt-8 pb-4 shrink-0">
              <div>
                <h3 className="text-xl font-black text-white">Expedir Emissão</h3>
                <p className="text-[10px] text-emerald-400 font-black uppercase tracking-widest mt-1">
                  {pacoteExpedir.condominios?.name} — {String(pacoteExpedir.mes_referencia).padStart(2,'0')}/{pacoteExpedir.ano_referencia}
                </p>
              </div>
              <button onClick={() => !expedindo && setShowExpedirModal(false)}
                className="p-2 hover:bg-white/5 rounded-full text-gray-500 hover:text-white transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="px-8 pb-8 overflow-y-auto space-y-5">
              {/* Data e hora */}
              <div>
                <label className="block text-xs font-bold text-gray-400 uppercase tracking-widest mb-2">Data e Hora da Expedição</label>
                <input type="datetime-local" value={dataExpedicao}
                  onChange={e => setDataExpedicao(e.target.value)}
                  disabled={expedindo}
                  className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white outline-none focus:border-emerald-500 transition-all disabled:opacity-50" />
              </div>

              {/* Área de upload */}
              <div>
                <label className="block text-xs font-bold text-gray-400 uppercase tracking-widest mb-2">
                  Boletos e Arquivos
                  <span className="ml-2 text-gray-600 normal-case font-normal">— opcional, qualquer tamanho</span>
                </label>

                <div
                  onClick={() => !expedindo && document.getElementById('expedir-file-input').click()}
                  onDragOver={e => { e.preventDefault(); setDragOver(true); }}
                  onDragLeave={() => setDragOver(false)}
                  onDrop={e => { e.preventDefault(); setDragOver(false); adicionarArquivos(e.dataTransfer.files); }}
                  className={`border-2 border-dashed rounded-2xl p-8 text-center cursor-pointer transition-all ${
                    dragOver
                      ? 'border-emerald-500/60 bg-emerald-500/5'
                      : 'border-white/10 hover:border-emerald-500/30 hover:bg-white/[0.02]'
                  } ${expedindo ? 'pointer-events-none opacity-50' : ''}`}
                >
                  <Upload className="w-8 h-8 text-gray-600 mx-auto mb-3" />
                  <p className="text-sm font-bold text-gray-400">Arraste os boletos aqui</p>
                  <p className="text-xs text-gray-600 mt-1">ou clique para selecionar — PDF, imagens, qualquer formato</p>
                  <input id="expedir-file-input" type="file" multiple className="hidden"
                    onChange={e => { adicionarArquivos(e.target.files); e.target.value = ''; }} />
                </div>

                {/* Lista de arquivos selecionados */}
                {arquivosExpedir.length > 0 && (
                  <div className="mt-3 space-y-2 max-h-52 overflow-y-auto">
                    {arquivosExpedir.map((file, i) => {
                      const st = statusUpload[file.name];
                      return (
                        <div key={i} className={`flex items-center gap-3 px-4 py-2.5 border rounded-xl transition-all ${
                          st === 'done'     ? 'bg-emerald-500/5 border-emerald-500/20' :
                          st === 'error'    ? 'bg-rose-500/5 border-rose-500/20' :
                          st === 'uploading'? 'bg-violet-500/5 border-violet-500/20' :
                          'bg-white/5 border-white/10'
                        }`}>
                          <FileText className={`w-4 h-4 shrink-0 ${
                            st === 'done' ? 'text-emerald-400' : st === 'error' ? 'text-rose-400' : 'text-gray-400'
                          }`} />
                          <div className="flex-1 min-w-0">
                            <p className="text-xs font-bold text-gray-300 truncate">{file.name}</p>
                            <p className="text-[10px] text-gray-600">{(file.size / 1024 / 1024).toFixed(2)} MB</p>
                          </div>
                          {st === 'done'      && <CheckCircle className="w-4 h-4 text-emerald-400 shrink-0" />}
                          {st === 'uploading' && <Loader2 className="w-4 h-4 text-violet-400 animate-spin shrink-0" />}
                          {st === 'error'     && <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />}
                          {!st               && (
                            <button onClick={() => removerArquivo(i)} className="p-1 rounded-lg text-gray-500 hover:text-rose-400 hover:bg-rose-500/10 transition-all">
                              <X className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}

                {arquivosExpedir.length > 0 && !expedindo && (
                  <p className="text-[10px] text-gray-600 mt-2 text-center">
                    {arquivosExpedir.length} arquivo{arquivosExpedir.length > 1 ? 's' : ''} selecionado{arquivosExpedir.length > 1 ? 's' : ''} •{' '}
                    {(arquivosExpedir.reduce((a, f) => a + f.size, 0) / 1024 / 1024).toFixed(2)} MB total
                  </p>
                )}
              </div>

              {/* Botões */}
              <div className="flex gap-3 pt-2">
                <button onClick={() => setShowExpedirModal(false)} disabled={expedindo}
                  className="flex-1 py-3 rounded-xl text-xs font-bold uppercase tracking-widest text-gray-400 hover:text-white hover:bg-white/5 transition-colors disabled:opacity-30">
                  Cancelar
                </button>
                <button onClick={confirmarExpedir} disabled={expedindo}
                  className="flex-[2] py-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-black uppercase tracking-widest text-xs shadow-lg transition-all flex items-center justify-center gap-2 disabled:opacity-60">
                  {expedindo
                    ? <><Loader2 className="w-4 h-4 animate-spin" />
                        {arquivosExpedir.length > 0
                          ? `Enviando ${Object.values(statusUpload).filter(s => s === 'done').length}/${arquivosExpedir.length}...`
                          : 'Expedindo...'}
                      </>
                    : <><Rocket className="w-4 h-4" />Confirmar Expedição</>
                  }
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ═══ MODAL EXPEDIR MÊS ═══ */}
      {showFecharMesModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="bg-[#0a0a0f] border border-white/10 rounded-3xl w-full max-w-md p-8 shadow-2xl">
            <div className="w-16 h-16 bg-emerald-500/10 border border-emerald-500/20 rounded-full flex items-center justify-center mx-auto mb-6">
              <Rocket className="w-8 h-8 text-emerald-400" />
            </div>
            <h3 className="text-xl font-black text-white text-center mb-1">Expedir {MESES[mesAtivo - 1]}/{anoAtivo}</h3>
            <p className="text-sm text-gray-400 text-center mb-2">
              <span className="font-black text-white">{prontosParaExpedir.length}</span> emissão{prontosParaExpedir.length !== 1 ? 'ões' : ''} serão expedidas e arquivadas no histórico.
            </p>
            <p className="text-[10px] text-emerald-400/70 text-center mb-6 font-bold uppercase tracking-widest">
              Esta ação não pode ser desfeita.
            </p>

            <div className="mb-8">
              <label className="block text-xs font-bold text-gray-400 uppercase tracking-widest mb-2">Data e Hora da Expedição</label>
              <input type="datetime-local" value={dataFechamento}
                onChange={(e) => setDataFechamento(e.target.value)}
                min={new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16)}
                className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white outline-none focus:border-emerald-500 transition-all" />
            </div>

            <div className="flex gap-3">
              <button onClick={() => setShowFecharMesModal(false)} disabled={fechandoMes}
                className="flex-1 py-3 rounded-xl text-xs font-bold uppercase tracking-widest text-gray-400 hover:text-white hover:bg-white/5 transition-colors disabled:opacity-30">
                Cancelar
              </button>
              <button onClick={confirmarFechamentoMes} disabled={fechandoMes}
                className="flex-[2] py-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-black uppercase tracking-widest text-xs shadow-lg transition-all flex items-center justify-center gap-2 disabled:opacity-50">
                {fechandoMes
                  ? <><Loader2 className="w-4 h-4 animate-spin" />Expedindo...</>
                  : <><Rocket className="w-4 h-4" />Confirmar Expedição</>}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ═══ MODAL DE CONCLUSÃO ═══ */}
      {showConcluirModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="bg-[#0a0a0f] border border-white/10 rounded-3xl w-full max-w-md p-8 shadow-2xl">
            <div className="w-16 h-16 bg-emerald-500/10 border border-emerald-500/20 rounded-full flex items-center justify-center mx-auto mb-6">
              <CheckCircle className="w-8 h-8 text-emerald-400" />
            </div>
            <h3 className="text-xl font-black text-white text-center mb-2">Concluir Emissão</h3>
            <p className="text-sm text-gray-400 text-center mb-8">{activePacote?.arquivos?.length || 0} arquivos neste pacote.</p>

            <div className="space-y-3 mb-8">
              {[
                { id: 1, label: 'Nível 1 - Sem consumos',              desc: 'Passa direto para a Supervisora' },
                { id: 2, label: 'Nível 2 - Alteração sem consumo',     desc: 'Passa por Gerente ➔ Supervisora' },
                { id: 3, label: 'Nível 3 - Fração',                    desc: 'Passa por Gerente ➔ Supervisora' },
                { id: 4, label: 'Nível 4 - Com empresas terceirizadas', desc: 'Passa por Gerente ➔ Sup. Gerentes ➔ Supervisora' },
              ].map(n => (
                <button key={n.id} onClick={() => setNivelAprovacao(n.id)}
                  className={`w-full p-4 rounded-2xl border-2 text-left transition-all ${nivelAprovacao === n.id ? 'border-violet-600 bg-violet-600/10' : 'border-white/5 bg-white/5 hover:border-white/20'}`}>
                  <div className="flex items-center gap-3">
                    <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${nivelAprovacao === n.id ? 'border-violet-500' : 'border-gray-600'}`}>
                      {nivelAprovacao === n.id && <div className="w-2.5 h-2.5 rounded-full bg-violet-500" />}
                    </div>
                    <div>
                      <p className="font-bold text-white">{n.label}</p>
                      <p className="text-xs text-gray-400">{n.desc}</p>
                    </div>
                  </div>
                </button>
              ))}
            </div>

            <div className="flex gap-3">
              <button onClick={() => setShowConcluirModal(false)} className="flex-1 py-3 rounded-xl text-xs font-bold uppercase tracking-widest text-gray-400 hover:text-white hover:bg-white/5 transition-colors">Cancelar</button>
              <button onClick={confirmarConclusao} className="flex-[2] py-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-black uppercase tracking-widest text-xs shadow-lg transition-all">Confirmar e Enviar</button>
            </div>
          </div>
        </div>
      )}

      {/* ═══ MODAL DE REGISTRO ═══ */}
      {showRegistroModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="bg-[#0a0a0f] border border-white/10 rounded-3xl w-full max-w-md p-8 shadow-2xl">
            <div className="w-16 h-16 bg-violet-500/10 border border-violet-500/20 rounded-full flex items-center justify-center mx-auto mb-6">
              <FileCheck className="w-8 h-8 text-violet-400" />
            </div>
            <h3 className="text-xl font-black text-white text-center mb-2">Registrar Emissão</h3>
            <p className="text-sm text-gray-400 text-center mb-1">Confirme a data e hora do registro.</p>
            <p className="text-[10px] text-amber-400/70 text-center mb-8 font-bold uppercase tracking-widest">
              A planilha será congelada. A emissão permanece no painel até ser expedida.
            </p>

            <div className="mb-8">
              <label className="block text-xs font-bold text-gray-400 uppercase tracking-widest mb-2">Data e Hora</label>
              <input type="datetime-local" value={dataRegistro}
                onChange={(e) => setDataRegistro(e.target.value)}
                min={new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16)}
                className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white outline-none focus:border-violet-500 transition-all" />
            </div>

            <div className="flex gap-3">
              <button onClick={() => { setShowRegistroModal(false); setActivePacote(null); }}
                className="flex-1 py-3 rounded-xl text-xs font-bold uppercase tracking-widest text-gray-400 hover:text-white hover:bg-white/5 transition-colors">
                Cancelar
              </button>
              <button onClick={confirmarRegistro}
                className="flex-[2] py-3 rounded-xl bg-violet-600 hover:bg-violet-500 text-white font-black uppercase tracking-widest text-xs shadow-lg transition-all">
                Confirmar Registro
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
