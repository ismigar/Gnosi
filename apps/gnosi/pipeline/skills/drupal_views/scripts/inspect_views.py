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

PHP_EXTRACTOR = """<?php
use Drupal\Core\DrupalKernel;
use Symfony\Component\HttpFoundation\Request;

$autoloader_path = '{AUTOLOADER_PATH}';
$autoloader = require_once $autoloader_path;
$request = Request::createFromGlobals();
$kernel = DrupalKernel::createFromRequest($request, $autoloader, 'prod');
$kernel->boot();

$config_factory = \Drupal::configFactory();
$targets = ['blog', 'duplicat_de_blog', 'col_laboren', 'investigacions', 'relats'];
$output = [];

foreach ($targets as $id) {
    $config = $config_factory->get('views.view.' . $id)->get();
    if ($config) {
        $translatables = [];
        
        // 1. View Label
        if (!empty($config['label'])) {
            $translatables['label'] = $config['label'];
        }
        
        // 2. Display specific settings
        foreach ($config['display'] as $display_id => $display) {
            // Display Title
            if (!empty($display['display_options']['title'])) {
                $translatables["display.{$display_id}.display_options.title"] = $display['display_options']['title'];
            }
            
            // Empty Text (No results behavior)
            if (!empty($display['display_options']['empty'])) {
                foreach ($display['display_options']['empty'] as $key => $area) {
                    if (!empty($area['content'])) {
                         // We format the key so we can easily set it back
                         $translatables["display.{$display_id}.display_options.empty.{$key}.content"] = $area['content'];
                    }
                     if (!empty($area['title'])) {
                         $translatables["display.{$display_id}.display_options.empty.{$key}.title"] = $area['title'];
                    }
                }
            }
            
             // Header Text
            if (!empty($display['display_options']['header'])) {
                foreach ($display['display_options']['header'] as $key => $area) {
                    if (!empty($area['content'])) {
                         $translatables["display.{$display_id}.display_options.header.{$key}.content"] = $area['content'];
                    }
                }
            }
        }
        
        $output[$id] = $translatables;
    }
}

echo json_encode($output, JSON_PRETTY_PRINT);
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
        valid_path = None
        for p in paths:
             if "vendor/autoload.php" in p: 
                 valid_path = p.strip(); break
        if not valid_path and paths: valid_path = paths[0].strip()
        
        if not valid_path: print("No autoload found"); return
        
        # 2. Upload and Run
        local_php = "extract_strings.php"
        remote_php = "/tmp/extract_strings.php"
        
        with open(local_php, "w") as f:
            f.write(PHP_EXTRACTOR.replace('{AUTOLOADER_PATH}', valid_path))
            
        sftp = client.open_sftp()
        sftp.put(local_php, remote_php)
        
        stdin, stdout, stderr = client.exec_command(f"php {remote_php}")
        out = stdout.read().decode().strip()
        
        # 3. Parse and Save
        json_start = out.find('{')
        if json_start != -1:
            data = json.loads(out[json_start:])
            
            with open('views_strings.json', 'w') as f:
                json.dump(data, f, indent=2)
                
            print(json.dumps(data, indent=2))
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
