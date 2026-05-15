'use client';

import { useEffect, useState, useCallback } from 'react';
import { createClient } from '@/utils/supabase/client';
import { useAuth } from '@/lib/auth';
import { useToast } from '@/components/Toast';
import {
  Users, ShieldAlert, PlusCircle, Trash2, Mail, Loader2, X,
  RefreshCw, Building2, Link2, Unlink, ChevronDown, ChevronUp,
  Eye, EyeOff, UserCog, Check, KeyRound, Copy
} from 'lucide-react';

const ROLES = [
  { value: 'master', label: 'Master (Acesso Total)' },
  { value: 'gerente', label: 'Gerente (Sua carteira)' },
  { value: 'assistente', label: 'Assistente' },
  { value: 'supervisora', label: 'Supervisora (Aprovações)' },
  { value: 'supervisora_contabilidade', label: 'Sp. Contabilidade' },
  { value: 'supervisor_gerentes', label: 'Supervisor dos Gerentes' },
  { value: 'departamento', label: 'Departamento / Emissor' },
  { value: 'sindico', label: 'Síndico' },
];

const roleStyle = {
  master: 'bg-orange-500/10 text-orange-400 border-orange-500/20',
  gerente: 'bg-indigo-500/10 text-indigo-400 border-indigo-500/20',
  assistente: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
  supervisora: 'bg-purple-500/10 text-purple-400 border-purple-500/20',
  supervisora_contabilidade: 'bg-cyan-500/10 text-cyan-400 border-cyan-500/20',
  supervisor_gerentes: 'bg-pink-500/10 text-pink-400 border-pink-500/20',
  departamento: 'bg-teal-500/10 text-teal-400 border-teal-500/20',
  sindico: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
  outros: 'bg-slate-500/10 text-slate-400 border-slate-500/20',
};

async function getToken() {
  const supabase = createClient();
  const { data: { session } } = await supabase.auth.getSession();
  return session?.access_token;
}

async function apiFetch(url, opts = {}) {
  const token = await getToken();
  const res = await fetch(url, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
      ...(opts.headers || {}),
    },
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.detail || 'Erro na requisição');
  return json;
}

