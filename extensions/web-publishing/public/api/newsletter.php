<?php
declare(strict_types=1);
require_once __DIR__.'/common.php';
$language = is_string($_GET['language'] ?? $_POST['language'] ?? null) ? ($_GET['language'] ?? $_POST['language']) : 'ca';
try {
    [$config, $service] = site_public_bootstrap();
    if (($_SERVER['REQUEST_METHOD'] ?? '') === 'POST') {
        $request = site_public_request($config); $language = is_string($request['language'] ?? null) ? $request['language'] : 'ca';
        $action = $request['action'] ?? 'subscribe';
        if ($action === 'subscribe') $result = $service->subscribe($request, (string)($_SERVER['REMOTE_ADDR'] ?? 'unknown'));
        elseif (in_array($action, ['confirm', 'unsubscribe', 'preferences'], true)) {
            if (is_string($request['interests'] ?? null)) $request['interests'] = array_values(array_filter(array_map('trim', explode(',', $request['interests']))));
            $result = $service->applyToken($request);
        } else { http_response_code(404); throw new InvalidArgumentException('action'); }
        site_public_response($language, $result);
    }
    if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'GET') { http_response_code(405); header('Allow: GET, POST'); throw new InvalidArgumentException('method'); }
    $action = $_GET['action'] ?? ''; $token = $_GET['token'] ?? '';
    if (!in_array($action, ['confirm', 'unsubscribe', 'preferences'], true)) { http_response_code(404); site_public_page($language, '<p>'.site_public_escape(site_public_labels($language)['error']).'</p>'); }
    if (!is_string($token) || !preg_match('/^[a-f0-9]{64}$/D', $token)) $token = '';
    $labels = site_public_labels($language);
    $form = '<p>'.site_public_escape($labels['confirmation']).'</p><form method="post"><input type="hidden" name="action" value="'.site_public_escape($action).'"><input type="hidden" name="token" value="'.site_public_escape($token).'">';
    if ($action === 'preferences') {
        $form .= '<label>'.site_public_escape($labels['language']).'<select name="language">';
        foreach (($config['languages'] ?? ['ca', 'es', 'en-gb', 'fr']) as $choice) $form .= '<option value="'.site_public_escape($choice).'"'.($language === $choice ? ' selected' : '').'>'.site_public_escape(strtoupper($choice === 'en-gb' ? 'en' : $choice)).'</option>';
        $form .= '</select></label><label>'.site_public_escape($labels['interests']).'<input name="interests"></label>';
    } else $form .= '<input type="hidden" name="language" value="'.site_public_escape($language).'">';
    $form .= '<button type="submit">'.site_public_escape($labels[$action]).'</button></form>';
    site_public_page($language, $form);
} catch (InvalidArgumentException $error) {
    site_public_response($language, ['error' => $error->getMessage(), 'message' => site_public_labels($language)['error']], http_response_code() >= 400 ? http_response_code() : 422);
} catch (Throwable $error) {
    site_public_response($language, ['error' => 'service_unavailable', 'message' => site_public_labels($language)['unavailable']], 503);
}
