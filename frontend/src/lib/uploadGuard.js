// Validação de upload no cliente (1ª linha de defesa, UX).
// A trava FORTE é o limite do bucket no Supabase (file_size_limit + allowed_mime_types),
// que o servidor aplica mesmo com token roubado — ver migration de hardening do bucket.

export const MAX_UPLOAD_MB = 25;

const TIPOS_OK = [
  'application/pdf',
  'image/png', 'image/jpeg', 'image/jpg', 'image/gif', 'image/webp', 'image/heic',
];

/** Retorna { ok: true } ou { ok: false, erro }. Aceita opções p/ casos específicos. */
export function validarArquivo(file, { maxMB = MAX_UPLOAD_MB, tipos = TIPOS_OK } = {}) {
  if (!file) return { ok: false, erro: 'Nenhum arquivo selecionado.' };
  const mb = file.size / (1024 * 1024);
  if (mb > maxMB) {
    return { ok: false, erro: `Arquivo muito grande (${mb.toFixed(1)} MB). Máximo: ${maxMB} MB.` };
  }
  // Só barra se o navegador informou um tipo E ele não está na lista.
  if (tipos && file.type && !tipos.includes(file.type)) {
    return { ok: false, erro: `Tipo não permitido (${file.type}). Envie PDF ou imagem.` };
  }
  return { ok: true };
}
