import os
from dotenv import load_dotenv
from supabase import create_client

load_dotenv()

SB_URL = os.environ.get("SUPABASE_URL")
SB_SERVICE_KEY = os.environ.get("SUPABASE_SERVICE_KEY")

if not SB_URL or not SB_SERVICE_KEY:
    print("Could not load credentials.")
    exit(1)

sb = create_client(SB_URL, SB_SERVICE_KEY)

# Fetch all users
response = sb.auth.admin.list_users()

# The response of list_users in supabase-py v2 is a UserList object containing .users (or just .users directly on auth)
try:
    users_list = response.users if hasattr(response, 'users') else response
except:
    users_list = []

keep_email = "denner.dlucka@gmail.com".lower()
deleted = 0
kept = 0

print(f"Found {len(users_list)} users in total.")

for u in users_list:
    email = getattr(u, 'email', '')
    uid = getattr(u, 'id', '')
    
    if type(u) is dict:
        email = u.get("email", "")
        uid = u.get("id", "")

    if email.lower() == keep_email:
        print(f"Keeping user: {email} ({uid})")
        kept += 1
        continue
        
    print(f"Deleting user: {email} ({uid})...")
    try:
        # Tenta deletar no profile tb, caso não tenha cascade
        try:
            sb.table("aprovacoes").delete().eq("approver_id", uid).execute()
        except Exception as e:
            pass
        try:            
            sb.table("profiles").delete().eq("id", uid).execute()
        except Exception as e:
            pass

        sb.auth.admin.delete_user(uid)
        deleted += 1
        print(" -> Deleted successfully.")
    except Exception as e:
        print(f" -> Error deleting {email}: {e}")

print(f"\nCleanup complete. Kept: {kept}, Deleted: {deleted}.")
