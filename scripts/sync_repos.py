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
    print("🚀 Iniciant sincronització Multi-Remote (Clean Slate)")
    print("=============================================\n")

    print("🔐 Configurant repositoris per utilitzar SSH (evita els Timeouts 408 d'HTTPS)...")
    run_cmd("git remote set-url origin git@github.com:ismigar/Projectes.git", "Incapaç de configurar origen SSH")
    run_cmd("git remote set-url gnosi git@github.com:ismigar/Gnosi.git", "Incapaç de configurar gnosi SSH")
    run_cmd("git remote set-url profile git@github.com:ismigar/ismigar.git", "Incapaç de configurar profile SSH")

    # 1. Push al repositori privat (Master Backup)
    print("📦 1. Pujant codi complet a Projectes (Privat)...")
    run_cmd("git push -f -u origin main", "No s'ha pogut pujar al repositori privat.")

    # 2. Push del producte a Gnosi (Públic)
    print("🌐 2. Extraient i pujant Gnosi (Producte Públic)...")
    # Agafem només la carpeta monorepo i la pujem al remote gnosi
    run_cmd("git push gnosi $(git subtree split --prefix monorepo main):main --force", "Fallada al sincronitzar Gnosi. (Revisa si GitHub Secret Scanning està bloquejant a causa de claus temporals)")

    # 3. Push de Skills a l'aparador (Públic)
    print("🛠️  3. Extraient i pujant Skills (Perfil Públic)...")
    run_cmd("git push profile $(git subtree split --prefix monorepo/apps/gnosi/pipeline/skills main):main --force", "Fallada al sincronitzar els skills.")

    print("🎉 Sincronització completada amb èxit!")

if __name__ == "__main__":
    main()
