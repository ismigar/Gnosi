<?php
declare(strict_types=1);
if (PHP_SAPI !== 'cli') { http_response_code(404); exit; }
umask(0077);
require_once __DIR__.'/library.php';

/** Optional standalone worker supervisor; all control files remain private. */
function site_daemon_status(string $directory, bool $running, ?string $error, int $iterations): void {
    $data = json_encode(['pid' => getmypid(), 'running' => $running, 'updated_at' => gmdate('c'), 'last_error' => $error, 'iterations' => $iterations], JSON_THROW_ON_ERROR);
    $temporary = tempnam($directory, '.daemon-status-');
    if ($temporary === false) throw new RuntimeException('Daemon state unavailable');
    try {
        chmod($temporary, 0600);
        if (file_put_contents($temporary, $data) === false || !rename($temporary, $directory.'/daemon-status.json')) throw new RuntimeException('Daemon state unavailable');
    } finally { if (is_file($temporary)) unlink($temporary); }
}

$lock = null; $directory = ''; $owned = false; $iterations = 0; $stopped = false;
try {
    if (count($argv) > 2 || (isset($argv[1]) && $argv[1] !== '--once')) throw new InvalidArgumentException('Invalid daemon arguments');
    $once = ($argv[1] ?? '') === '--once';
    $initial = site_service_config(); new SiteService($initial);
    $directory = rtrim($initial['spool_path'], '/');
    $lock = fopen($directory.'/.daemon.lock', 'c');
    if (!$lock) throw new RuntimeException('Daemon lock unavailable');
    if (!flock($lock, LOCK_EX | LOCK_NB)) { fclose($lock); exit(0); }
    $owned = true;
    if (is_file($directory.'/.daemon-stop')) $stopped = true;
    else {
        if (file_put_contents($directory.'/daemon.pid', (string)getmypid()."\n") === false) throw new RuntimeException('Daemon PID unavailable');
        chmod($directory.'/daemon.pid', 0600);
    }
    if (function_exists('pcntl_async_signals')) {
        pcntl_async_signals(true);
        pcntl_signal(SIGTERM, function () use (&$stopped): void { $stopped = true; });
        pcntl_signal(SIGINT, function () use (&$stopped): void { $stopped = true; });
    }
    while (!$stopped && !is_file($directory.'/.daemon-stop')) {
        $error = null;
        try {
            $current = site_service_config();
            foreach (['site_id', 'db_path', 'spool_path'] as $key) if (($current[$key] ?? null) !== $initial[$key]) throw new InvalidArgumentException('Service identity changed');
            $service = new SiteService($current);
            site_daemon_status($directory, true, null, $iterations);
            $result = ['delivery' => $service->admin('worker', ['limit' => 20]), 'maintenance' => $service->admin('maintenance', [])];
            $iterations++;
            site_daemon_status($directory, true, null, $iterations);
            if ($once) { echo json_encode($result, JSON_THROW_ON_ERROR)."\n"; break; }
        } catch (InvalidArgumentException $failure) {
            $error = 'configuration_changed'; site_daemon_status($directory, false, $error, $iterations); throw $failure;
        } catch (Throwable $failure) {
            $error = 'service_unavailable'; site_daemon_status($directory, true, $error, $iterations);
            if ($once) throw $failure;
        }
        for ($second = 0; $second < 30 && !$stopped && !is_file($directory.'/.daemon-stop'); $second++) sleep(1);
    }
    site_daemon_status($directory, false, null, $iterations);
} catch (Throwable $failure) {
    if ($owned && $directory !== '') { try { site_daemon_status($directory, false, 'service_unavailable', $iterations); } catch (Throwable $ignored) {} }
    fwrite(STDERR, "Site service daemon unavailable\n"); exit(1);
} finally {
    if ($owned && $directory !== '' && is_file($directory.'/daemon.pid')) unlink($directory.'/daemon.pid');
    if (is_resource($lock)) { if ($owned) flock($lock, LOCK_UN); fclose($lock); }
}
