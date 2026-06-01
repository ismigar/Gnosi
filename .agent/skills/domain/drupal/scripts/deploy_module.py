import sys
import os
from pathlib import Path

# Añadir root del proyecto al path para importar pipeline
current_file = Path(__file__).resolve()
project_root = current_file.parents[3] # monorepo/apps/gnosi
if str(project_root) not in sys.path:
    sys.path.append(str(project_root))

from pipeline.private_skills.drupal.scripts.remote_agent import DrupalRemoteAgent

agent = DrupalRemoteAgent()

# Rutas locales
local_base = os.path.join(os.path.expanduser("~"), "Library/CloudStorage/OneDrive-UNED/Projectes/temenos/web/modules/custom/n8n_helper")
routing_file = os.path.join(local_base, "n8n_helper.routing.yml")
controller_file = os.path.join(local_base, "src/Controller/NodeController.php")

# Rutas remotas (basado en pwd anterior: /home/ismigar/webapps/web)
remote_base = "/home/ismigar/webapps/web/modules/custom/n8n_helper"
remote_routing = f"{remote_base}/n8n_helper.routing.yml"
remote_controller_dir = f"{remote_base}/src/Controller"
remote_controller = f"{remote_controller_dir}/NodeController.php"

print("🚀 Iniciando despliegue a Drupal...")

# 1. Verificar directorios remotos
print("📂 Verificando directorios...")
agent.run_command(f"mkdir -p {remote_controller_dir}")

# 2. Subir Routing
print(f"📤 Subiendo Routing: {routing_file}")
success = agent.upload_file(routing_file, remote_routing)
if not success: 
    print("❌ Fallo subiendo routing")
    exit(1)

# 3. Subir Controller
print(f"📤 Subiendo Controller: {controller_file}")
success = agent.upload_file(controller_file, remote_controller)
if not success: 
    print("❌ Fallo subiendo controller")
    exit(1)

# 4. Limpiar Caché
print("🧹 Limpiando caché (drush cr)...")
agent.run_command("drush cr")

print("✅ Despliegue completado con éxito!")
