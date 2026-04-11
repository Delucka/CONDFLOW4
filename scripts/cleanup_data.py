import os
import sys
from dotenv import load_dotenv
from supabase import create_client

load_dotenv(override=True)
URL = os.getenv("SUPABASE_URL")
SERVICE_KEY = os.getenv("SUPABASE_SERVICE_KEY")

if not URL or not SERVICE_KEY:
    print("ERRO: Credenciais não encontradas.")
    sys.exit(1)

sb = create_client(URL, SERVICE_KEY)

print("--- LIMPANDO DADOS DE TESTE ---")

try:
    # Deletar todos os processos (isso deleta arrecadacoes, cobrancas_extras e aprovacoes por CASCADE)
    print("Limpando processos e dependências...")
    sb.table("processos").delete().neq("id", "00000000-0000-0000-0000-000000000000").execute()
    
    # Deletar todos os condomínios
    print("Limpando condomínios...")
    sb.table("condominios").delete().neq("id", "00000000-0000-0000-0000-000000000000").execute()

    print("\n✓ Banco de dados limpo com sucesso!")
    print("Agora você pode cadastrar seus condomínios reais na aba 'Condomínios'.")
except Exception as e:
    print(f"✕ Erro na limpeza: {e}")
