from pipeline.private_skills.drupal.scripts.remote_agent import DrupalRemoteAgent
import sys
import os

agent = DrupalRemoteAgent()

# Archivos locales
base_local = os.path.join(os.path.expanduser("~"), "Library/CloudStorage/OneDrive-UNED/Projectes/monorepo/apps/gnosi/pipeline/sandbox")
dummy_php = os.path.join(base_local, "TokenEntityHooksDummy.php")
services_yml = os.path.join(base_local, "n8n_helper.services.yml")

# Destinos
base_remote = "web/modules/custom/n8n_helper" # Ojo: remote_agent usa cd DRUPAL_PATH (/home/ismigar/webapps/web)
# El cd DRUPAL_PATH se hace en cada comando run, pero upload usa SCP directo.
# Necesitamos path absoluto para el upload final (mv).
# DRUPAL_PATH = /home/ismigar/webapps/web
remote_php = "/home/ismigar/webapps/web/modules/custom/n8n_helper/src/TokenEntityHooksDummy.php"
remote_yml = "/home/ismigar/webapps/web/modules/custom/n8n_helper/n8n_helper.services.yml"

print("🚀 Aplicando parche 'TokenEntityHooksDummy'...")

# 1. Subir a tmp y mover con cp (mv falla en sticky bit)
if not agent.upload_file(dummy_php, remote_php): # upload_file usa mv internamente? No, usa scp a ruta destino si puede. Ah no, upload_file de la CLASE usa scp a tmp y luego mv.
    # Debemos usar run_command con cp manual.
    pass

# Refactor: Subir a tmp manualmente via scp (usando agent interno si posible, o usando run_command move modificado)
# Mejor: Usaremos upload_file a /tmp/nombre_unico y luego cp
tmp_php = "/tmp/TokenEntityHooksDummy.php"
tmp_yml = "/tmp/n8n_helper.services.yml"

print("📤 Subiendo a tmp...")
if not agent.upload_file(dummy_php, tmp_php): sys.exit(1)
if not agent.upload_file(services_yml, tmp_yml): sys.exit(1)

print("🚚 Copiando a destino final...")
# Usamos cp en lugar de mv para evitar errores de permisos en /tmp
agent.run_command(f"cp {tmp_php} {remote_php}")
agent.run_command(f"chmod 644 {remote_php}")

agent.run_command(f"cp {tmp_yml} {remote_yml}")
agent.run_command(f"chmod 644 {remote_yml}")

# 2. Limpiar caché para registrar servicio
print("🧹 Limpiando caché (drush cr)...")
agent.run_command("drush cr", timeout=60)

print("✅ Parche aplicado. Verifica logs.")
