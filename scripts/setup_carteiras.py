0 import os
import sys
from dotenv import load_dotenv
from supabase import create_client

load_dotenv(override=True)
URL = os.getenv("SUPABASE_URL")
SERVICE_KEY = os.getenv("SUPABASE_SERVICE_KEY")

if not URL or not SERVICE_KEY:
    print("ERRO: SUPABASE_URL ou SUPABASE_SERVICE_KEY não encontradas no .env")
    sys.exit(1)

sb = create_client(URL, SERVICE_KEY)

CARTEIRAS = [
    {"email": "suellen@condoadmin.com", "name": "Suellen (Assistente: Leonardo)"},
    {"email": "eduardo@condoadmin.com", "name": "Eduardo (Assistente: Fabiana)"},
    {"email": "rodrigo@condoadmin.com", "name": "Rodrigo (Assistente: Danilo)"},
    {"email": "natalia@condoadmin.com", "name": "Natalia (Assistente: Gabriel)"},
    {"email": "patricia@condoadmin.com", "name": "Patricia (Assistente: Vitor)"},
    {"email": "maurojr@condoadmin.com", "name": "Mauro Jr (Assistente: Iago)"},
    {"email": "marlei@condoadmin.com", "name": "Marlei (Assistente: Silvia)"},
    {"email": "aline@condoadmin.com", "name": "Aline (Assistente: Jenifer)"},
    {"email": "diogo@condoadmin.com", "name": "Diogo (Assistente: Fernando)"}
]
DEFAULT_PASS = "Gerente@2026"

print("--- RECONFIGURANDO CARTEIRAS ---")

print("1. Removendo usuários de teste...")
emails_para_remover = ["carlos@condoadmin.com", "mariana@condoadmin.com", "ricardo@condoadmin.com"]
for email in emails_para_remover:
    try:
        # Tenta deletar o perfil local
        perf = sb.table("profiles").select("id").eq("email", email).execute()
        if perf.data:
            sb.auth.admin.delete_user(perf.data[0]["id"])
            print(f"  - Excluído: {email}")
    except Exception as e:
        pass # Ignora se não existir

print("\n2. Adicionando Carteiras Oficiais...")
for c in CARTEIRAS:
    try:
        print(f"Criando {c['name']}...")
        user_res = sb.auth.admin.create_user({
            "email": c["email"],
            "password": DEFAULT_PASS,
            "email_confirm": True
        })
        uid = user_res.user.id
        
        # Insere o profile
        sb.table("profiles").upsert({
            "id": uid, "email": c["email"],
            "full_name": c["name"], "role": "gerente"
        }).execute()
        
        # Verifica se já está na tabela de gerentes, senão adiciona
        exist = sb.table("gerentes").select("id").eq("profile_id", uid).execute()
        if not exist.data:
            sb.table("gerentes").insert({"profile_id": uid, "limit_condos": 50}).execute()
        
        print(f"  ✓ Registrado: {c['email']} / {DEFAULT_PASS}")
    except Exception as e:
        if "User already registered" in str(e):
            print(f"  ! Já existe: {c['name']} ({c['email']})")
        else:
            print(f"  ✕ Erro ao criar {c['name']}: {e}")

print("\nConcluído!")
