import os
import subprocess
import sys

def run_cmd(cmd, error_msg, allow_fail=False):
    print(f"🔄 Executant: {cmd}")
    result = subprocess.run(cmd, shell=True, capture_output=True, text=True)
    if result.stdout:
        print(result.stdout)
    if result.returncode != 0:
        if result.stderr:
            print(f"STDERR: {result.stderr}")
        if allow_fail:
            print(f"⚠️  AVÍS (no crític): {error_msg}")
            return False
        print(f"❌ ERROR: {error_msg}")
        sys.exit(1)
    print("✅ OK\n")
    return True

def ensure_remote(name, url):
    """Afegeix el remote si no existeix, o actualitza la URL si ja existeix."""
    check = subprocess.run(f"git remote get-url {name}", shell=True, capture_output=True)
    if check.returncode != 0:
        run_cmd(f"git remote add {name} {url}", f"No s'ha pogut afegir el remote {name}")
    else:
        run_cmd(f"git remote set-url {name} {url}", f"No s'ha pogut actualitzar el remote {name}")

def get_remote_url(repo_path):
    """Retorna la URL del remote basada en l'entorn (PAT per CI, SSH per local)."""
    pat = os.environ.get("SYNC_PAT", "")
    if pat:
        return f"https://x-access-token:{pat}@github.com/{repo_path}.git"
    else:
        return f"git@github.com:{repo_path}.git"

def main():
    print("=============================================")
    print("🚀 Sincronització Projectes → Gnosi")
    print("=============================================\n")

    is_ci = os.environ.get("GITHUB_ACTIONS") == "true"
    if is_ci:
        print("🤖 Executant a GitHub Actions (HTTPS + PAT)")
    else:
        print("💻 Executant en local (SSH)")

    print("\n🔐 Configurant remote...")
    ensure_remote("gnosi", get_remote_url("ismigar/Gnosi"))

    # Sincronitzar monorepo/ → Gnosi (arrel)
    print("🌐 Sincronitzant Gnosi (Producte Públic)...")
    
    # PROTECCIÓ: Mai fer neteja massiva si no estem en un entorn CI aïllat!
    if not is_ci:
        print("⚠️  AVÍS: Estàs executant aquest script en local.")
        print("🛑 Per seguretat, no es farà neteja massiva (git rm -rf .) per evitar pèrdua de fitxers no registrats.")
        print("💡 Aquest script només és apte per a execució total en entorn CI d'un sol ús.")
        sys.exit(0)

    run_cmd("git checkout --orphan sync-gnosi-tmp", "Error creant branca òrfena")
    run_cmd("git rm -rf . --quiet", "Error netejant branca òrfena")
    run_cmd("git checkout main -- monorepo/", "Error agafant contingut monorepo")
    run_cmd("find monorepo -maxdepth 1 -mindepth 1 -not -name '.*' -exec mv {} . \\;",
            "Error movent contingut a l'arrel", allow_fail=True)
    run_cmd("find monorepo -maxdepth 1 -name '.*' -not -name '.' -not -name '..' -exec mv {} . \\;",
            "Error movent fitxers ocults", allow_fail=True)
    run_cmd("rm -rf monorepo", "Error eliminant directori monorepo")
    run_cmd("git add .", "Error afegint fitxers")
    run_cmd("git commit -m 'Sync from Projectes'", "Error creant commit")
    run_cmd("git push gnosi sync-gnosi-tmp:main --force", "Error pujant a Gnosi")
    run_cmd("git checkout main", "Error tornant a main")
    run_cmd("git branch -D sync-gnosi-tmp", "Error eliminant branca temporal")

    print("\n🎉 Sincronització completada amb èxit!")

if __name__ == "__main__":
    main()
