'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/utils/supabase/client';
import { useAuth } from '@/lib/auth';
import { useToast } from '@/components/Toast';
import { Users, ShieldAlert, PlusCircle, Trash2, Mail, Loader2, X, RefreshCw } from 'lucide-react';

export default function UsuariosPage() {
  const { user } = useAuth();
  const { addToast } = useToast();

  const [usuarios, setUsuarios] = useState([]);
  const [loading, setLoading] = useState(true);
  
  const [modalOpen, setModalOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [formData, setFormData] = useState({ email: '', password: '', full_name: '', role: 'gerente' });

  useEffect(() => {
    async function carregar() {
      try {
        setLoading(true);
        const supabase = createClient();
        const { data, error } = await supabase
          .from('profiles')
          .select('*')
          .order('full_name');
        
        if (error) throw error;
        setUsuarios(data || []);
      } catch (err) {
        addToast(err.message, 'error');
      } finally {
        setLoading(false);
      }
    }
    carregar();
  }, [addToast]);

  const ROLES = [
    { value: 'master', label: 'Master (Acesso Total)' },
    { value: 'gerente', label: 'Gerente (Apenas sua carteira)' },
    { value: 'supervisora', label: 'Supervisora (Aprovações)' },
    { value: 'supervisora_contabilidade', label: 'Sp. Contabilidade (Aprovações)' },
  ];

  async function handleCreate(e) {
    e.preventDefault();
    setSubmitting(true);
    try {
      const supabase = createClient();
      const { data: { session } } = await supabase.auth.getSession();
      
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/usuarios`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session?.access_token}`
        },
        body: JSON.stringify(formData)
      });
      
      const result = await res.json();
      if (!res.ok) throw new Error(result.detail || 'Erro ao criar usuário');
      
      addToast('Usuário criado com sucesso!', 'success');
      setModalOpen(false);
      setFormData({ email: '', password: '', full_name: '', role: 'gerente' });
      // Recarregar lista
      window.location.reload(); 
    } catch (err) {
      addToast(err.message, 'error');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleSync(u) {
    const password = prompt(`Digite uma nova senha para ${u.full_name}:`, 'Senha@1234');
    if (!password) return;

    try {
      addToast('Aguarde, sincronizando conta...', 'info');
      const supabase = createClient();
      const { data: { session } } = await supabase.auth.getSession();
      
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/usuarios/sync`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session?.access_token}`
        },
        body: JSON.stringify({
          email: u.email,
          password: password,
          full_name: u.full_name,
          role: u.role,
          profile_id: u.id
        })
      });
      
      const result = await res.json();
      if (!res.ok) throw new Error(result.detail || 'Erro ao sincronizar');
      
      addToast(`Conta sincronizada! Senha: ${password}`, 'success');
    } catch (err) {
      addToast(err.message, 'error');
    }
  }

  // Apenas role master deveria ver a página, o layout ou API recusa se não for
  if (user?.role !== 'master' && !loading) {
    return <div className="animate-fade-in w-full h-full relative"><div className="text-red-400">Você não tem permissão.</div></div>;
  }

  return (
    <div className="animate-fade-in w-full h-full relative">
      <div className="flex justify-between items-end mb-6">
        <div>
          <h2 className="text-xl font-bold text-white mb-2">Usuários do Sistema</h2>
          <p className="text-sm text-slate-400">Controle de acesso e níveis de permissão do CondoAdmin.</p>
        </div>
        
        <button onClick={() => setModalOpen(true)} className="bg-indigo-600 text-white px-4 py-2 rounded-xl text-sm font-bold flex items-center gap-2 hover:bg-indigo-500 shadow-[0_0_15px_rgba(79,70,229,0.4)] transition-all">
          <PlusCircle className="w-4 h-4" /> Novo Usuário
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {loading ? (
          <div className="col-span-full p-10 text-center"><Loader2 className="w-8 h-8 animate-spin mx-auto text-indigo-500" /></div>
        ) : usuarios.map(u => {
          const isMaster = u.role === 'master';
          
          return (
            <div key={u.id} className="bg-slate-900 border border-slate-800 p-5 rounded-xl shadow-xl flex items-start gap-4 hover:border-indigo-500/30 transition-colors group">
              <div className={`w-12 h-12 rounded-full flex items-center justify-center shrink-0 border 
                ${isMaster ? 'bg-orange-500/20 text-orange-400 border-orange-500/30' : 'bg-indigo-500/20 text-indigo-400 border-indigo-500/30'}`}>
                {isMaster ? <ShieldAlert className="w-6 h-6" /> : <Users className="w-6 h-6" />}
              </div>
              
              <div className="flex-1 min-w-0">
                <h3 className="font-bold text-slate-200 truncate">{u.full_name || 'Usuário'}</h3>
                <p className="text-xs text-slate-400 mt-1 flex items-center gap-1.5 truncate">
                  <Mail className="w-3 h-3 shrink-0" /> {u.email}
                </p>
                <div className="mt-3">
                  <span className={`text-[10px] font-bold uppercase px-2.5 py-1 rounded border
                    ${isMaster ? 'bg-orange-500/10 text-orange-400 border-orange-500/20' : 'bg-slate-800 text-slate-300 border-slate-700'}`}>
                    {u.role.replace('_', ' ')}
                  </span>
                </div>
              </div>
              
              <div className="flex flex-col gap-2">
                {user.id !== u.id && (
                  <button onClick={() => handleSync(u)} title="Sincronizar Acesso / Resetar Senha" className="text-slate-600 hover:text-cyan-400 opacity-0 group-hover:opacity-100 transition-opacity">
                    <RefreshCw className="w-4 h-4" />
                  </button>
                )}
                {user.id !== u.id && (
                  <button title="Desativar Conta" className="text-slate-600 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity">
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm animate-fade-in p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl w-full max-w-md">
            <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between">
              <h3 className="text-lg font-bold text-slate-200">Criar Nova Conta</h3>
              <button type="button" onClick={() => setModalOpen(false)} className="text-slate-500 hover:text-slate-300">
                <X className="w-5 h-5" />
              </button>
            </div>
            
            <form onSubmit={handleCreate} className="p-6 space-y-4">
              <div>
                <label className="text-[10px] text-slate-400 font-bold uppercase">Nome Completo</label>
                <input required value={formData.full_name} onChange={e => setFormData({...formData, full_name: e.target.value})}
                       className="w-full bg-slate-800 rounded-lg p-3 text-sm text-slate-200 mt-1 outline-none focus:ring-1 focus:ring-indigo-500" />
              </div>
              <div>
                <label className="text-[10px] text-slate-400 font-bold uppercase">E-mail</label>
                <input required type="email" value={formData.email} onChange={e => setFormData({...formData, email: e.target.value})}
                       className="w-full bg-slate-800 rounded-lg p-3 text-sm text-slate-200 mt-1 outline-none focus:ring-1 focus:ring-indigo-500" />
              </div>
              <div>
                <label className="text-[10px] text-slate-400 font-bold uppercase">Senha Temporária</label>
                <input required type="text" minLength={6} value={formData.password} onChange={e => setFormData({...formData, password: e.target.value})}
                       className="w-full bg-slate-800 rounded-lg p-3 text-sm text-slate-200 mt-1 outline-none focus:ring-1 focus:ring-indigo-500 text-indigo-400 font-mono" />
              </div>
              <div>
                <label className="text-[10px] text-slate-400 font-bold uppercase">Nível de Acesso (Role)</label>
                <select value={formData.role} onChange={e => setFormData({...formData, role: e.target.value})}
                        className="w-full bg-slate-800 rounded-lg p-3 text-sm text-slate-200 mt-1 outline-none focus:ring-1 focus:ring-indigo-500">
                  {ROLES.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
                </select>
              </div>
              
              <div className="pt-4 mt-2 border-t border-slate-800">
                <button disabled={submitting} type="submit" className="w-full py-3 bg-indigo-600 text-white font-bold rounded-lg hover:bg-indigo-500 transition-colors flex justify-center items-center">
                  {submitting ? <Loader2 className="w-5 h-5 animate-spin" /> : 'Criar Conta e Perfil'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
