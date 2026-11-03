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
function site_public_localized(mixed $value, string $language, string $fallback = ''): string {
    if (!is_array($value)) return $fallback;
    foreach ([$language, 'ca', 'en'] as $key) if (is_string($value[$key] ?? null) && $value[$key] !== '') return $value[$key];
    foreach ($value as $text) if (is_string($text) && $text !== '') return $text;
    return $fallback;
}
function site_public_override(mixed $value, string $language, string $fallback): string {
    return is_array($value) && is_string($value[$language] ?? null) && $value[$language] !== '' ? $value[$language] : $fallback;
}
function site_public_contact_message(?SiteService $service, array $request, string $language, string $key, string $fallback): string {
    if (!$service || !is_string($request['form_id'] ?? null)) return $fallback;
    try { $form = $service->publicForm($request['form_id']); }
    catch (Throwable $error) { return $fallback; }
    return site_public_override($form[$key] ?? [], $language, $fallback);
}
function site_public_contact_link(string $url, string $base): string {
    if (preg_match('/[\x00-\x20\\\\]/', $url)) return '';
    if (preg_match('~^https?://~i', $url)) return $url;
    if (!str_starts_with($url, '/') || str_starts_with($url, '//')) return '';
    $prefix = rtrim((string)(parse_url($base, PHP_URL_PATH) ?? ''), '/');
    return $prefix && $url !== $prefix && !str_starts_with($url, $prefix.'/') ? $prefix.$url : $url;
}
function site_public_contact_retry(SiteService $service, string $language, array $request, string $message, string $base = ''): never {
    $formId = $request['form_id'] ?? '';
    $form = is_string($formId) ? $service->publicForm($formId) : null;
    if (!$form) site_public_page($language, '<p>'.site_public_escape($message).'</p>');
    $localized = fn(mixed $value, string $fallback = ''): string => site_public_localized($value, $language, $fallback);
    $override = fn(mixed $value, string $fallback): string => site_public_override($value, $language, $fallback);
    $text = match ($language) {
        'ca' => ['send' => 'Envia', 'privacy' => 'Accepto el text de privacitat', 'newsletter' => 'Subscriu-me al butlletí'],
        'es' => ['send' => 'Enviar', 'privacy' => 'Acepto el texto de privacidad', 'newsletter' => 'Suscribirme al boletín'],
        'fr' => ['send' => 'Envoyer', 'privacy' => 'J’accepte la notice de confidentialité', 'newsletter' => 'Recevoir la newsletter'],
        default => ['send' => 'Send', 'privacy' => 'I accept the privacy notice', 'newsletter' => 'Subscribe to the newsletter'],
    };
    $html = '<h2>'.site_public_escape($localized($form['title'] ?? [], (string)($form['name'] ?? ''))).'</h2><p>'.site_public_escape($localized($form['intro'] ?? [])).'</p><p role="alert">'.site_public_escape($message).'</p><form method="post">';
    foreach (['form_id' => $formId, 'revision' => (string)$form['revision'], 'language' => $language, '_request_id' => (is_string($request['_request_id'] ?? null) ? $request['_request_id'] : '')] as $name => $value) $html .= '<input type="hidden" name="'.$name.'" value="'.site_public_escape($value).'">';
    foreach ($form['fields'] as $field) {
        $id = $field['id']; $value = $request['values'][$id] ?? ''; if (!is_string($value) && !is_bool($value)) $value = '';
        $label = site_public_escape($localized($field['label'] ?? [], $id));
        $attrs = ' id="field-'.site_public_escape($id).'" name="values['.site_public_escape($id).']"'.(($field['required'] ?? false) ? ' required' : '');
        $hints = ' placeholder="'.site_public_escape($localized($field['placeholder'] ?? [])).'"';
        $help = $localized($field['help'] ?? []);
        if ($help !== '') $attrs .= ' aria-describedby="help-'.site_public_escape($id).'"';
        $html .= '<div><label for="field-'.site_public_escape($id).'">'.$label.'</label> ';
        if ($field['type'] === 'textarea') $html .= '<textarea'.$attrs.$hints.' maxlength="'.(int)($field['max_length'] ?? 5000).'">'.site_public_escape((string)$value).'</textarea>';
        elseif ($field['type'] === 'select') {
            $html .= '<select'.$attrs.'><option value=""></option>';
            foreach ($field['options'] as $option) $html .= '<option'.($value === $option ? ' selected' : '').' value="'.site_public_escape($option).'">'.site_public_escape($override($field['option_labels'][$option] ?? [], $option)).'</option>';
            $html .= '</select>';
        } elseif ($field['type'] === 'radio') {
            $html .= '<fieldset><legend>'.$label.'</legend>';
            foreach ($field['options'] as $index => $option) $html .= '<label><input type="radio" id="field-'.site_public_escape($id).'-'.$index.'" name="values['.site_public_escape($id).']" value="'.site_public_escape($option).'"'.(($field['required'] ?? false) ? ' required' : '').($value === $option ? ' checked' : '').'>'.site_public_escape($override($field['option_labels'][$option] ?? [], $option)).'</label>';
            $html .= '</fieldset>';
        } elseif ($field['type'] === 'checkbox') $html .= '<input type="checkbox"'.$attrs.' value="1"'.(in_array($value, [true, '1', 'on'], true) ? ' checked' : '').'>';
        else $html .= '<input type="'.site_public_escape($field['type']).'"'.$attrs.$hints.' value="'.site_public_escape((string)$value).'" maxlength="'.(int)($field['max_length'] ?? 5000).'">';
        if ($help !== '') $html .= '<p id="help-'.site_public_escape($id).'">'.site_public_escape($help).'</p>';
        $html .= '</div>';
    }
    $html .= '<p>'.site_public_escape($localized($form['privacy_text'] ?? [])).'</p>';
    $privacyUrl = site_public_contact_link((string)($form['privacy_url'] ?? ''), $base);
    if ($privacyUrl !== '') $html .= '<a href="'.site_public_escape($privacyUrl).'">'.site_public_escape($override($form['privacy_link_label'] ?? [], $text['privacy'])).'</a>';
    if ($form['require_privacy'] ?? false) $html .= '<p><label><input type="checkbox" name="privacy" value="1" required'.(!empty($request['privacy']) ? ' checked' : '').'> '.site_public_escape($override($form['privacy_label'] ?? [], $text['privacy'])).'</label></p>';
    if (!empty($form['newsletter_list'])) $html .= '<p><label><input type="checkbox" name="newsletter_opt_in" value="1"'.(!empty($request['newsletter_opt_in']) ? ' checked' : '').'> '.site_public_escape($override($form['newsletter_label'] ?? [], $text['newsletter'])).'</label></p>';
    $html .= '<button type="submit">'.site_public_escape($override($form['submit_label'] ?? [], $text['send'])).'</button></form>';
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
