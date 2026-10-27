<?php
declare(strict_types=1);

/** CLI working directories are not HTTP document roots. */
function site_service_document_root(): ?string {
    clearstatcache(true);
    if (PHP_SAPI === 'cli') return null;
    $configured = $_SERVER['DOCUMENT_ROOT'] ?? null;
    if (!is_string($configured) || trim($configured) === '') throw new RuntimeException('HTTP document root unavailable');
    $resolved = realpath($configured);
    if ($resolved === false || !is_dir($resolved)) throw new RuntimeException('HTTP document root unavailable');
    return $resolved;
}

function site_service_public_path(string $resolved, ?string $documentRoot): bool {
    return $documentRoot !== null && ($resolved === $documentRoot || str_starts_with($resolved, rtrim($documentRoot, '/').'/'));
}

/** Private, site-scoped persistence shared by the CLI and public handlers. */
final class SiteStorage {
    public PDO $db;
    public array $config;

    public function __construct(array $config) {
        umask(0077);
        foreach (['site_id', 'public_base_url', 'db_path', 'spool_path'] as $key) {
            if (!is_string($config[$key] ?? null) || $config[$key] === '') throw new RuntimeException('Invalid service configuration');
        }
        if (!preg_match('/^[a-zA-Z0-9_-]{1,128}$/D', $config['site_id'])) throw new RuntimeException('Invalid site identity');
        $url = parse_url($config['public_base_url']);
        if (!$url || !in_array($url['scheme'] ?? '', ['http', 'https'], true) || empty($url['host']) || isset($url['user']) || isset($url['query']) || isset($url['fragment'])) throw new RuntimeException('Invalid public URL');
        $config['test_mode'] = ($config['test_mode'] ?? true) !== false;
        $this->config = $config;
        $docroot = site_service_document_root();
        foreach (['db_path', 'spool_path'] as $key) {
            if (!str_starts_with($config[$key], '/')) throw new RuntimeException('Private paths must be absolute');
            $dir = $key === 'db_path' ? dirname($config[$key]) : $config[$key];
            $ancestor = $dir;
            while (!file_exists($ancestor) && dirname($ancestor) !== $ancestor) $ancestor = dirname($ancestor);
            $existing = realpath($ancestor);
            if ($existing !== false && site_service_public_path($existing, $docroot)) throw new RuntimeException('Private storage required');
            if (!is_dir($dir) && !mkdir($dir, 0700, true)) throw new RuntimeException('Private storage unavailable');
            $resolved = realpath($key === 'db_path' && file_exists($config[$key]) ? $config[$key] : $dir);
            if (!$resolved || site_service_public_path($resolved, $docroot)) throw new RuntimeException('Private storage required');
        }
        $this->db = new PDO('sqlite:'.$config['db_path'], null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC]);
        chmod($config['db_path'], 0600);
        $this->db->exec('PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;');
        $this->db->exec("CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY,value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS forms (id TEXT PRIMARY KEY,revision INTEGER NOT NULL,definition TEXT NOT NULL,delivery TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS messages (id TEXT PRIMARY KEY,form_id TEXT NOT NULL,form_revision INTEGER NOT NULL,language TEXT NOT NULL,fields TEXT NOT NULL,email TEXT NOT NULL,created_at INTEGER NOT NULL,status TEXT NOT NULL DEFAULT 'new',dedup_key TEXT NOT NULL UNIQUE);
CREATE TABLE IF NOT EXISTS rates (key TEXT NOT NULL,occurred_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS rates_lookup ON rates(key,occurred_at);
CREATE TABLE IF NOT EXISTS subscribers (id INTEGER PRIMARY KEY,email TEXT NOT NULL UNIQUE,language TEXT NOT NULL,status TEXT NOT NULL,interests TEXT NOT NULL DEFAULT '[]',consent_at INTEGER NOT NULL,consent_revision TEXT NOT NULL,updated_at INTEGER NOT NULL,revision INTEGER NOT NULL DEFAULT 1);
CREATE TABLE IF NOT EXISTS memberships (subscriber_id INTEGER NOT NULL REFERENCES subscribers(id) ON DELETE CASCADE,list_id TEXT NOT NULL,status TEXT NOT NULL,PRIMARY KEY(subscriber_id,list_id));
CREATE TABLE IF NOT EXISTS suppressions (email TEXT PRIMARY KEY,reason TEXT NOT NULL,created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS tokens (hash TEXT PRIMARY KEY,subscriber_id INTEGER NOT NULL REFERENCES subscribers(id) ON DELETE CASCADE,kind TEXT NOT NULL,list_id TEXT NOT NULL,expires_at INTEGER NOT NULL,used_at INTEGER);
CREATE TABLE IF NOT EXISTS subscription_requests (token_hash TEXT PRIMARY KEY REFERENCES tokens(hash) ON DELETE CASCADE,language TEXT NOT NULL,interests TEXT NOT NULL,consent_at INTEGER NOT NULL,consent_revision TEXT NOT NULL,confirmed_at INTEGER);
CREATE TABLE IF NOT EXISTS consent_history (id INTEGER PRIMARY KEY,subscriber_id INTEGER NOT NULL REFERENCES subscribers(id) ON DELETE CASCADE,list_id TEXT NOT NULL,language TEXT NOT NULL,interests TEXT NOT NULL,consent_at INTEGER NOT NULL,consent_revision TEXT NOT NULL,confirmed_at INTEGER NOT NULL,UNIQUE(subscriber_id,list_id,language,interests,consent_at,consent_revision));
CREATE TABLE IF NOT EXISTS previews (id TEXT PRIMARY KEY,subject TEXT NOT NULL,body_html TEXT NOT NULL,body_text TEXT NOT NULL,language TEXT NOT NULL,list_id TEXT NOT NULL,interests TEXT NOT NULL,audience TEXT NOT NULL,expires_at INTEGER NOT NULL,campaign_id TEXT);
CREATE TABLE IF NOT EXISTS campaigns (id TEXT PRIMARY KEY,subject TEXT NOT NULL,body_html TEXT NOT NULL,body_text TEXT NOT NULL,language TEXT NOT NULL,list_id TEXT NOT NULL,status TEXT NOT NULL,recipient_count INTEGER NOT NULL,created_at INTEGER NOT NULL,scheduled_at INTEGER NOT NULL,paused INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS queue (id TEXT PRIMARY KEY,kind TEXT NOT NULL,owner_id TEXT NOT NULL,subscriber_id INTEGER REFERENCES subscribers(id),list_id TEXT,to_email TEXT NOT NULL,reply_to TEXT NOT NULL,subject TEXT NOT NULL,body_html TEXT NOT NULL,body_text TEXT NOT NULL,status TEXT NOT NULL,attempts INTEGER NOT NULL DEFAULT 0,due_at INTEGER NOT NULL,started_at INTEGER,updated_at INTEGER NOT NULL,error_code TEXT NOT NULL DEFAULT '',UNIQUE(kind,owner_id,to_email));");
        $this->db->exec('CREATE TABLE IF NOT EXISTS queue_tokens (queue_id TEXT NOT NULL REFERENCES queue(id) ON DELETE CASCADE,token_hash TEXT NOT NULL REFERENCES tokens(hash) ON DELETE CASCADE,PRIMARY KEY(queue_id,token_hash));');
        $this->db->exec('CREATE TABLE IF NOT EXISTS preview_contexts (preview_id TEXT PRIMARY KEY REFERENCES previews(id) ON DELETE CASCADE,rendered_html TEXT NOT NULL,from_email TEXT NOT NULL,test_mode INTEGER NOT NULL,public_base_url TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS queue_contexts (queue_id TEXT PRIMARY KEY REFERENCES queue(id) ON DELETE CASCADE,from_email TEXT NOT NULL,test_mode INTEGER NOT NULL);');
        $identity = $this->query("SELECT value FROM metadata WHERE key='site_id'")->fetchColumn();
        if ($identity !== false && $identity !== $config['site_id']) throw new RuntimeException('Service site mismatch');
        $this->query("INSERT OR IGNORE INTO metadata VALUES ('site_id',?)", [$config['site_id']]);
        $this->query("INSERT OR IGNORE INTO metadata VALUES ('schema_version','1')");
    }

    public function query(string $sql, array $args = []): PDOStatement {
        $statement = $this->db->prepare($sql); $statement->execute($args); return $statement;
    }

    public function transaction(callable $fn): mixed {
        $this->db->exec('BEGIN IMMEDIATE');
        try { $result = $fn(); $this->db->exec('COMMIT'); return $result; }
        catch (Throwable $error) { $this->db->exec('ROLLBACK'); throw $error; }
    }

    public function rate(string $scope, string $ip, int $limit = 5): bool {
        return $this->transaction(function () use ($scope, $ip, $limit) {
            $now = time(); $key = hash('sha256', $scope.':'.$ip);
            $this->query('DELETE FROM rates WHERE occurred_at < ?', [$now - 3600]);
            if ((int)$this->query('SELECT COUNT(*) FROM rates WHERE key=?', [$key])->fetchColumn() >= $limit) return false;
            $this->query('INSERT INTO rates VALUES (?,?)', [$key, $now]); return true;
        });
    }
}

function site_service_config(): array {
    clearstatcache(true);
    $path = getenv('GNOSI_SITES_SERVICE_CONFIG');
    if (!$path || !str_starts_with($path, '/') || !is_file($path)) throw new RuntimeException('Service configuration unavailable');
    $docroot = site_service_document_root();
    $resolved = realpath($path);
    if (!$resolved || site_service_public_path($resolved, $docroot)) throw new RuntimeException('Private configuration required');
    $config = json_decode((string)file_get_contents($path), true, 64, JSON_THROW_ON_ERROR);
    if (!is_array($config)) throw new RuntimeException('Invalid configuration');
    return $config;
}
