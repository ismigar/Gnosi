import os
import subprocess
import sys

def run_cmd(cmd, error_msg):
    print(f"🔄 Executant: {cmd}")
    result = subprocess.run(cmd, shell=True)
    if result.returncode != 0:
        print(f"❌ ERROR: {error_msg}")
        sys.exit(1)
    print("✅ OK\n")

def main():
    print("=============================================")
    print("🚀 Iniciant sincronització Multi-Remote (Reliable Focus)")
    print("=============================================\n")

    print("🔐 Configurant repositoris per utilitzar SSH...")
    run_cmd("git remote set-url origin git@github.com:ismigar/Projectes.git", "Incapaç de configurar origen SSH")
    run_cmd("git remote set-url gnosi git@github.com:ismigar/Gnosi.git", "Incapaç de configurar gnosi SSH")
    run_cmd("git remote set-url profile git@github.com:ismigar/ismigar.git", "Incapaç de configurar profile SSH")

    # 1. Push al repositori privat (Master Backup)
    print("📦 1. Pujant codi complet a Projectes (Privat)...")
    run_cmd("git push -f -u origin main", "No s'ha pogut pujar al repositori privat.")

    # 2. Push del producte a Gnosi (Públic)
    print("🌐 2. Sincronitzant Gnosi (Producte Públic)...")
    # Estratègia d'òrfena per garantir historial net a l'arrel de Gnosi
    run_cmd("git checkout --orphan sync-gnosi-tmp", "Error creant branca òrfena per a Gnosi")
    run_cmd("git rm -rf . --quiet", "Error netejant branca òrfena")
    run_cmd("git checkout main -- monorepo/", "Error agafant contingut monorepo")
    run_cmd("mv monorepo/* . 2>/dev/null || true", "Error movent contingut a l'arrel")
    run_cmd("mv monorepo/.* . 2>/dev/null || true", "Error movent fitxers ocults")
    run_cmd("rm -rf monorepo", "Error eliminant directori monorepo")
    run_cmd("git add .", "Error afegint fitxers per a Gnosi")
    run_cmd("git commit -m 'Sync cleanup (Product)'", "Error creant commit per a Gnosi")
    run_cmd("git push gnosi sync-gnosi-tmp:main --force", "Error pujant a Gnosi")
    run_cmd("git checkout main", "Error tornant a main")
    run_cmd("git branch -D sync-gnosi-tmp", "Error eliminat branca temporal")

    # 3. Push de Docs i Scripts a Ismigar (Públic)
    print("🛠️  3. Sincronitzant Perfil (ismigar Pública)...")
    run_cmd("git checkout --orphan sync-profile-tmp", "Error creant branca òrfena per a Profile")
    run_cmd("git rm -rf . --quiet", "Error netejant branca òrfena")
    run_cmd("git checkout main -- docs/ scripts/ .gitignore .env_shared README.md", "Error agafant bases per a Profile")
    run_cmd("git add .", "Error afegint fitxers per a Profile")
    run_cmd("git commit -m 'Sync cleanup (Profile)'", "Error creant commit per a Profile")
    run_cmd("git push profile sync-profile-tmp:main --force", "Error pujant a Profile")
    run_cmd("git checkout main", "Error tornant a main")
    run_cmd("git branch -D sync-profile-tmp", "Error eliminant branca temporal")

    print("\n🎉 Sincronització completada amb èxit!")

if __name__ == "__main__":
    main()
# Test sync Mon Mar 30 00:57:26 CEST 2026
