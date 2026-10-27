<?php
declare(strict_types=1);
require_once __DIR__.'/common.php';
$language = is_string($_POST['language'] ?? $_GET['language'] ?? null) ? ($_POST['language'] ?? $_GET['language']) : 'ca';
$request = [];
try {
    [$config, $service] = site_public_bootstrap(); $request = site_public_request($config);
    $language = is_string($request['language'] ?? null) ? $request['language'] : 'ca';
    $result = $service->contact($request, (string)($_SERVER['REMOTE_ADDR'] ?? 'unknown'));
    if (!site_public_json() && !empty($result['redirect_path'])) { header('Location: '.$result['redirect_path'], true, 303); exit; }
    site_public_response($language, $result);
} catch (SiteValidation $error) {
    if (!site_public_json()) { http_response_code(422); site_public_contact_retry($service, $language, $request, site_public_labels($language)['error']); }
    site_public_response($language, ['error' => 'validation', 'fields' => $error->fields, 'message' => site_public_labels($language)['error']], 422);
} catch (InvalidArgumentException $error) {
    $status = http_response_code() >= 400 ? http_response_code() : 422;
    if (!site_public_json() && isset($service) && $request) { http_response_code($status); site_public_contact_retry($service, $language, $request, site_public_labels($language)['error']); }
    site_public_response($language, ['error' => $error->getMessage(), 'message' => site_public_labels($language)['error']], $status);
} catch (Throwable $error) {
    site_public_response($language, ['error' => 'service_unavailable', 'message' => site_public_labels($language)['unavailable']], 503);
}
