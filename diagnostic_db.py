import os
from supabase import create_client
from dotenv import load_dotenv

load_dotenv()
url = os.environ.get("SUPABASE_URL")
key = os.environ.get("SUPABASE_SERVICE_KEY") or os.environ.get("SUPABASE_KEY")
sb = create_client(url, key)

def check_table(name):
    print(f"\n--- Checking table: {name} ---")
    try:
        res = sb.table(name).select("*").limit(1).execute()
        if res.data:
            print(f"Columns: {list(res.data[0].keys())}")
            print(f"Sample row: {res.data[0]}")
        else:
            print("Table is empty. Checking via RPC or guessing...")
            # Try to force an error to see columns in some drivers, 
            # but here we just say empty.
    except Exception as e:
        print(f"Error checking {name}: {e}")

check_table("arrecadacoes")
check_table("cobrancas_extras")
check_table("rateios_config")
check_table("rateios_valores")
check_table("condominios")
