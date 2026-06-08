#!/usr/bin/env python3
"""
Drupal Remote Agent - Automatización de acceso SSH con suweb interactivo.
Requiere: pip install pexpect python-dotenv

Este script permite:
1. Conectarse via SSH automàticamente.
2. Gestionar el comando interactivo 'suweb' si es necesario.
3. Ejecutar comandos DRUSH.
4. Subir archivos al servidor.

Uso:
    python remote_agent.py drush cr
    python remote_agent.py upload local_file remote_path
"""

import sys
import os
import pexpect
import time
from pathlib import Path
from dotenv import load_dotenv

def load_envs():
    """Carga variables de entorno desde .env.shared"""
    current = Path(__file__).resolve()
    # Buscar .env.shared recursivamente hacia arriba
    for _ in range(8):
        current = current.parent
        env_file = current / ".env.shared"
        if env_file.exists():
            load_dotenv(env_file)
            return True
    return False

class DrupalRemoteAgent:
    def __init__(self):
        load_envs()
        self.host = os.getenv("SSH_HOST")
        self.user = os.getenv("SSH_USER")
        self.password = os.getenv("SSH_PASSWORD")
        self.suweb_pass = os.getenv("SSH_SUWEB_PASSWORD") # Contraseña para suweb
        self.port = os.getenv("SSH_PORT", "22")
        self.drupal_root = os.getenv("DRUPAL_PATH", "/var/www/html")
        
        if not self.host or not self.user:
            raise ValueError("Faltan credenciales SSH_HOST o SSH_USER en .env.shared")

    def _execute_command(self, cmd, timeout):
        """Método interno para ejecutar comando y capturar output raw."""
        print(f"🤖 AGENT: Conectando a {self.user}@{self.host}...")
        
        # Comando SSH básico
        ssh_cmd = f"ssh -p {self.port} {self.user}@{self.host}"
        
        try:
            child = pexpect.spawn(ssh_cmd, encoding='utf-8', timeout=timeout)
            # LOGGING: Ver qué responde el servidor
            # child.logfile_read = sys.stdout 
            
            # 1. Gestionar Login SSH
            i = child.expect(['password:', 'yes/no', pexpect.EOF, pexpect.TIMEOUT, '\$ ', '# ', '> ', '% ', 'ismigar@'])
            
            if i == 0: # Pide password
                child.sendline(self.password)
            elif i == 1: # Confirmar host key
                child.sendline('yes')
                child.expect('password:')
                child.sendline(self.password)
            elif i == 2: # EOF
                print("❌ Error: Conexión cerrada (EOF).")
                return False, child.before
            elif i == 3: # Timeout
                print("❌ Error: Timeout inicial.")
                return False, child.before
            elif i >= 4: # Ya estamos dentro
                pass # Login automático

            # Esperar prompt post-login explícitamente si enviamos password
            if i <= 1:
                idx = child.expect(['\$', '#', '>', '%', 'ismigar@', pexpect.TIMEOUT])
                
            # 2. Gestionar suweb
            if self.suweb_pass:
                # Limpiar cualquier prompt residual antes de enviar comando
                try:
                    child.expect(['\$', '#', '>', '%', 'ismigar@'], timeout=1)
                except:
                    pass

                child.sendline('suweb')
                j = child.expect(['(?i)password:', '(?i)contrase', '(?i)contrasenya', '(?i)(authentication failure|fallo de auten|fallida)', pexpect.TIMEOUT], timeout=10)
                
                if j < 3: 
                     child.sendline(self.suweb_pass)
                     child.expect(['\$', '#', '>', '%', 'root@'], timeout=10)
                elif j == 3:
                     print("❌ Error: Fallo de autenticación en suweb")
                     return False, "Auth failed"
                else:
                     # Timeout esperando password, verificamos si ya somos root/user destino
                     child.sendline('echo "CHECK_ROOT"')
                     child.expect('CHECK_ROOT')
                     child.expect(['\$', '#', '>', '%'])

            # 3. Navegar
            child.sendline(f"cd {self.drupal_root}")
            child.expect(['\$', '#', '>', '%'])
            
            # 4. Ejecutar comando
            print(f"🔧 AGENT: Ejecutando '{cmd}'")
            child.sendline(cmd)
            child.expect(['\$', '#', '>', '%'])
            
            output = child.before.strip()
            # Limpieza básica
            lines = output.splitlines()
            if lines and cmd in lines[0]: lines.pop(0)
            
            clean_output = "\n".join(lines)
            child.sendline('exit')
            child.close()
            return True, clean_output
            
        except Exception as e:
            print(f"❌ Exception: {e}")
            return False, str(e)

    def run_command(self, cmd, timeout=30):
        """Ejecuta un comando (Legacy interface: retorna bool). Imprime output."""
        success, output = self._execute_command(cmd, timeout)
        if success:
            print("✅ Output:")
            print(output)
        return success

    def run_command_output(self, cmd, timeout=30):
        """Ejecuta un comando y retorna (bool, output)."""
        return self._execute_command(cmd, timeout)

    def upload_file(self, local_path, remote_path):
        """Sube un archivo via SCP y luego lo mueve al destino final con suweb si es necesario"""
        if not os.path.exists(local_path):
            print(f"❌ Error: Archivo local no existe: {local_path}")
            return False
            
        filename = os.path.basename(local_path)
        temp_remote_path = f"/tmp/{filename}"
        
        print(f"📤 AGENT: Subiendo {filename} a /tmp/...")
        
        # SCP usa sshpass si está disponible, o pexpect scp
        # Para simplicidad con pexpect usaremos scp interactivo
        scp_cmd = f"scp -P {self.port} {local_path} {self.user}@{self.host}:{temp_remote_path}"
        
        try:
            child = pexpect.spawn(scp_cmd, encoding='utf-8')
            i = child.expect(['password:', 'yes/no', pexpect.EOF])
            
            if i == 0:
                child.sendline(self.password)
            elif i == 1:
                child.sendline('yes')
                child.expect('password:')
                child.sendline(self.password)
                
            child.expect(pexpect.EOF)
            print("✅ Subida a /tmp completada.")
            
            # Mover archivo al destino final usando la sesión interactiva (por permisos)
            move_cmd = f"mv {temp_remote_path} {remote_path}"
            if self.suweb_pass:
                 # Si hay suweb, asumimos que necesitamos permisos para escribir en destino
                 print(f"🚚 AGENT: Moviendo archivo a destino final con permisos...")
                 return self.run_command(move_cmd)
            else:
                 # Si no hay suweb, intentamos mover directamente via ssh command simple (o interactive si queremos reutilizar)
                 return self.run_command(move_cmd)

        except Exception as e:
            print(f"❌ Error subiendo archivo: {e}")
            return False

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Uso:")
        print("  python remote_agent.py drush <cmd>")
        print("  python remote_agent.py upload <local_file> <remote_path>")
        sys.exit(1)
        
    action = sys.argv[1]
    agent = DrupalRemoteAgent()
    
    if action == "drush":
        cmd = f"drush {' '.join(sys.argv[2:])}"
        agent.run_command(cmd)
    elif action == "upload":
        if len(sys.argv) < 4:
            print("Faltan argumentos para upload")
            sys.exit(1)
        local = sys.argv[2]
        remote = sys.argv[3]
        agent.upload_file(local, remote)
    elif action == "exec":
        cmd = " ".join(sys.argv[2:])
        agent.run_command(cmd)
    else:
        print("Acción desconocida")
