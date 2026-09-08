// Sanitiza o nome do arquivo para uso como CHAVE no Supabase Storage.
// O Storage rejeita acentos e vários caracteres especiais (ç, ã, #, espaços repetidos,
// parênteses em alguns casos…) — era isso que fazia o upload falhar "dependendo do nome".
// O nome original continua sendo guardado em arquivo_nome (para exibição).
export function safeStorageName(name) {
  const raw = (name || 'arquivo').toString().trim();
  const m = raw.match(/\.([a-zA-Z0-9]{1,8})$/);
  const ext = m ? '.' + m[1].toLowerCase() : '';
  const base = m ? raw.slice(0, -m[0].length) : raw;
  const clean = base
    .normalize('NFD').replace(/\p{Diacritic}/gu, '')     // remove acentos
    .replace(/[^a-zA-Z0-9._-]+/g, '_')                   // qualquer outro caractere -> _
    .replace(/_+/g, '_')
    .replace(/^[._-]+|[._-]+$/g, '')
    .slice(0, 120);
  return (clean || 'arquivo') + ext;
}

// ─────────────────────────────────────────────────────────────────────────────
// O que o bucket `emissoes` aceita de verdade — e como dizer isso em português.
//
// Medido contra o bucket de produção em 08/09/2026. As três recusas abaixo
// chegavam à tela como texto em inglês vindo do Storage, e o usuário só via que
// "não anexa":
//
//   nome com acento, ç, # ou \   400 InvalidKey          (resolvido por safeStorageName)
//   .docx .xlsx .msg .bin        415 invalid_mime_type
//   acima de 25 MB               413 Payload too large
//
// Estes valores são os do próprio bucket (`storage.buckets`): mudou lá, muda
// aqui. Conferir antes de subir evita a viagem inteira até o servidor para
// receber uma recusa que dava para prever no navegador.
export const LIMITE_UPLOAD = 25 * 1024 * 1024;           // file_size_limit = 26214400
export const TIPOS_ACEITOS = [
  'application/pdf',
  'image/png', 'image/jpeg', 'image/jpg', 'image/gif', 'image/webp', 'image/heic',
];
// Para o atributo `accept` do <input type="file">: filtra já na janela do
// sistema, que é onde o usuário ainda não perdeu tempo.
export const ACCEPT_UPLOAD = 'application/pdf,image/png,image/jpeg,image/gif,image/webp,image/heic';

// Devolve a mensagem do problema, ou null se o arquivo serve.
export function validarArquivo(file) {
  if (!file) return 'Nenhum arquivo selecionado.';
  const tipo = (file.type || '').toLowerCase();
  // Alguns sistemas mandam type vazio; nesse caso vale a extensão.
  const ext = (file.name || '').toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] || '';
  const extOk = ['pdf', 'png', 'jpg', 'jpeg', 'gif', 'webp', 'heic'].includes(ext);
  if (tipo ? !TIPOS_ACEITOS.includes(tipo) : !extOk) {
    return `Este tipo de arquivo não é aceito${ext ? ` (.${ext})` : ''}. Anexe PDF ou imagem — se o documento for Word ou Excel, salve como PDF antes.`;
  }
  if (file.size > LIMITE_UPLOAD) {
    return `O arquivo tem ${(file.size / 1048576).toFixed(1)} MB e o limite é 25 MB. Reduza a qualidade do escaneamento ou divida o documento.`;
  }
  return null;
}

// Traduz o que o Storage devolve, para o caso de algo escapar da conferência
// acima (bucket alterado, arquivo trocado no meio do caminho, rede).
export function mensagemDeUpload(err) {
  const m = String(err?.message || err || '');
  if (/InvalidKey|Invalid key/i.test(m)) return 'O nome do arquivo tem um caractere que o servidor não aceita. Renomeie o arquivo e tente de novo.';
  if (/mime type|InvalidMimeType|415/i.test(m)) return 'Este tipo de arquivo não é aceito. Anexe PDF ou imagem.';
  if (/EntityTooLarge|Payload too large|exceeded the maximum allowed size|413/i.test(m)) return 'O arquivo passou de 25 MB. Reduza a qualidade do escaneamento ou divida o documento.';
  if (/already exists|Duplicate/i.test(m)) return 'Já existe um arquivo com esse nome. Tente de novo.';
  if (/row-level security|violates/i.test(m)) return 'Você não tem permissão para enviar arquivo. Fale com o administrador.';
  if (/Failed to fetch|NetworkError|aborted|timeout/i.test(m)) return 'A conexão caiu durante o envio. Tente de novo.';
  return m || 'Não foi possível enviar o arquivo.';
}
