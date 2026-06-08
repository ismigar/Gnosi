import sys
import os
from pathlib import Path

from dotenv import load_dotenv

# remote_agent.py és al mateix directori que aquest script.
_here = Path(__file__).resolve().parent
sys.path.insert(0, str(_here))
# Arrel del repo: primer ancestre amb `.env_shared` (~/Projectes).
_repo = next((p for p in _here.parents if (p / ".env_shared").exists()), _here.parents[4])
# remote_agent busca `.env.shared`; el fitxer real és `.env_shared` → carrega'l aquí.
load_dotenv(_repo / ".env_shared")

from remote_agent import DrupalRemoteAgent

agent = DrupalRemoteAgent()

# Rutas locales: el mòdul VIU al repo (font de veritat del codi, no a OneDrive).
local_base = os.path.join(str(_repo), "temenos/web/modules/custom/n8n_helper")
routing_file = os.path.join(local_base, "n8n_helper.routing.yml")
controller_file = os.path.join(local_base, "src/Controller/NodeController.php")

# Rutas remotas. ATENCIÓ: el docroot REAL és {DRUPAL_PATH}/web (doble 'web/'); el mòdul
# que el PHP-FPM carrega és a web/web/modules/... Desplegar a web/modules/ (sense el
# segon 'web/') NO té cap efecte (sembla 'opcache encallat' però és el lloc equivocat).
_drupal_path = os.getenv("DRUPAL_PATH", "/home/ismigar/webapps/web")
remote_base = f"{_drupal_path}/web/modules/custom/n8n_helper"
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
