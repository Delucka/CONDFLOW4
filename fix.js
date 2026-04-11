const fs = require('fs');
const files = [
  'frontend/src/app/dashboard/page.js',
  'frontend/src/app/carteiras/page.js',
  'frontend/src/app/aprovacoes/page.js',
  'frontend/src/app/condominio/[id]/arrecadacoes/page.js',
  'frontend/src/app/condominio/[id]/cobrancas/page.js',
  'frontend/src/app/admin/usuarios/page.js',
  'frontend/src/app/condominios/page.js'
];
for (const f of files) {
  if (fs.existsSync(f)) {
    let c = fs.readFileSync(f, 'utf8');
    c = c.replace(/import AppShell from[^\n]+\n/g, '');
    c = c.replace(/<AppShell[^>]*>/g, '<div className="animate-fade-in w-full h-full relative">');
    c = c.replace(/<\/AppShell>/g, '</div>');
    fs.writeFileSync(f, c);
    console.log('Updated', f);
  }
}
