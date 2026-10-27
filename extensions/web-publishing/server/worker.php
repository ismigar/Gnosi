<?php
declare(strict_types=1);
if (PHP_SAPI !== 'cli') { http_response_code(404); exit; }
umask(0077);
require_once __DIR__.'/library.php';
try {
    $service = new SiteService(site_service_config());
    echo json_encode(['delivery' => $service->admin('worker', ['limit' => 20]), 'maintenance' => $service->admin('maintenance', [])], JSON_THROW_ON_ERROR)."\n";
} catch (Throwable $error) { fwrite(STDERR, "Site service worker unavailable\n"); exit(1); }
