# CondoFlow — Sistema de Gestão de Condomínios

Sistema completo de gestão financeira para administradoras de condomínios, com fluxo de aprovação multi-nível, gestão de arrecadações e cobranças extras.

## 🚀 Stack

- **Framework:** [Next.js 16](https://nextjs.org/) (App Router)
- **UI:** React 19 + [Tailwind CSS 4](https://tailwindcss.com/)
- **Backend/Auth:** [Supabase](https://supabase.com/) (PostgreSQL + Auth + Storage)
- **Icons:** [Lucide React](https://lucide.dev/)

## 📋 Funcionalidades

- 🔐 Autenticação com controle de acesso por perfil (Master, Emissor, Gerente, Supervisor)
- 🏢 Gestão de condomínios com atribuição de gerentes
- 📊 Planilha de arrecadações financeiras com plano de contas hierárquico
- 💳 Cobranças extras por condomínio
- ✅ Fluxo de aprovação multi-nível (Gerente → Supervisor)
- 📁 Gestão de carteiras por gerente
- 🌙 Interface dark mode premium

## 🛠️ Setup Local

### Pré-requisitos

- Node.js 18+
- Conta no [Supabase](https://supabase.com/)

### Instalação

```bash
# Clonar o repositório
git clone https://github.com/SEU_USUARIO/condoflow.git
cd condoflow

# Instalar dependências
npm install

# Copiar variáveis de ambiente
cp .env.example .env.local
# Editar .env.local com suas credenciais Supabase

# Rodar em desenvolvimento
npm run dev
```

Acesse [http://localhost:3000](http://localhost:3000)

## 🌐 Deploy (Vercel)

1. Importe o repositório no [Vercel](https://vercel.com/)
2. Configure as variáveis de ambiente:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
3. Deploy automático a cada push na branch `main`

## 📁 Estrutura

```
src/
├── app/                    # Rotas (App Router)
│   ├── admin/usuarios/     # Gestão de usuários
│   ├── aprovacoes/         # Fila de aprovações
│   ├── carteiras/          # Carteiras de gerentes
│   ├── condominio/[id]/    # Páginas por condomínio
│   │   ├── arrecadacoes/   # Planilha financeira
│   │   └── cobrancas/      # Cobranças extras
│   ├── condominios/        # Lista de condomínios
│   ├── dashboard/          # Painel central
│   └── login/              # Autenticação
├── components/             # Componentes reutilizáveis
├── data/                   # Dados estáticos (plano de contas)
├── lib/                    # Auth provider, utilitários
└── utils/                  # Supabase client helpers
```

## 📄 Licença

Projeto privado — uso restrito.
