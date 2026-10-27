<?php
declare(strict_types=1);
if (PHP_SAPI !== 'cli') { http_response_code(404); exit; }
umask(0077);
require_once __DIR__.'/library.php';
try {
    $raw = stream_get_contents(STDIN, 1048577);
    if ($raw === false || strlen($raw) > 1048576) throw new InvalidArgumentException('request_size');
    $input = json_decode($raw, true, 64, JSON_THROW_ON_ERROR);
    if (!is_array($input) || !is_string($input['action'] ?? null) || !is_array($input['request'] ?? [])) throw new InvalidArgumentException('request');
    $service = new SiteService(site_service_config());
    $output = json_encode($service->admin($input['action'], $input['request'] ?? []), JSON_THROW_ON_ERROR | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
    if (strlen($output) > 4000000) throw new InvalidArgumentException('response_size');
    echo $output."\n";
} catch (Throwable $error) {
    $code = $error instanceof InvalidArgumentException ? $error->getMessage() : 'service_unavailable';
    echo json_encode(['error' => $code, 'schema_version' => 1], JSON_THROW_ON_ERROR)."\n"; exit(1);
}
