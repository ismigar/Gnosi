from pipeline.private_skills.drupal.scripts.remote_agent import DrupalRemoteAgent
import sys

def update_drupal():
    agent = DrupalRemoteAgent()
    
    print("🚀 Iniciando actualización de Drupal Core...")
    
    # 1. Composer Require (forzar update a 10.6)
    print("📦 Ejecutando composer require (esto puede tardar mucho)...")
    success = agent.run_command(
        "composer require drupal/core-recommended:^10.6 drupal/core-composer-scaffold:^10.6 drupal/core-project-message:^10.6 --update-with-all-dependencies",
        timeout=600
    )
    
    if not success:
        print("❌ Error en composer update. Verifica logs o memoria.")
        return False
        
    # 2. Update Database
    print("🗄️ Ejecutando actualizaciones de base de datos (drush updb)...")
    success = agent.run_command("drush updb -y", timeout=120)
    
    if not success:
        print("❌ Error en drush updb.")
        return False
        
    # 3. Clear Cache
    print("🧹 Limpiando caché (drush cr)...")
    success = agent.run_command("drush cr", timeout=60)
    
    if not success:
        print("❌ Error limpiando caché.")
        return False
        
    print("✅ Actualización completada con éxito.")
    return True

if __name__ == "__main__":
    success = update_drupal()
    sys.exit(0 if success else 1)
