const fs = require('fs');
let envStr = '';
try { envStr = fs.readFileSync('.env.vercel', 'utf8'); } catch(e) {}
if (!envStr) {
  try { envStr = fs.readFileSync('.env.local', 'utf8'); } catch(e) {}
}
if (!envStr) {
  try { envStr = fs.readFileSync('.env', 'utf8'); } catch(e) {}
}

const env = {};
envStr.split('\n').forEach(l => {
  if (l.includes('=')) {
    const i = l.indexOf('=');
    env[l.substring(0, i)] = l.substring(i + 1).replace(/^['"]|['"]$/g, '');
  }
});

const url = env.NEXT_PUBLIC_SUPABASE_URL;
const key = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!url || !key) {
  console.log("No URL or KEY found.");
  process.exit(1);
}

fetch(url + '/rest/v1/emissoes_pacotes?select=id,status', {
  headers: {
    'apikey': key,
    'Authorization': 'Bearer ' + key
  }
}).then(r => r.json()).then(data => {
  console.log("PACOTES", data);
}).catch(console.error);

fetch(url + '/rest/v1/emissoes_ocorrencias?select=id,status', {
  headers: {
    'apikey': key,
    'Authorization': 'Bearer ' + key
  }
}).then(r => r.json()).then(data => {
  console.log("OCORRENCIAS", data);
}).catch(console.error);
