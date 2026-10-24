<?php
declare(strict_types=1);

function site_public_labels(string $language): array {
    return match ($language) {
        'ca' => ['title' => 'Contacte i subscripcions', 'received' => 'Hem rebut la sol·licitud.', 'error' => 'No s’ha pogut enviar. Revisa els camps i torna-ho a provar.', 'unavailable' => 'El servei no està disponible temporalment. Torna-ho a provar.', 'confirm' => 'Confirma la subscripció', 'unsubscribe' => 'Dona’m de baixa', 'preferences' => 'Desa les preferències', 'language' => 'Idioma', 'interests' => 'Interessos (separats per comes)', 'confirmation' => 'Confirma aquesta acció amb el botó.', 'back' => 'Torna al formulari'],
        'es' => ['title' => 'Contacto y suscripciones', 'received' => 'Hemos recibido la solicitud.', 'error' => 'No se ha podido enviar. Revisa los campos e inténtalo de nuevo.', 'unavailable' => 'El servicio no está disponible temporalmente. Inténtalo de nuevo.', 'confirm' => 'Confirma la suscripción', 'unsubscribe' => 'Darme de baja', 'preferences' => 'Guardar preferencias', 'language' => 'Idioma', 'interests' => 'Intereses (separados por comas)', 'confirmation' => 'Confirma esta acción con el botón.', 'back' => 'Volver al formulario'],
        'fr' => ['title' => 'Contact et inscriptions', 'received' => 'Votre demande a été reçue.', 'error' => 'L’envoi a échoué. Vérifiez les champs et réessayez.', 'unavailable' => 'Le service est temporairement indisponible. Réessayez.', 'confirm' => 'Confirmez votre inscription', 'unsubscribe' => 'Me désinscrire', 'preferences' => 'Enregistrer les préférences', 'language' => 'Langue', 'interests' => 'Intérêts (séparés par des virgules)', 'confirmation' => 'Confirmez cette action avec le bouton.', 'back' => 'Retour au formulaire'],
        default => ['title' => 'Contact and subscriptions', 'received' => 'Your request has been received.', 'error' => 'Could not submit. Check the fields and try again.', 'unavailable' => 'The service is temporarily unavailable. Please try again.', 'confirm' => 'Confirm your subscription', 'unsubscribe' => 'Unsubscribe', 'preferences' => 'Save preferences', 'language' => 'Language', 'interests' => 'Interests (comma separated)', 'confirmation' => 'Confirm this action using the button.', 'back' => 'Return to the form'],
    };
}
function site_public_escape(string $value): string { return htmlspecialchars($value, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8'); }
function site_public_json(): bool { return str_contains($_SERVER['HTTP_ACCEPT'] ?? '', 'application/json'); }
function site_public_page(string $language, string $content): never {
    $labels = site_public_labels($language);
    echo '<!doctype html><html lang="'.site_public_escape($language).'"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><meta name="robots" content="noindex,nofollow"><title>'.site_public_escape($labels['title']).'</title></head><body><main>'.$content.'</main></body></html>'; exit;
}
function site_public_response(string $language, array $data, int $status = 200): never {
    http_response_code($status);
    if (site_public_json()) { header('Content-Type: application/json; charset=utf-8'); echo json_encode($data, JSON_THROW_ON_ERROR | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE); exit; }
    site_public_page($language, '<p>'.site_public_escape((string)($data['message'] ?? site_public_labels($language)[$status < 400 ? 'received' : 'error'])).'</p>');
}
function site_public_contact_retry(SiteService $service, string $language, array $request, string $message): never {
    $id = $request['form_id'] ?? '';
    $form = is_string($id) ? $service->publicForm($id) : null;
    if (!$form) site_public_page($language, '<p>'.site_public_escape($message).'</p>');
    $localized = fn(mixed $value, string $fallback = ''): string => is_array($value) ? (string)($value[$language] ?? $value['ca'] ?? $value['en'] ?? reset($value) ?: $fallback) : $fallback;
    $html = '<p role="alert">'.site_public_escape($message).'</p><form method="post">';
    foreach (['form_id' => $id, 'revision' => (string)$form['revision'], 'language' => $language, '_request_id' => (is_string($request['_request_id'] ?? null) ? $request['_request_id'] : '')] as $name => $value) $html .= '<input type="hidden" name="'.$name.'" value="'.site_public_escape($value).'">';
    foreach ($form['fields'] as $field) {
        $id = $field['id']; $value = $request['values'][$id] ?? ''; if (!is_string($value) && !is_bool($value)) $value = '';
        $label = site_public_escape($localized($field['label'] ?? [], $id));
        $attrs = ' id="field-'.site_public_escape($id).'" name="values['.site_public_escape($id).']"'.(($field['required'] ?? false) ? ' required' : '');
        $html .= '<p><label for="field-'.site_public_escape($id).'">'.$label.'</label> ';
        if ($field['type'] === 'textarea') $html .= '<textarea'.$attrs.' maxlength="'.(int)($field['max_length'] ?? 5000).'">'.site_public_escape((string)$value).'</textarea>';
        elseif (in_array($field['type'], ['select', 'radio'], true)) {
            $html .= '<select'.$attrs.'><option value=""></option>';
            foreach ($field['options'] as $option) $html .= '<option'.($value === $option ? ' selected' : '').' value="'.site_public_escape($option).'">'.site_public_escape($option).'</option>';
            $html .= '</select>';
        } elseif ($field['type'] === 'checkbox') $html .= '<input type="checkbox"'.$attrs.' value="1"'.(in_array($value, [true, '1', 'on'], true) ? ' checked' : '').'>';
        else $html .= '<input type="'.site_public_escape($field['type']).'"'.$attrs.' value="'.site_public_escape((string)$value).'" maxlength="'.(int)($field['max_length'] ?? 5000).'">';
        $html .= '</p>';
    }
    if ($form['require_privacy'] ?? false) $html .= '<p><label><input type="checkbox" name="privacy" value="1" required'.(!empty($request['privacy']) ? ' checked' : '').'> '.site_public_escape($localized($form['privacy_text'] ?? [], 'Privacy')).'</label></p>';
    $html .= '<button type="submit">'.site_public_escape($localized($form['submit_label'] ?? [], 'Send')).'</button></form>';
    site_public_page($language, $html);
}
function site_public_bootstrap(): array {
    umask(0077);
    // Workers may survive configuration replacement between requests.
    clearstatcache(true);
    header('Cache-Control: no-store'); header('X-Robots-Tag: noindex, nofollow'); header('Referrer-Policy: same-origin'); header('X-Content-Type-Options: nosniff');
    header("Content-Security-Policy: default-src 'none'; form-action 'self'; base-uri 'none'; frame-ancestors 'self'");
    $path = getenv('GNOSI_SITES_SERVICE_CONFIG');
    if (!$path || !str_starts_with($path, '/') || !is_file($path)) throw new RuntimeException('Unavailable');
    $configuredRoot = $_SERVER['DOCUMENT_ROOT'] ?? null;
    if (!is_string($configuredRoot) || trim($configuredRoot) === '') throw new RuntimeException('HTTP document root unavailable');
    $root = realpath($configuredRoot);
    if ($root === false || !is_dir($root)) throw new RuntimeException('HTTP document root unavailable');
    $prefix = rtrim($root, '/').'/'; $resolved = realpath($path);
    if (!$resolved || $resolved === $root || str_starts_with($resolved, $prefix)) throw new RuntimeException('Private configuration required');
    $config = json_decode((string)file_get_contents($path), true, 64, JSON_THROW_ON_ERROR);
    if (!is_array($config) || !is_string($config['library_path'] ?? null)) throw new RuntimeException('Unavailable');
    $library = realpath($config['library_path']);
    if (!$library || $library === $root || str_starts_with($library, $prefix)) throw new RuntimeException('Private library required');
    require_once $library;
    return [$config, new SiteService($config)];
}
function site_public_request(array $config): array {
    if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') { http_response_code(405); header('Allow: POST'); throw new InvalidArgumentException('method'); }
    if ((int)($_SERVER['CONTENT_LENGTH'] ?? 0) > 1048576) { http_response_code(413); throw new InvalidArgumentException('request_size'); }
    $expected = parse_url($config['public_base_url']); $source = $_SERVER['HTTP_ORIGIN'] ?? $_SERVER['HTTP_REFERER'] ?? ''; $actual = parse_url($source);
    $port = fn(array $url): int => (int)($url['port'] ?? (($url['scheme'] ?? '') === 'https' ? 443 : 80));
    if (!$actual || isset($actual['user']) || ($actual['scheme'] ?? '') !== ($expected['scheme'] ?? '') || strtolower($actual['host'] ?? '') !== strtolower($expected['host'] ?? '') || $port($actual) !== $port($expected)) { http_response_code(403); throw new InvalidArgumentException('origin'); }
    if (str_starts_with(strtolower($_SERVER['CONTENT_TYPE'] ?? ''), 'application/json')) {
        $raw = file_get_contents('php://input', false, null, 0, 1048577);
        if ($raw === false || strlen($raw) > 1048576) throw new InvalidArgumentException('request_size');
        $request = json_decode($raw, true, 32, JSON_THROW_ON_ERROR); if (!is_array($request)) throw new InvalidArgumentException('request'); return $request;
    }
    return $_POST;
}
