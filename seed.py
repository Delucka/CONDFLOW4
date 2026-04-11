"""Seed script — insere dados de teste no Supabase.
Requer SUPABASE_SERVICE_KEY no .env para criar usuários.
Uso: python seed.py
"""
import os, sys
from dotenv import load_dotenv
from supabase import create_client

load_dotenv()

URL = os.getenv("SUPABASE_URL")
SERVICE_KEY = os.getenv("SUPABASE_SERVICE_KEY", "")
ANON_KEY = os.getenv("SUPABASE_KEY", "")

if not SERVICE_KEY:
    print("⚠  SUPABASE_SERVICE_KEY não encontrada no .env")
    print("   Sem ela, não é possível criar usuários automaticamente.")
    print("   Crie pelo Dashboard do Supabase > Authentication > Users")
    print("   Ou adicione a Service Role Key no .env")
    print("   (Settings > API > Service Role Key)")
    sys.exit(1)

sb = create_client(URL, SERVICE_KEY)

# ─── 1. Criar usuário MASTER ──────────────────────────────────────────
MASTER_EMAIL = "admin@condoadmin.com"
MASTER_PASS = "Admin@2026"

print("Criando usuário master...")
try:
    master = sb.auth.admin.create_user({
        "email": MASTER_EMAIL, "password": MASTER_PASS, "email_confirm": True
    })
    master_id = str(master.user.id)
    sb.table("profiles").upsert({
        "id": master_id, "email": MASTER_EMAIL,
        "full_name": "Administrador Master", "role": "master"
    }).execute()
    print(f"  ✓ Master criado: {MASTER_EMAIL} / {MASTER_PASS}")
except Exception as e:
    if "already" in str(e).lower():
        print(f"  – Master já existe: {MASTER_EMAIL}")
        res = sb.table("profiles").select("id").eq("email", MASTER_EMAIL).execute()
        master_id = res.data[0]["id"] if res.data else None
    else:
        print(f"  ✕ Erro: {e}")
        master_id = None

# ─── 2. Criar 3 Gerentes de teste ─────────────────────────────────────
GERENTES = [
    ("Carlos Silva", "carlos@condoadmin.com", "Gerente@2026"),
    ("Mariana Souza", "mariana@condoadmin.com", "Gerente@2026"),
    ("Ricardo Lopes", "ricardo@condoadmin.com", "Gerente@2026"),
]

gerente_ids = []
for nome, email, senha in GERENTES:
    print(f"Criando gerente {nome}...")
    try:
        user = sb.auth.admin.create_user({
            "email": email, "password": senha, "email_confirm": True
        })
        uid = str(user.user.id)
        sb.table("profiles").upsert({
            "id": uid, "email": email, "full_name": nome, "role": "gerente"
        }).execute()
        ger = sb.table("gerentes").upsert({
            "profile_id": uid, "limit_condos": 35
        }, on_conflict="profile_id").execute()
        gerente_ids.append(ger.data[0]["id"] if ger.data else uid)
        print(f"  ✓ {nome}: {email} / {senha}")
    except Exception as e:
        if "already" in str(e).lower():
            print(f"  – Já existe: {email}")
            res = sb.table("gerentes").select("id, profiles!inner(email)").eq("profiles.email", email).execute()
            if res.data:
                gerente_ids.append(res.data[0]["id"])
        else:
            print(f"  ✕ Erro: {e}")

# ─── 3. Criar Condomínios de teste ────────────────────────────────────
CONDOS = [
    "Residencial Aquarius", "Edifício Palladium", "Condado de York",
    "Vila Mariana Plaza", "Mirante da Enseada", "Parque das Flores",
    "Torre Central", "Portal do Sol", "Jardim Botânico",
    "Edifício Copacabana", "Residencial Boa Vista", "Spazio Vita",
]

print(f"\nCriando {len(CONDOS)} condomínios de teste...")
for i, nome in enumerate(CONDOS):
    ger_id = gerente_ids[i % len(gerente_ids)] if gerente_ids else None
    due = (i % 28) + 1
    try:
        sb.table("condominios").insert({
            "name": nome, "gerente_id": ger_id, "due_day": due
        }).execute()
        print(f"  ✓ {nome}")
    except Exception as e:
        if "duplicate" in str(e).lower() or "unique" in str(e).lower():
            print(f"  – Já existe: {nome}")
        else:
            print(f"  ✕ {nome}: {e}")

print("\n═══════════════════════════════════════")
print("Seed concluído!")
print(f"Master login: {MASTER_EMAIL} / {MASTER_PASS}")
print("Gerentes login: carlos/mariana/ricardo@condoadmin.com / Gerente@2026")
print("═══════════════════════════════════════")
