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
DRUPAL_PATH = config.get('DRUPAL_PATH') # /home/ismigar/webapps/web
# Correct root is distinct from project root for composer projects
DRUPAL_ROOT = f"{DRUPAL_PATH}/web"

PHP_CLEAR_CACHE_TEMPLATE = """<?php
use Drupal\Core\DrupalKernel;
use Symfony\Component\HttpFoundation\Request;

// Crucial fix: chdir to the web root where index.php lives
chdir('{DRUPAL_ROOT}');

$autoloader_path = '{AUTOLOADER_PATH}';
$autoloader = require_once $autoloader_path;

$request = Request::createFromGlobals();
$kernel = DrupalKernel::createFromRequest($request, $autoloader, 'prod');
$kernel->boot();

echo "Invalidating specific cache tags...\\n";

$cache_tags = [
    'config:views', 
    'config:system.site', 
    'config:language.entity.en', 
    'rendered', 
    'http_response'
];
\Drupal::service('cache_tags.invalidator')->invalidateTags($cache_tags);

// Clear bins
\Drupal::service('cache.config')->deleteAll();
\Drupal::service('cache.render')->deleteAll();
\Drupal::service('cache.page')->deleteAll();
\Drupal::service('cache.dynamic_page_cache')->deleteAll();

echo "Cleared config, render, page, and dynamic_page_cache bins.\\n";
echo "Done.\\n";
"""

def main():
    print(f"Connecting to {USER}@{HOST}...")
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    
    try:
        client.connect(HOST, port=PORT, username=USER, password=PASSWORD)
        
        # 1. Locate autoload (search from project root)
        cmd_find = f"find {DRUPAL_PATH} -name autoload.php -maxdepth 3"
        stdin, stdout, stderr = client.exec_command(cmd_find)
        paths = stdout.read().decode().strip().split('\n')
        valid_path = None
        for p in paths:
             if "vendor/autoload.php" in p: 
                 valid_path = p.strip(); break
        if not valid_path and paths: valid_path = paths[0].strip()
        if not valid_path: print("No autoload found"); return
        
        # 2. Upload and Run
        local_php = "flush_cache_v2.php"
        remote_php = "/tmp/flush_cache_v2.php"
        
        script_content = PHP_CLEAR_CACHE_TEMPLATE.replace('{AUTOLOADER_PATH}', valid_path)
        script_content = script_content.replace('{DRUPAL_ROOT}', DRUPAL_ROOT)
        
        with open(local_php, "w") as f:
            f.write(script_content)
            
        sftp = client.open_sftp()
        sftp.put(local_php, remote_php)
        
        print("Executing remote cache tag invalidation (v2)...")
        cmd = f"php {remote_php}"
        stdin, stdout, stderr = client.exec_command(cmd, timeout=120) 
        
        print(stdout.read().decode().strip())
        print(stderr.read().decode().strip())
             
        # 3. Cleanup
        sftp.remove(remote_php)
        os.remove(local_php)

    except Exception as e:
        print(f"Error: {e}")
    finally:
        client.close()

if __name__ == "__main__":
    main()
