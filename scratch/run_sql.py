import os
from supabase import create_client
from dotenv import load_dotenv

load_dotenv()

SB_URL = os.getenv("SUPABASE_URL")
SB_SERVICE = os.getenv("SUPABASE_SERVICE_KEY")

db = create_client(SB_URL, SB_SERVICE)

# No Supabase, para rodar SQL arbitrário via SDK, você geralmente usa RPC ou uma tabela especial.
# Mas aqui eu quero apenas atualizar o enum.
# Como não tenho uma função RPC "exec_sql", eu vou tentar rodar via query raw se suportado, 
# mas o SDK de Python não suporta query raw SQL direto por segurança.

# Vou tentar adicionar o valor do enum via POSTGREST chamando uma função que eu sei que existe (se houver).
# Se não, eu apenas ignoro essa parte por enquanto e foco na robustez da API Python.

print("Running SQL via RPC if possible...")
try:
    # Tentando criar a role se ela não existir via rpc se existir a função exec_sql
    # (Muitos projetos Supabase tem essa função para helpers)
    db.rpc("exec_sql", {"query": "ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'assistente';"}).execute()
    print("Success!")
except Exception as e:
    print(f"RPC exec_sql not found or failed: {e}")
