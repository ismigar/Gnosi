import paramiko
import json
import os

# Load configuration
ENV_PATH = "../../../../../.env_shared"

def load.env_shared(path):
    config = {}
    try:
        with open(path, 'r') as f:
            for line in f:
                if '=' in line and not line.strip().startswith('#'):
                    key, value = line.strip().split('=', 1)
                    config[key] = value
    except FileNotFoundError:
        print(f"Error: Could not find {path}")
    return config

config = load.env_shared(ENV_PATH)

HOST = config.get('SSH_HOST')
USER = config.get('SSH_USER')
PASSWORD = config.get('SSH_PASSWORD')
PORT = int(config.get('SSH_PORT', 22))
DRUPAL_ROOT_BASE = config.get('DRUPAL_PATH') # /home/ismigar/webapps/web

PHP_VERIFY_TEMPLATE = """<?php
use Drupal\Core\DrupalKernel;
use Symfony\Component\HttpFoundation\Request;

chdir('{DRUPAL_ROOT}');
$autoloader_path = '{AUTOLOADER_PATH}';
$autoloader = require_once $autoloader_path;

$request = Request::createFromGlobals();
$kernel = DrupalKernel::createFromRequest($request, $autoloader, 'prod');
$kernel->boot();

$storage = \Drupal::service('language.config_factory_override')->getStorage('en');
$views = ['blog', 'duplicat_de_blog', 'col_laboren', 'investigacions', 'relats'];

echo "--- START VERIFICATION ---\\n";
foreach ($views as $id) {
    $config_name = 'views.view.' . $id;
    $data = $storage->read($config_name);
    echo "VIEW: $id\\n";
    if ($data) {
        print_r($data);
    } else {
        echo "  [No overrides found]\\n";
    }
    echo "-------------------\\n";
}
echo "--- END VERIFICATION ---\\n";
"""

def main():
    print(f"Connecting to {USER}@{HOST}...")
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    
    try:
        client.connect(HOST, port=PORT, username=USER, password=PASSWORD)
        
        # 1. Locate autoload
        cmd_find = f"find {DRUPAL_ROOT_BASE} -name autoload.php -maxdepth 3"
        stdin, stdout, stderr = client.exec_command(cmd_find)
        paths = stdout.read().decode().strip().split('\n')
        valid_path = None
        for p in paths:
             if "vendor/autoload.php" in p: 
                 valid_path = p.strip(); break
        if not valid_path and paths: valid_path = paths[0].strip()
        if not valid_path: print("No autoload found"); return
        
        # 2. Upload and Run
        local_php = "verify_translations.php"
        remote_php = "/tmp/verify_translations.php"
        
        script_content = PHP_VERIFY_TEMPLATE.replace('{AUTOLOADER_PATH}', valid_path)
        script_content = script_content.replace('{DRUPAL_ROOT}', DRUPAL_ROOT_BASE)
        
        with open(local_php, "w") as f:
            f.write(script_content)
            
        sftp = client.open_sftp()
        sftp.put(local_php, remote_php)
        
        print("Executing remote verification script...")
        stdin, stdout, stderr = client.exec_command(f"php {remote_php}")
        
        out = stdout.read().decode().strip()
        # Clean output to show only relevant part
        start_marker = "--- START VERIFICATION ---"
        if start_marker in out:
             print(out[out.find(start_marker):])
        else:
             print("Raw Output:", out)
             
        # 3. Cleanup
        sftp.remove(remote_php)
        os.remove(local_php)

    except Exception as e:
        print(f"Error: {e}")
    finally:
        client.close()

if __name__ == "__main__":
    main()
