#!/usr/bin/env python3
"""
SSH Drush Runner - Ejecuta comandos drush en servidor remoto.

Requisitos en .env.shared:
    SSH_HOST=tu-servidor.com
    SSH_USER=usuario
    SSH_PASSWORD=contraseña (o SSH_KEY_PATH para clave privada)
    SSH_PORT=22 (opcional, default 22)
    DRUPAL_PATH=/ruta/al/drupal (donde está el docroot)

Uso:
    python drush_ssh.py cr           # Limpiar caché
    python drush_ssh.py status       # Estado de Drupal
    python drush_ssh.py updb         # Actualizar DB
"""

import os
import sys
import subprocess
from pathlib import Path
from dotenv import load_dotenv

def load_envs():
    """Carga variables de entorno desde .env.shared"""
    current_dir = Path(__file__).parent.absolute()
    # Buscar .env.shared subiendo en la jerarquía
    for _ in range(10):
        env_file = current_dir / ".env.shared"
        if env_file.exists():
            load_dotenv(env_file)
            return True
        current_dir = current_dir.parent
    
    # Fallback a ruta conocida
    env_shared = Path("/Users/ismaelgarciafernandez/Library/CloudStorage/OneDrive-UNED/Projectes/.env.shared")
    if env_shared.exists():
        load_dotenv(env_shared)
        return True
    return False

def run_drush(command: str, verbose: bool = True):
    """
    Ejecuta un comando drush en el servidor remoto via SSH.
    
    Args:
        command: Comando drush sin el prefijo 'drush' (ej: 'cr', 'status')
        verbose: Mostrar output en consola
    
    Returns:
        tuple: (success: bool, output: str)
    """
    load_envs()
    
    host = os.getenv("SSH_HOST")
    user = os.getenv("SSH_USER")
    password = os.getenv("SSH_PASSWORD")
    key_path = os.getenv("SSH_KEY_PATH")
    port = os.getenv("SSH_PORT", "22")
    drupal_path = os.getenv("DRUPAL_PATH", "/var/www/html")
    
    if not host or not user:
        print("ERROR: Faltan SSH_HOST y/o SSH_USER en .env.shared")
        return False, "Missing credentials"
    
    # Construir comando SSH
    full_command = f"cd {drupal_path} && drush {command}"
    
    if key_path and Path(key_path).exists():
        # Usar clave SSH
        ssh_cmd = [
            "ssh", "-i", key_path,
            "-o", "StrictHostKeyChecking=no",
            "-p", port,
            f"{user}@{host}",
            full_command
        ]
    elif password:
        # Usar sshpass para contraseña (menos seguro pero funcional)
        ssh_cmd = [
            "sshpass", "-p", password,
            "ssh",
            "-o", "StrictHostKeyChecking=no",
            "-p", port,
            f"{user}@{host}",
            full_command
        ]
    else:
        print("ERROR: Necesitas SSH_PASSWORD o SSH_KEY_PATH en .env.shared")
        return False, "No auth method"
    
    if verbose:
        print(f"🔗 Conectando a {host}...")
        print(f"📂 Directorio: {drupal_path}")
        print(f"🔧 Comando: drush {command}")
        print("-" * 40)
    
    try:
        result = subprocess.run(
            ssh_cmd,
            capture_output=True,
            text=True,
            timeout=120
        )
        
        output = result.stdout + result.stderr
        success = result.returncode == 0
        
        if verbose:
            if success:
                print("✅ Éxito:")
            else:
                print("❌ Error:")
            print(output)
        
        return success, output
        
    except subprocess.TimeoutExpired:
        msg = "Timeout: El comando tardó más de 120 segundos"
        if verbose:
            print(f"⏰ {msg}")
        return False, msg
    except FileNotFoundError as e:
        if "sshpass" in str(e):
            msg = "sshpass no instalado. Instala con: brew install hudochenkov/sshpass/sshpass"
        else:
            msg = f"Comando no encontrado: {e}"
        if verbose:
            print(f"❌ {msg}")
        return False, msg
    except Exception as e:
        if verbose:
            print(f"❌ Error: {e}")
        return False, str(e)

def clear_cache():
    """Limpia caché de Drupal"""
    return run_drush("cr")

def status():
    """Muestra estado de Drupal"""
    return run_drush("status")

def update_db():
    """Ejecuta actualizaciones de base de datos"""
    return run_drush("updb -y")

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Uso: python drush_ssh.py <comando>")
        print("Ejemplos:")
        print("  python drush_ssh.py cr       # Limpiar caché")
        print("  python drush_ssh.py status   # Estado")
        print("  python drush_ssh.py updb     # Update DB")
        sys.exit(1)
    
    command = " ".join(sys.argv[1:])
    success, _ = run_drush(command)
    sys.exit(0 if success else 1)
