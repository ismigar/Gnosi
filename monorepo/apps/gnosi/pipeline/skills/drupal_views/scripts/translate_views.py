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
# CRITICAL: We chdir to PROJECT ROOT, not WEB ROOT, for this autoloader setup
CHDIR_PATH = DRUPAL_ROOT_BASE 

# Translations Map - EN-GB
TRANSLATIONS = {
  "blog": {
    "label": "Blog",
    "display.default.display_options.title": "Blog",
    "display.default.display_options.use_more_text": "Go to Blog"
  },
  "duplicat_de_blog": {
    "label": "Designs",
    "display.default.display_options.title": "Designs",
    "display.page_1.display_options.title": "Designs",
    "display.default.display_options.use_more_text": "Go to Designs" 
  },
  "col_laboren": {
    "label": "Collaborators",
    "display.default.display_options.title": "Collaborators",
    "display.default.display_options.use_more_text": "Go to Collaborators"
  },
  "investigacions": {
    "label": "Research",
    "display.default.display_options.title": "Research",
    "display.page_1.display_options.title": "Research",
    "display.default.display_options.use_more_text": "Go to Research"
  },
  "relats": {
    "label": "Stories",
    "display.default.display_options.title": "Stories",
    "display.default.display_options.use_more_text": "Go to Stories"
  }
}

PHP_APPLIER_TEMPLATE = """<?php
use Drupal\Core\DrupalKernel;
use Symfony\Component\HttpFoundation\Request;

chdir('{CHDIR_PATH}');

$autoloader_path = '{AUTOLOADER_PATH}';
$autoloader = require_once $autoloader_path;

$request = Request::createFromGlobals();
$kernel = DrupalKernel::createFromRequest($request, $autoloader, 'prod');
$kernel->boot();

// TARGET LANGUAGE: en-gb
$target_langcode = 'en-gb'; 
try {
    $storage = \Drupal::service('language.config_factory_override')->getStorage($target_langcode);
} catch (\Exception $e) {
    echo "Error getting storage: " . $e->getMessage();
    exit(1);
}

$data = json_decode('{JSON_DATA}', true);

foreach ($data as $view_id => $overrides) {
    $config_name = 'views.view.' . $view_id;
    
    // 1. Read Existing
    $existing_data = $storage->read($config_name);
    if ($existing_data === false) {
        $existing_data = [];
    }
    
    // 2. Merge
    foreach ($overrides as $key => $value) {
        set_nested_value($existing_data, explode('.', $key), $value);
        echo "Set $view_id ($target_langcode): $key -> $value\\n";
    }
    
    // 3. Write
    $storage->write($config_name, $existing_data);
    echo "Saved overrides for $view_id to $target_langcode storage.\\n";
}

function set_nested_value(array &$array, array $parents, $value) {
    $key = array_shift($parents);
    if (empty($parents)) {
        $array[$key] = $value;
    } else {
        if (!isset($array[$key]) || !is_array($array[$key])) {
            $array[$key] = [];
        }
        set_nested_value($array[$key], $parents, $value);
    }
}

echo "Clearing caches...\\n";
$tags = ['config:views', 'config:language.entity.en-gb', 'rendered', 'http_response'];
\Drupal::service('cache_tags.invalidator')->invalidateTags($tags);
\Drupal::service('cache.config')->deleteAll();
\Drupal::service('cache.render')->deleteAll();
\Drupal::service('cache.page')->deleteAll();

echo "Done.\\n";
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
        
        print(f"Using autoloader: {valid_path}")
        
        # 2. Upload and Run
        local_php = "apply_translations_v3.php"
        remote_php = "/tmp/apply_translations_v3.php"
        
        json_data = json.dumps(TRANSLATIONS).replace("'", "\\'")
        
        script_content = PHP_APPLIER_TEMPLATE.replace('{AUTOLOADER_PATH}', valid_path)
        script_content = script_content.replace('{JSON_DATA}', json_data)
        script_content = script_content.replace('{CHDIR_PATH}', CHDIR_PATH)
        
        with open(local_php, "w") as f:
            f.write(script_content)
            
        sftp = client.open_sftp()
        sftp.put(local_php, remote_php)
        
        print("Executing remote PHP script (en-gb)...")
        cmd = f"php {remote_php}"
        stdin, stdout, stderr = client.exec_command(cmd)
        
        out = stdout.read().decode().strip()
        err = stderr.read().decode().strip()
        
        print("Output:", out)
        if err: print("Error:", err)
        
        # Cleanup
        sftp.remove(remote_php)
        os.remove(local_php)

    except Exception as e:
        print(f"Error: {e}")
    finally:
        client.close()

if __name__ == "__main__":
    main()
