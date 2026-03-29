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
DRUPAL_ROOT_BASE = config.get('DRUPAL_PATH')

PHP_LISTER_TEMPLATE = """<?php
use Drupal\Core\DrupalKernel;
use Symfony\Component\HttpFoundation\Request;

$autoloader_path = '{AUTOLOADER_PATH}';
if (!file_exists($autoloader_path)) {
    // try to find it relative to current dir
}
$autoloader = require_once $autoloader_path;
$request = Request::createFromGlobals();
$kernel = DrupalKernel::createFromRequest($request, $autoloader, 'prod');
$kernel->boot();

$config_factory = \Drupal::configFactory();
$names = $config_factory->listAll('views.view.');
$results = [];

foreach ($names as $name) {
    try {
        $config = $config_factory->get($name)->get();
        if ($config) {
             $results[] = [
                'id' => str_replace('views.view.', '', $name),
                'label' => $config['label'] ?? 'No Label',
                'description' => $config['description'] ?? '',
                'tag' => $config['tag'] ?? ''
            ];
        }
    } catch (\Exception $e) {
        // ignore
    }
}

echo json_encode($results, JSON_PRETTY_PRINT);
"""

def main():
    print(f"Connecting to {USER}@{HOST}...")
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    
    try:
        client.connect(HOST, port=PORT, username=USER, password=PASSWORD)
        
        # 1. Locate autoload (reuse previous logic)
        cmd_find = f"find {DRUPAL_ROOT_BASE} -name autoload.php -maxdepth 3"
        stdin, stdout, stderr = client.exec_command(cmd_find)
        paths = stdout.read().decode().strip().split('\n')
        # ... logic to pick best path ...
        valid_path = None
        for p in paths:
             if "vendor/autoload.php" in p: 
                 valid_path = p.strip(); break
        if not valid_path and paths: valid_path = paths[0].strip()
        
        if not valid_path: print("No autoload found"); return
        
        # 2. Upload and Run
        local_php = "list_all_views.php"
        remote_php = "/tmp/list_all_views.php"
        
        with open(local_php, "w") as f:
            f.write(PHP_LISTER_TEMPLATE.replace('{AUTOLOADER_PATH}', valid_path))
            
        sftp = client.open_sftp()
        sftp.put(local_php, remote_php)
        
        stdin, stdout, stderr = client.exec_command(f"php {remote_php}")
        out = stdout.read().decode().strip()
        
        # 3. Parse
        json_start = out.find('[')
        if json_start != -1:
            data = json.loads(out[json_start:])
            print(f"Total Views Found: {len(data)}\n")
            print(f"{'ID':<30} | {'Label':<30} | {'Tag'}")
            print("-" * 80)
            for v in data:
                print(f"{v['id']:<30} | {v['label']:<30} | {v['tag']}")
        else:
            print("Output parse failed.")
            print(out)
            
        sftp.remove(remote_php)
        os.remove(local_php)

    except Exception as e:
        print(f"Error: {e}")
    finally:
        client.close()

if __name__ == "__main__":
    main()
