from pipeline.private_skills.drupal.scripts.remote_agent import DrupalRemoteAgent
import sys
import re

def verify_config():
    agent = DrupalRemoteAgent()
    print("🔍 Iniciando auditoría de configuración Drupal...")

    # 1. Obtener lista de módulos habilitados
    print("\n📦 Verificando módulos requeridos...")
    success, output = agent.run_command_output("drush pml --status=enabled --type=module --format=json")
    
    if not success:
        print("❌ Error obteniendo lista de módulos.")
        return False
    
    # El output puede contener texto antes/después del JSON si el ssh banner es ruidoso
    # Intentamos parsear o buscar strings directamente
    required_modules = {
        'jsonapi': 'JSON:API',
        'basic_auth': 'Basic Authentication',
        'serialization': 'Serialization',
        'mcp': 'MCP Server'
    }
    
    missing = []
    for mod, name in required_modules.items():
        if f'"{mod}"' in output or f"'{mod}'" in output: # Búsqueda simple en JSON string
             print(f"  ✅ {name} ({mod}): HABILITADO")
        else:
             print(f"  ❌ {name} ({mod}): NO HABILITADO")
             missing.append(mod)

    # 2. Verificar permisos/roles (opcional)
    # Comprobar si hay usuarios con permiso de acceso a JSON API o MCP
    # Esto es más complejo, lo dejamos para fase 2 si falla lo básico.

    print("\n----------------------------------------")
    if missing:
        print(f"⚠️ Faltan módulos críticos: {', '.join(missing)}")
        print("💡 Sugerencia: agent.run_command('drush en required_module -y')")
        return False
    else:
        print("✅ Todos los módulos críticos están habilitados.")
        return True

if __name__ == "__main__":
    # Ajuste de path para ejecución directa
    import os
    from pathlib import Path
    current = Path(__file__).resolve()
    root = current.parents[3]
    if str(root) not in sys.path: sys.path.append(str(root))
    
    verify_config()
