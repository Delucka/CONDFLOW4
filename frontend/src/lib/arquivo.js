import { apiPost } from '@/lib/api';

// Abre um arquivo do bucket via NOSSO backend (URL do nosso domínio, não do Supabase),
// e o backend confere a permissão por arquivo antes de liberar. Token curto (120s).
export async function abrirArquivoSeguro(path) {
  if (!path) return false;
  const r = await apiPost('/api/arquivo/link', { path });
  if (r?.url) {
    window.open(r.url, '_blank', 'noopener');
    return true;
  }
  return false;
}