// ─── Modal Criar Usuário ───────────────────────────────────────────────
function ModalCriarUsuario({ onClose, onCreated }) {
  const [form, setForm] = useState({ email: '', password: '', full_name: '', role: 'gerente' });
  const [showPass, setShowPass] = useState(false);
  const [loading, setLoading] = useState(false);
  const { addToast } = useToast();

  async function handleSubmit(e) {
    e.preventDefault();
    setLoading(true);
    try {
      await apiFetch('/api/usuarios', { method: 'POST', body: JSON.stringify(form) });
      addToast('Usuário criado com sucesso!', 'success');
      onCreated();
      onClose();
    } catch (err) {
      addToast(err.message, 'error');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4">
      <div className="bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl w-full max-w-md">
        <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <UserCog className="w-5 h-5 text-indigo-400" />
            <h3 className="text-lg font-bold text-slate-200">Criar Nova Conta</h3>
          </div>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-300"><X className="w-5 h-5" /></button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div>
            <label className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Nome Completo</label>
            <input required value={form.full_name} onChange={e => setForm({ ...form, full_name: e.target.value })}
              placeholder="Ex: João Silva"
              className="w-full bg-slate-800 border border-slate-700 rounded-lg p-3 text-sm text-slate-200 mt-1 outline-none focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500 placeholder-slate-600" />
          </div>
          <div>
            <label className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">E-mail</label>
            <input required type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })}
              placeholder="email@exemplo.com"
              className="w-full bg-slate-800 border border-slate-700 rounded-lg p-3 text-sm text-slate-200 mt-1 outline-none focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500 placeholder-slate-600" />
          </div>
          <div>
            <label className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Senha Temporária</label>
            <div className="relative mt-1">
              <input required type={showPass ? 'text' : 'password'} minLength={6} value={form.password}
                onChange={e => setForm({ ...form, password: e.target.value })}
                placeholder="Mínimo 6 caracteres"
                className="w-full bg-slate-800 border border-slate-700 rounded-lg p-3 pr-10 text-sm text-indigo-300 font-mono outline-none focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500 placeholder-slate-600" />
              <button type="button" onClick={() => setShowPass(!showPass)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300">
                {showPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>
          <div>
            <label className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Nível de Acesso</label>
            <select value={form.role} onChange={e => setForm({ ...form, role: e.target.value })}
              className="w-full bg-slate-800 border border-slate-700 rounded-lg p-3 text-sm text-slate-200 mt-1 outline-none focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500">
              {ROLES.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
            </select>
          </div>

          {form.role === 'gerente' && (
            <div className="bg-indigo-500/10 border border-indigo-500/20 rounded-lg p-3 text-xs text-indigo-300">
              <strong>Dica:</strong> Após criar, clique em <strong>&quot;Gerenciar Carteira&quot;</strong> no card do gerente para vincular os condomínios.
            </div>
          )}

          <div className="pt-2">
            <button disabled={loading} type="submit"
              className="w-full py-3 bg-indigo-600 text-white font-bold rounded-lg hover:bg-indigo-500 transition-colors flex justify-center items-center gap-2 disabled:opacity-50">
              {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <><PlusCircle className="w-4 h-4" /> Criar Conta</>}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Modal Resetar Senha ──────────────────────────────────────────────
function ModalResetSenha({ usuario, onClose }) {
  const [pwd, setPwd] = useState(() => gerarSenhaTemp());
  const [show, setShow] = useState(true);
  const [force, setForce] = useState(true);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const { addToast } = useToast();

  async function handleSubmit(e) {
    e.preventDefault();
    if (pwd.length < 6) { addToast('Senha deve ter no mínimo 6 caracteres', 'error'); return; }
    setLoading(true);
    try {
      await apiFetch(`/api/usuarios/${usuario.id}/reset-password`, {
        method: 'POST',
        body: JSON.stringify({ new_password: pwd, force_change: force }),
      });
      addToast(`Senha de ${usuario.full_name} atualizada!`, 'success');
      onClose();
    } catch (err) {
      addToast(err.message, 'error');
    } finally {
      setLoading(false);
    }
  }

  function copiar() {
    navigator.clipboard.writeText(pwd);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4">
      <div className="bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl w-full max-w-md">
        <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <KeyRound className="w-5 h-5 text-cyan-400" />
            <h3 className="text-lg font-bold text-slate-200">Resetar Senha</h3>
          </div>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-300"><X className="w-5 h-5" /></button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-5">
          <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-4">
            <p className="text-xs text-slate-500 uppercase tracking-widest font-bold">Usuário</p>
            <p className="text-sm text-slate-200 font-bold mt-1">{usuario.full_name}</p>
            <p className="text-xs text-slate-500">{usuario.email}</p>
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Nova Senha</label>
              <button type="button" onClick={() => setPwd(gerarSenhaTemp())}
                className="text-[10px] text-cyan-400 hover:text-cyan-300 font-bold uppercase tracking-wider flex items-center gap-1">
                <RefreshCw className="w-3 h-3" /> Gerar nova
              </button>
            </div>
            <div className="relative">
              <input required type={show ? 'text' : 'password'} minLength={6} value={pwd}
                onChange={(e) => setPwd(e.target.value)}
                className="w-full bg-slate-800 border border-slate-700 rounded-lg p-3 pr-20 text-sm text-cyan-300 font-mono outline-none focus:border-cyan-500" />
              <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1">
                <button type="button" onClick={copiar}
                  className={`p-1.5 rounded transition-colors ${copied ? 'text-emerald-400' : 'text-slate-500 hover:text-cyan-400'}`}
                  title="Copiar">
                  {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                </button>
                <button type="button" onClick={() => setShow(!show)}
                  className="p-1.5 rounded text-slate-500 hover:text-cyan-400 transition-colors">
                  {show ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                </button>
              </div>
            </div>
            <p className="text-[10px] text-slate-500 mt-2">Envie esta senha de forma segura ao usuário.</p>
          </div>

          <label className="flex items-start gap-3 cursor-pointer p-3 rounded-xl border border-slate-800 hover:border-cyan-500/30 transition-colors">
            <input type="checkbox" checked={force} onChange={(e) => setForce(e.target.checked)}
              className="mt-0.5 accent-cyan-500" />
            <div>
              <p className="text-xs font-bold text-slate-200">Exigir nova troca no próximo login</p>
              <p className="text-[10px] text-slate-500 mt-0.5">Recomendado: o usuário cria uma senha pessoal ao acessar.</p>
            </div>
          </label>

          <div className="pt-2 flex gap-3">
            <button type="button" onClick={onClose} className="px-5 py-3 text-xs text-slate-500 font-bold uppercase tracking-widest hover:text-white transition-colors">
              Cancelar
            </button>
            <button disabled={loading} type="submit"
              className="flex-1 py-3 bg-cyan-500 text-slate-950 font-bold rounded-xl hover:bg-cyan-400 transition-colors flex justify-center items-center gap-2 disabled:opacity-50">
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <KeyRound className="w-4 h-4" />}
              Atualizar Senha
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function gerarSenhaTemp() {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  let out = '';
  for (let i = 0; i < 10; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out + '!';
}

// ─── Modal Carteira ───────────────────────────────────────────────────
function ModalCarteira({ usuario, onClose, onUpdated }) {
  const [dados, setDados] = useState(null);
  const [loading, setLoading] = useState(true);
  const [operando, setOperando] = useState(null);
  const { addToast } = useToast();

  const carregar = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiFetch(`/api/usuarios/${usuario.id}/carteiras`);
      setDados(res);
    } catch (err) {
      addToast(err.message, 'error');
    } finally {
      setLoading(false);
    }
  }, [usuario.id, addToast]);

  useEffect(() => { carregar(); }, [carregar]);

  async function vincular(condoId) {
    setOperando(condoId);
    try {
      await apiFetch('/api/usuarios/vincular-condo', {
        method: 'POST',
        body: JSON.stringify({ gerente_id: dados.gerente_id, condominio_id: condoId })
      });
      addToast('Condomínio vinculado!', 'success');
      await carregar();
      onUpdated();
    } catch (err) {
      addToast(err.message, 'error');
    } finally {
      setOperando(null);
    }
  }

  async function desvincular(condoId) {
    setOperando(condoId);
    try {
      await apiFetch('/api/usuarios/desvincular-condo', {
        method: 'POST',
        body: JSON.stringify({ condominio_id: condoId })
      });
      addToast('Condomínio desvinculado.', 'success');
      await carregar();
      onUpdated();
    } catch (err) {
      addToast(err.message, 'error');
    } finally {
      setOperando(null);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4">
      <div className="bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl w-full max-w-lg max-h-[85vh] flex flex-col">
        <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between shrink-0">
          <div>
            <div className="flex items-center gap-2">
              <Building2 className="w-5 h-5 text-indigo-400" />
              <h3 className="text-lg font-bold text-slate-200">Carteira de Condomínios</h3>
            </div>
            <p className="text-xs text-slate-400 mt-0.5">Gerente: <span className="text-slate-300 font-medium">{usuario.full_name}</span></p>
          </div>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-300"><X className="w-5 h-5" /></button>
        </div>

        <div className="overflow-y-auto flex-1 p-6 space-y-6">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-8 h-8 animate-spin text-indigo-500" />
            </div>
          ) : (
            <>
              <div>
                <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-3 flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-emerald-500 inline-block"></span>
                  Vinculados ({dados?.condominios_vinculados?.length || 0})
                </h4>
                {dados?.condominios_vinculados?.length === 0 ? (
                  <p className="text-sm text-slate-500 italic">Nenhum condomínio vinculado ainda.</p>
                ) : (
                  <div className="space-y-2">
                    {dados.condominios_vinculados.map(c => (
                      <div key={c.id} className="flex items-center justify-between bg-emerald-500/5 border border-emerald-500/20 rounded-lg px-4 py-2.5 group">
                        <div className="flex items-center gap-2 min-w-0">
                          <Check className="w-4 h-4 text-emerald-500 shrink-0" />
                          <span className="text-sm text-slate-200 truncate">{c.name}</span>
                        </div>
                        <button onClick={() => desvincular(c.id)} disabled={operando === c.id}
                          className="text-slate-600 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-all ml-3 shrink-0" title="Desvincular">
                          {operando === c.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Unlink className="w-4 h-4" />}
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div>
                <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-3 flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-slate-500 inline-block"></span>
                  Disponíveis para vincular ({dados?.condominios_disponiveis?.length || 0})
                </h4>
                {dados?.condominios_disponiveis?.length === 0 ? (
                  <p className="text-sm text-slate-500 italic">Nenhum condomínio disponível no momento.</p>
                ) : (
                  <div className="space-y-2">
                    {dados.condominios_disponiveis.map(c => (
                      <div key={c.id} className="flex items-center justify-between bg-slate-800/50 border border-slate-700 rounded-lg px-4 py-2.5 group hover:border-indigo-500/40 transition-colors">
                        <div className="flex items-center gap-2 min-w-0">
                          <Building2 className="w-4 h-4 text-slate-500 shrink-0" />
                          <span className="text-sm text-slate-300 truncate">{c.name}</span>
                        </div>
                        <button onClick={() => vincular(c.id)} disabled={operando === c.id}
                          className="text-slate-600 hover:text-indigo-400 transition-colors ml-3 shrink-0 flex items-center gap-1 text-xs font-medium">
                          {operando === c.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <><Link2 className="w-4 h-4" /> Vincular</>}
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </div>

        <div className="px-6 py-4 border-t border-slate-800 shrink-0">
          <button onClick={onClose} className="w-full py-2.5 bg-slate-800 text-slate-300 font-medium rounded-lg hover:bg-slate-700 transition-colors text-sm">
            Fechar
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Card Usuário ──────────────────────────────────────────────────────
function UserCard({ u, currentUserId, onSync, onCarteira, onDeleted }) {
  const isMaster = u.role === 'master';
  const isGerente = u.role === 'gerente';
  const style = roleStyle[u.role] || roleStyle.gerente;
  const condos = u.condominios || [];
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="bg-slate-900 border border-slate-800 p-5 rounded-xl shadow-xl hover:border-indigo-500/30 transition-colors group flex flex-col gap-4">
      <div className="flex items-start gap-4">
        <div className={`w-12 h-12 rounded-full flex items-center justify-center shrink-0 border ${isMaster ? 'bg-orange-500/20 text-orange-400 border-orange-500/30' : 'bg-indigo-500/20 text-indigo-400 border-indigo-500/30'}`}>
          {isMaster ? <ShieldAlert className="w-6 h-6" /> : <Users className="w-6 h-6" />}
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="font-bold text-slate-200 truncate">{u.full_name || 'Usuário'}</h3>
          <p className="text-xs text-slate-400 mt-1 flex items-center gap-1.5 truncate">
            <Mail className="w-3 h-3 shrink-0" /> {u.email}
          </p>
          <div className="mt-2">
            <span className={`text-[10px] font-bold uppercase px-2.5 py-1 rounded border ${style}`}>
              {ROLES.find(r => r.value === u.role)?.label || u.role}
            </span>
          </div>
        </div>
        {currentUserId !== u.id && (
          <div className="flex flex-col gap-1.5 shrink-0">
            <button onClick={() => onSync(u)} title="Resetar senha"
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-cyan-500/10 border border-cyan-500/20 text-cyan-400 hover:bg-cyan-500 hover:text-slate-950 transition-all text-[10px] font-bold uppercase tracking-wider">
              <KeyRound className="w-3.5 h-3.5" /> Senha
            </button>
            <button onClick={() => onDeleted(u)} title="Excluir usuário"
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-rose-500/10 border border-rose-500/20 text-rose-400 hover:bg-rose-500 hover:text-white transition-all text-[10px] font-bold uppercase tracking-wider">
              <Trash2 className="w-3.5 h-3.5" /> Excluir
            </button>
          </div>
        )}
      </div>

      {isGerente && (
        <div className="border-t border-slate-800 pt-3">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[10px] text-slate-500 uppercase font-bold tracking-wider flex items-center gap-1.5">
              <Building2 className="w-3 h-3" /> Carteira ({condos.length})
            </span>
            <div className="flex items-center gap-2">
              {condos.length > 2 && (
                <button onClick={() => setExpanded(!expanded)} className="text-slate-500 hover:text-slate-300">
                  {expanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                </button>
              )}
              <button onClick={() => onCarteira(u)}
                className="text-[10px] font-bold text-indigo-400 hover:text-indigo-300 flex items-center gap-1 bg-indigo-500/10 border border-indigo-500/20 px-2 py-1 rounded transition-colors">
                <Link2 className="w-3 h-3" /> Gerenciar
              </button>
            </div>
          </div>
          {condos.length === 0 ? (
            <p className="text-xs text-slate-600 italic">Nenhum condomínio vinculado</p>
          ) : (
            <>
              <div className="space-y-1">
                {condos.slice(0, expanded ? condos.length : 2).map(c => (
                  <p key={c.id} className="text-xs text-slate-400 flex items-center gap-1.5">
                    <Check className="w-3 h-3 text-emerald-500 shrink-0" /> {c.name}
                  </p>
                ))}
              </div>
              {!expanded && condos.length > 2 && (
                <p className="text-xs text-slate-500 mt-1 italic">+{condos.length - 2} mais...</p>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Página ────────────────────────────────────────────────────────────
export default function UsuariosPage() {
  const { user } = useAuth();
  const { addToast } = useToast();
  const [usuarios, setUsuarios] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modalCriar, setModalCriar] = useState(false);
  const [modalCarteira, setModalCarteira] = useState(null);
  const [modalResetSenha, setModalResetSenha] = useState(null);

  const carregar = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiFetch('/api/usuarios/lista-completa');
      setUsuarios(res.usuarios || []);
    } catch (err) {
      addToast(err.message, 'error');
    } finally {
      setLoading(false);
    }
  }, [addToast]);

  useEffect(() => { carregar(); }, [carregar]);

  function handleSync(u) {
    setModalResetSenha(u);
  }

  async function handleDelete(u) {
    if (!confirm(`Tem certeza que deseja EXCLUIR permanentemente o usuário ${u.full_name}?\nEsta ação não pode ser desfeita.`)) return;
    
    try {
      addToast('Excluindo usuário...', 'info');
      await apiFetch(`/api/usuarios/${u.id}`, { method: 'DELETE' });
      addToast('Usuário excluído com sucesso!', 'success');
      carregar();
    } catch (err) {
      addToast(err.message, 'error');
    }
  }

  if (user?.role !== 'master' && !loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center">
          <ShieldAlert className="w-12 h-12 text-red-400 mx-auto mb-3" />
          <p className="text-red-400 font-bold">Acesso restrito</p>
          <p className="text-slate-500 text-sm mt-1">Apenas administradores podem acessar esta área.</p>
        </div>
      </div>
    );
  }

  const gerentes = usuarios.filter(u => u.role === 'gerente');
  const outros = usuarios.filter(u => u.role !== 'gerente');

  return (
    <div className="animate-fade-in w-full h-full relative">
      <div className="flex justify-between items-end mb-8">
        <div>
          <h2 className="text-xl font-bold text-white mb-1">Usuários do Sistema</h2>
          <p className="text-sm text-slate-400">Gerencie contas, acessos e carteiras de condomínios.</p>
        </div>
        <button onClick={() => setModalCriar(true)}
          className="bg-indigo-600 text-white px-4 py-2 rounded-xl text-sm font-bold flex items-center gap-2 hover:bg-indigo-500 shadow-[0_0_15px_rgba(79,70,229,0.4)] transition-all">
          <PlusCircle className="w-4 h-4" /> Novo Usuário
        </button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-8 h-8 animate-spin text-indigo-500" />
        </div>
      ) : (
        <>
          {gerentes.length > 0 && (
            <div className="mb-8">
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-4 flex items-center gap-2">
                <Users className="w-3.5 h-3.5" /> Gerentes ({gerentes.length})
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                {gerentes.map(u => (
                  <UserCard key={u.id} u={u} currentUserId={user?.id} onSync={handleSync} onCarteira={setModalCarteira} onDeleted={handleDelete} />
                ))}
              </div>
            </div>
          )}

          {outros.length > 0 && (
            <div>
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-4 flex items-center gap-2">
                <ShieldAlert className="w-3.5 h-3.5" /> Outros Acessos ({outros.length})
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                {outros.map(u => (
                  <UserCard key={u.id} u={u} currentUserId={user?.id} onSync={handleSync} onCarteira={setModalCarteira} onDeleted={handleDelete} />
                ))}
              </div>
            </div>
          )}

          {usuarios.length === 0 && (
            <div className="text-center py-20 text-slate-500">
              <Users className="w-12 h-12 mx-auto mb-3 opacity-30" />
              <p>Nenhum usuário encontrado.</p>
            </div>
          )}
        </>
      )}

      {modalCriar && <ModalCriarUsuario onClose={() => setModalCriar(false)} onCreated={carregar} />}
      {modalCarteira && (
        <ModalCarteira usuario={modalCarteira} onClose={() => setModalCarteira(null)} onUpdated={carregar} />
      )}
      {modalResetSenha && (
        <ModalResetSenha usuario={modalResetSenha} onClose={() => setModalResetSenha(null)} />
      )}
    </div>
  );
}
