<?php
declare(strict_types=1);
require_once __DIR__.'/storage.php';
require_once __DIR__.'/smtp.php';
require_once __DIR__.'/captured.php';

final class SiteValidation extends InvalidArgumentException {
    public function __construct(public array $fields) { parent::__construct('validation'); }
}

/** Runtime state is deliberately independent from static-site release directories. */
final class SiteService {
    use SiteCapturedMail;
    private SiteStorage $storage;
    private array $config;

    public function __construct(array $config) {
        $this->storage = new SiteStorage($config); $this->config = $this->storage->config;
        if (!$this->q("SELECT value FROM metadata WHERE key='forms_initialized'")->fetchColumn()) $this->syncForms($config['forms'] ?? [], $config['form_delivery'] ?? []);
    }

    private function q(string $sql, array $args = []): PDOStatement { return $this->storage->query($sql, $args); }
    private function tx(callable $fn): mixed { return $this->storage->transaction($fn); }
    private function json(mixed $value): string { return json_encode($value, JSON_THROW_ON_ERROR | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE); }
    private function id(): string { return bin2hex(random_bytes(16)); }
    private function lang(mixed $value): string {
        if (!is_string($value) || !preg_match('/^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/D', $value)) throw new InvalidArgumentException('language');
        $languages = $this->config['languages'] ?? ['ca', 'es', 'en-gb', 'en', 'fr'];
        if (!in_array($value, $languages, true)) throw new InvalidArgumentException('language'); return $value;
    }
    private function key(mixed $value): string {
        if (!is_string($value) || !preg_match('/^[a-zA-Z0-9_-]{1,128}$/D', $value)) throw new InvalidArgumentException('identifier'); return $value;
    }
    public static function synthetic(string $email): bool { return filter_var($email, FILTER_VALIDATE_EMAIL) !== false && preg_match('/@(?:[a-z0-9-]+\.)*invalid$/iD', $email) === 1; }
    private function email(mixed $value): string {
        if (!is_string($value) || strlen($value) > 254) throw new InvalidArgumentException('email');
        $email = strtolower(trim($value));
        if (!filter_var($email, FILTER_VALIDATE_EMAIL) || ($this->config['test_mode'] && !self::synthetic($email))) throw new InvalidArgumentException('email'); return $email;
    }
    private function localized(mixed $value, string $language, string $fallback = ''): string {
        if (!is_array($value)) return is_string($value) ? $value : $fallback;
        return (string)($value[$language] ?? $value['ca'] ?? $value['en'] ?? reset($value) ?: $fallback);
    }
    private function interests(mixed $value): array {
        if (!is_array($value) || count($value) > 30) throw new InvalidArgumentException('interests');
        $result = [];
        foreach ($value as $item) { if (!is_string($item) || strlen($item) > 100) throw new InvalidArgumentException('interests'); $result[] = trim($item); }
        $result = array_values(array_unique(array_filter($result, fn($x) => $x !== ''))); sort($result); return $result;
    }
    private function labels(string $language): array {
        return match ($language) {
            'ca' => ['confirm' => 'Confirma la subscripció', 'unsubscribe' => 'Dona’m de baixa', 'received' => 'Hem rebut el teu missatge.', 'preferences' => 'Preferències'],
            'es' => ['confirm' => 'Confirma la suscripción', 'unsubscribe' => 'Darme de baja', 'received' => 'Hemos recibido tu mensaje.', 'preferences' => 'Preferencias'],
            'fr' => ['confirm' => 'Confirmez votre inscription', 'unsubscribe' => 'Me désinscrire', 'received' => 'Votre message a été reçu.', 'preferences' => 'Préférences'],
            default => ['confirm' => 'Confirm your subscription', 'unsubscribe' => 'Unsubscribe', 'received' => 'Your message has been received.', 'preferences' => 'Preferences'],
        };
    }
    private function escape(string $text): string { return htmlspecialchars($text, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8'); }
    private function redirect(string $path): string {
        if ($path === '') return '';
        $decoded = $path; for ($i = 0; $i < 3; $i++) $decoded = rawurldecode($decoded);
        if (!str_starts_with($path, '/') || str_starts_with($decoded, '//') || str_contains($decoded, '..') || preg_match('/[\\\\\x00-\x20]/', $decoded) || str_contains($path, '?') || str_contains($path, '#')) throw new InvalidArgumentException('redirect');
        $basePath = rtrim((string)(parse_url($this->config['public_base_url'], PHP_URL_PATH) ?? ''), '/');
        return $basePath && !str_starts_with($path, $basePath.'/') ? $basePath.$path : $path;
    }

    private function syncForms(array $forms, array $delivery = []): array {
        if (count($forms) > 100) throw new InvalidArgumentException('forms');
        $valid = []; $ids = [];
        foreach ($forms as $form) {
            if (!is_array($form)) throw new InvalidArgumentException('form');
            $id = $this->key($form['id'] ?? null); if (isset($ids[$id])) throw new InvalidArgumentException('duplicate_form'); $ids[$id] = true;
            $revision = (int)($form['revision'] ?? 1); if ($revision < 1) throw new InvalidArgumentException('revision');
            $fields = $form['fields'] ?? []; if (!is_array($fields) || count($fields) > 50) throw new InvalidArgumentException('fields');
            $seen = []; $emails = 0;
            foreach ($fields as $field) {
                if (!is_array($field)) throw new InvalidArgumentException('field');
                $fid = $this->key($field['id'] ?? null); if (isset($seen[$fid])) throw new InvalidArgumentException('duplicate_field'); $seen[$fid] = true;
                if (!in_array($field['type'] ?? '', ['text', 'textarea', 'email', 'tel', 'select', 'radio', 'checkbox'], true)) throw new InvalidArgumentException('field_type');
                if (($field['type'] ?? '') === 'email') $emails++;
                $length = (int)($field['max_length'] ?? 5000); if ($length < 1 || $length > 50000) throw new InvalidArgumentException('field_length');
                if (in_array($field['type'], ['select', 'radio'], true) && (!is_array($field['options'] ?? null) || count($field['options']) > 100)) throw new InvalidArgumentException('options');
                foreach (($field['options'] ?? []) as $option) if (!is_string($option) || strlen($option) > 300) throw new InvalidArgumentException('option');
            }
            if ($emails !== 1) throw new InvalidArgumentException('one_email_field_required');
            $this->redirect((string)($form['redirect_path'] ?? ''));
            $savedDelivery = $this->q('SELECT delivery FROM forms WHERE id=?', [$id])->fetchColumn();
            $private = $delivery[$id] ?? $this->config['form_delivery'][$id] ?? ($savedDelivery ? json_decode($savedDelivery, true, 64, JSON_THROW_ON_ERROR) : []);
            if (!is_array($private)) throw new InvalidArgumentException('delivery');
            $recipients = $private['recipients'] ?? $this->config['form_recipients'][$id] ?? [];
            if (!is_array($recipients) || count($recipients) > 20) throw new InvalidArgumentException('recipients');
            foreach ($recipients as $email) $this->email($email);
            $private['recipients'] = array_values(array_unique($recipients));
            $subject = (string)($private['subject'] ?? 'Contact'); if (strlen($subject) > 300 || preg_match('/[\r\n]/', $subject)) throw new InvalidArgumentException('subject');
            $private['subject'] = $subject;
            $valid[] = [$id, $revision, $this->json($form), $this->json($private)];
        }
        return $this->tx(function () use ($valid) {
            $this->q('DELETE FROM forms'); foreach ($valid as $row) $this->q('INSERT INTO forms VALUES (?,?,?,?)', $row);
            $this->q("INSERT INTO metadata VALUES ('forms_initialized','1') ON CONFLICT(key) DO UPDATE SET value='1'"); return ['count' => count($valid)];
        });
    }

    public function publicForm(string $id): ?array {
        $row = $this->q('SELECT definition FROM forms WHERE id=?', [$this->key($id)])->fetchColumn();
        if ($row === false) return null;
        $form = json_decode($row, true, 64, JSON_THROW_ON_ERROR);
        return ($form['enabled'] ?? true) === true ? $form : null;
    }

    private function queue(string $kind, string $owner, string $to, string $subject, string $html, string $text, string $reply = '', ?int $subscriber = null, ?string $list = null, ?int $due = null, array $tokens = [], ?string $fromEmail = null): void {
        $to = $this->email($to);
        if (strlen($subject) > 300 || preg_match('/[\r\n]/', $subject)) throw new InvalidArgumentException('subject');
        $this->q("INSERT OR IGNORE INTO queue(id,kind,owner_id,subscriber_id,list_id,to_email,reply_to,subject,body_html,body_text,status,due_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,'pending',?,?)", [$this->id(), $kind, $owner, $subscriber, $list, $to, $reply, $subject, $html, $text, $due ?? time(), time()]);
        $queueId = $this->q('SELECT id FROM queue WHERE kind=? AND owner_id=? AND to_email=?', [$kind, $owner, $to])->fetchColumn();
        $this->q('INSERT OR IGNORE INTO queue_contexts VALUES (?,?,?)', [$queueId, $fromEmail ?? (string)($this->config['smtp']['from'] ?? ''), (int)$this->config['test_mode']]);
        foreach ($tokens as $token) $this->q('INSERT OR IGNORE INTO queue_tokens VALUES (?,?)', [$queueId, hash('sha256', $token)]);
    }

    public function contact(array $request, string $ip): array {
        $language = $this->lang($request['language'] ?? 'ca'); $generic = ['received' => true, 'message' => $this->labels($language)['received']];
        if (!$this->storage->rate('contact', $ip) || !empty($request['website'])) return $generic;
        $formId = $this->key($request['form_id'] ?? null);
        $row = $this->q('SELECT * FROM forms WHERE id=?', [$formId])->fetch();
        if (!$row) throw new InvalidArgumentException('form_unavailable');
        $form = json_decode($row['definition'], true, 64, JSON_THROW_ON_ERROR);
        if (($form['enabled'] ?? true) !== true || (int)($request['revision'] ?? 0) !== (int)$row['revision']) throw new InvalidArgumentException('form_changed');
        $private = json_decode($row['delivery'], true, 64, JSON_THROW_ON_ERROR);
        $requestId = $request['_request_id'] ?? $request['idempotency_key'] ?? '';
        if ($requestId === '') {
            // Static forms also work without JavaScript. The private-keyed fallback
            // collapses identical posts from one address within a ten-minute bucket.
            $this->q("INSERT OR IGNORE INTO metadata VALUES ('replay_key',?)", [bin2hex(random_bytes(32))]);
            $secret = (string)$this->q("SELECT value FROM metadata WHERE key='replay_key'")->fetchColumn();
            $requestId = hash_hmac('sha256', $this->json([$formId, $ip, $request['values'] ?? [], intdiv(time(), 600)]), $secret);
        }
        if (!is_string($requestId) || !preg_match('/^[a-zA-Z0-9_-]{16,128}$/D', $requestId)) throw new InvalidArgumentException('request_id');
        $values = $request['values'] ?? $request; if (!is_array($values)) throw new InvalidArgumentException('values');
        $fields = []; $errors = []; $email = '';
        foreach ($form['fields'] as $field) {
            $id = $field['id']; $value = $values[$id] ?? '';
            if ($field['type'] === 'checkbox') $value = in_array($value, [true, '1', 1, 'on'], true);
            elseif (!is_string($value)) { $errors[$id] = 'invalid'; continue; }
            else $value = trim($value);
            if (($field['required'] ?? false) && ($value === '' || $value === false)) $errors[$id] = 'required';
            if (is_string($value) && preg_match('/[\x00]/', $value)) $errors[$id] = 'invalid';
            if (is_string($value) && mb_strlen($value, 'UTF-8') > (int)($field['max_length'] ?? 5000)) $errors[$id] = 'max_length';
            if (in_array($field['type'], ['select', 'radio'], true) && $value !== '' && !in_array($value, $field['options'] ?? [], true)) $errors[$id] = 'invalid';
            if ($field['type'] === 'email' && $value !== '') { try { $email = $this->email($value); } catch (InvalidArgumentException $e) { $errors[$id] = 'invalid'; } }
            $fields[] = ['id' => $id, 'label' => $this->localized($field['label'] ?? [], $language, $id), 'value' => $value];
        }
        if (($form['require_privacy'] ?? false) && !in_array($request['privacy'] ?? '', ['1', true, 1, 'on'], true)) $errors['privacy'] = 'required';
        if ($errors) throw new SiteValidation($errors);
        $dedup = hash('sha256', $formId.':'.$requestId); $fingerprint = hash('sha256', $this->json([$formId, $row['revision'], $language, $fields, $email]));
        $result = $this->tx(function () use ($row, $form, $formId, $private, $language, $fields, $email, $dedup, $fingerprint) {
            $prior = $this->q('SELECT id,fields,email,language,form_revision FROM messages WHERE dedup_key=?', [$dedup])->fetch();
            if ($prior) {
                $priorFingerprint = hash('sha256', $this->json([$formId, $prior['form_revision'], $prior['language'], json_decode($prior['fields'], true), $prior['email']]));
                if (!hash_equals($priorFingerprint, $fingerprint)) throw new InvalidArgumentException('request_conflict');
                return ['id' => $prior['id']];
            }
            $id = $this->id();
            $this->q("INSERT INTO messages VALUES (?,?,?,?,?,?,?,'new',?)", [$id, $formId, $row['revision'], $language, $this->json($fields), $email, time(), $dedup]);
            $text = implode("\n\n", array_map(fn($f) => $f['label'].': '.(is_bool($f['value']) ? ($f['value'] ? '✓' : '—') : $f['value']), $fields));
            $html = '<div>'.nl2br($this->escape($text)).'</div>';
            foreach (($private['recipients'] ?? []) as $to) $this->queue('contact', $id, $to, $private['subject'] ?? 'Contact', $html, $text, $email);
            if (($private['autoresponse'] ?? false) === true && $email !== '') {
                $reply = $this->localized($private['autoresponse_text'] ?? [], $language, $this->labels($language)['received']);
                $this->queue('autoresponse', $id, $email, $private['subject'] ?? 'Contact', '<p>'.nl2br($this->escape($reply)).'</p>', $reply);
            }
            return ['id' => $id];
        });
        if (!empty($form['newsletter_list']) && in_array($request['newsletter_opt_in'] ?? '', ['1', true, 1, 'on'], true)) {
            try { $this->subscribe(['email' => $email, 'language' => $language, 'list_id' => $form['newsletter_list'], 'consent' => '1'], 'contact:'.$ip); $result['newsletter_received'] = true; }
            catch (Throwable $error) { $result['newsletter_received'] = false; }
        }
        return array_merge($generic, $result, ['message' => $this->localized($form['confirmation'] ?? [], $language, $generic['message']), 'redirect_path' => $this->redirect((string)($form['redirect_path'] ?? ''))]);
    }

    private function token(int $subscriber, string $kind, string $list, ?int $notBefore = null): string {
        $token = bin2hex(random_bytes(32));
        $this->q('INSERT INTO tokens VALUES (?,?,?,?,?,NULL)', [hash('sha256', $token), $subscriber, $kind, $list, max(time(), $notBefore ?? 0) + ($kind === 'confirm' ? 86400 : 7776000)]); return $token;
    }
    private function tokenLink(string $kind, string $token, string $language): string { return rtrim($this->config['public_base_url'], '/').'/api/newsletter.php?action='.$kind.'&token='.$token.'&language='.rawurlencode($language); }

    private function stronglySuppressed(int $subscriber, ?string $list = null): bool {
        if ($this->q("SELECT s.id FROM subscribers s LEFT JOIN suppressions x ON x.email=s.email WHERE s.id=? AND (s.status='suppressed' OR x.reason='suppressed')", [$subscriber])->fetchColumn()) return true;
        return $list !== null && $this->q("SELECT status FROM memberships WHERE subscriber_id=? AND list_id=?", [$subscriber, $list])->fetchColumn() === 'suppressed';
    }

    /** Caller holds the immediate transaction; stronger restrictions are monotonic. */
    private function restrictSubscriber(int $subscriber, string $email, string $state, ?string $list = null): void {
        if (!in_array($state, ['unsubscribed', 'suppressed'], true)) throw new InvalidArgumentException('status');
        if ($this->stronglySuppressed($subscriber, $list) && $state !== 'suppressed') throw new InvalidArgumentException('suppression_requires_review');
        if ($list === null) {
            $this->q('UPDATE subscribers SET status=?,revision=revision+1,updated_at=? WHERE id=?', [$state, time(), $subscriber]);
            $this->q("UPDATE memberships SET status=CASE WHEN status='suppressed' THEN status ELSE ? END WHERE subscriber_id=?", [$state, $subscriber]);
            $this->q("INSERT INTO suppressions VALUES (?,?,?) ON CONFLICT(email) DO UPDATE SET reason=CASE WHEN suppressions.reason='suppressed' THEN suppressions.reason ELSE excluded.reason END,created_at=excluded.created_at", [$email, $state, time()]);
        } else {
            $this->q('UPDATE memberships SET status=? WHERE subscriber_id=? AND list_id=?', [$state, $subscriber, $list]);
            $this->q('UPDATE subscribers SET revision=revision+1,updated_at=? WHERE id=?', [time(), $subscriber]);
        }
        $scope = $list === null ? '' : ' AND list_id=?'; $args = $list === null ? [$subscriber] : [$subscriber, $list];
        $this->q('DELETE FROM subscription_requests WHERE confirmed_at IS NULL AND token_hash IN (SELECT hash FROM tokens WHERE subscriber_id=?'.$scope.')', $args);
        $this->q('UPDATE tokens SET used_at=? WHERE used_at IS NULL AND subscriber_id=?'.$scope, array_merge([time()], $args));
        // A later resubscription must not revive a previously cancelled backlog.
        $this->q("UPDATE queue SET status='suppressed',error_code='subscription_revoked',updated_at=? WHERE status='pending' AND kind IN ('confirmation','campaign') AND (subscriber_id=? OR (kind='confirmation' AND owner_id IN (SELECT hash FROM tokens WHERE subscriber_id=?)))".($list === null ? '' : ' AND list_id=?'), $list === null ? [time(), $subscriber, $subscriber] : [time(), $subscriber, $subscriber, $list]);
    }

    public function subscribe(array $request, string $ip): array {
        if (!$this->storage->rate('subscribe', $ip) || !empty($request['website']) || !in_array($request['consent'] ?? '', ['1', true, 1, 'on'], true)) return ['received' => true];
        try { $email = $this->email($request['email'] ?? ''); $lang = $this->lang($request['language'] ?? 'ca'); $list = $this->key($request['list_id'] ?? 'main'); $interests = $this->interests($request['interests'] ?? []); }
        catch (InvalidArgumentException $e) { return ['received' => true]; }
        $this->tx(function () use ($email, $lang, $list, $interests) {
            $existing = $this->q('SELECT * FROM subscribers WHERE email=?', [$email])->fetch();
            if ($this->q('SELECT reason FROM suppressions WHERE email=?', [$email])->fetchColumn() === 'suppressed') return;
            if ($existing && $this->stronglySuppressed((int)$existing['id'], $list)) return;
            if ($existing && $this->q("SELECT status FROM memberships WHERE subscriber_id=? AND list_id=?", [$existing['id'], $list])->fetchColumn() === 'active') return;
            $now = time();
            // An unconfirmed request must not alter an existing profile or consent,
            // including its eligibility for already reviewed campaigns.
            $this->q("INSERT OR IGNORE INTO subscribers(email,language,status,interests,consent_at,consent_revision,updated_at) VALUES (?,?,'pending','[]',0,'',?)", [$email, $lang, $now]);
            $id = (int)$this->q('SELECT id FROM subscribers WHERE email=?', [$email])->fetchColumn();
            $this->q("INSERT INTO memberships VALUES (?,?,'pending') ON CONFLICT(subscriber_id,list_id) DO UPDATE SET status='pending'", [$id, $list]);
            $this->q("UPDATE tokens SET used_at=? WHERE subscriber_id=? AND kind='confirm' AND list_id=? AND used_at IS NULL", [$now, $id, $list]);
            $token = $this->token($id, 'confirm', $list); $unsubscribe = $this->token($id, 'unsubscribe', '*');
            $this->q('INSERT INTO subscription_requests VALUES (?,?,?,?,?,NULL)', [hash('sha256', $token), $lang, $this->json($interests), $now, 'webs-v1']);
            $labels = $this->labels($lang); $url = $this->tokenLink('confirm', $token, $lang); $off = $this->tokenLink('unsubscribe', $unsubscribe, $lang);
            $body = '<p><a href="'.$this->escape($url).'">'.$this->escape($labels['confirm']).'</a></p><p><a href="'.$this->escape($off).'">'.$this->escape($labels['unsubscribe']).'</a></p>';
            $this->queue('confirmation', hash('sha256', $token), $email, $labels['confirm'], $body, $labels['confirm']."\n".$url."\n".$labels['unsubscribe']."\n".$off, '', $id, $list, null, [$token, $unsubscribe]);
        });
        return ['received' => true];
    }

    public function applyToken(array $request): array {
        $kind = $request['action'] ?? ''; $token = $request['token'] ?? '';
        if (!in_array($kind, ['confirm', 'unsubscribe', 'preferences'], true) || !is_string($token) || !preg_match('/^[a-f0-9]{64}$/D', $token)) return ['received' => true];
        $this->tx(function () use ($kind, $token, $request) {
            $row = $this->q('SELECT t.*,s.email FROM tokens t JOIN subscribers s ON s.id=t.subscriber_id WHERE hash=? AND kind=? AND used_at IS NULL AND expires_at>=?', [hash('sha256', $token), $kind, time()])->fetch();
            if (!$row) return;
            $id = (int)$row['subscriber_id'];
            // Old links cannot downgrade administrative suppression, even for
            // databases created before token revocation was enforced.
            if ($this->stronglySuppressed($id, $row['list_id'] === '*' ? null : $row['list_id'])) return;
            if ($kind === 'confirm') {
                if ($this->q('SELECT status FROM memberships WHERE subscriber_id=? AND list_id=?', [$id, $row['list_id']])->fetchColumn() !== 'pending') return;
                $this->q("DELETE FROM suppressions WHERE email=? AND reason!='suppressed'", [$row['email']]);
                $this->q("UPDATE memberships SET status='active' WHERE subscriber_id=? AND list_id=? AND status='pending'", [$id, $row['list_id']]);
                $pending = $this->q('SELECT * FROM subscription_requests WHERE token_hash=?', [$row['hash']])->fetch();
                if ($pending) {
                    // Preserve the previously effective consent before installing
                    // changes explicitly confirmed by the email-address owner.
                    $this->q("INSERT OR IGNORE INTO consent_history(subscriber_id,list_id,language,interests,consent_at,consent_revision,confirmed_at) SELECT id,'*',language,interests,consent_at,consent_revision,updated_at FROM subscribers WHERE id=? AND consent_at>0 AND consent_revision!=''", [$id]);
                    $this->q('INSERT OR IGNORE INTO consent_history(subscriber_id,list_id,language,interests,consent_at,consent_revision,confirmed_at) VALUES (?,?,?,?,?,?,?)', [$id, $row['list_id'], $pending['language'], $pending['interests'], $pending['consent_at'], $pending['consent_revision'], time()]);
                    $this->q("UPDATE subscribers SET status='active',language=?,interests=?,consent_at=?,consent_revision=?,revision=revision+1,updated_at=? WHERE id=?", [$pending['language'], $pending['interests'], $pending['consent_at'], $pending['consent_revision'], time(), $id]);
                    $this->q('UPDATE subscription_requests SET confirmed_at=? WHERE token_hash=?', [time(), $row['hash']]);
                } else {
                    // Pre-migration confirmation links retain their existing data.
                    $this->q("UPDATE subscribers SET status='active',revision=revision+1,updated_at=? WHERE id=?", [time(), $id]);
                }
            } elseif ($kind === 'unsubscribe') {
                $list = $row['list_id'];
                $this->restrictSubscriber($id, $row['email'], 'unsubscribed', $list === '*' ? null : $list);
            } else {
                $language = $this->lang($request['language'] ?? 'ca'); $interests = $this->interests($request['interests'] ?? []);
                $this->q('UPDATE subscribers SET language=?,interests=?,revision=revision+1,updated_at=? WHERE id=?', [$language, $this->json($interests), time(), $id]);
            }
            $this->q('UPDATE tokens SET used_at=? WHERE hash=?', [time(), $row['hash']]);
        });
        return ['received' => true];
    }

    private function safeHtml(string $html): string {
        if (strlen($html) > 200000) throw new InvalidArgumentException('body_length');
        $document = new DOMDocument('1.0', 'UTF-8'); $previous = libxml_use_internal_errors(true);
        try { $document->loadHTML('<?xml encoding="UTF-8"><div id="gnosi-mail">'.$html.'</div>', LIBXML_NONET | LIBXML_NOERROR | LIBXML_NOWARNING); }
        finally { libxml_clear_errors(); libxml_use_internal_errors($previous); }
        $root = $document->getElementById('gnosi-mail'); if (!$root) return '';
        $walk = function (DOMNode $node) use (&$walk): void {
            foreach (iterator_to_array($node->childNodes) as $child) {
                if ($child instanceof DOMElement) {
                    $tag = strtolower($child->tagName);
                    if (in_array($tag, ['script', 'style', 'iframe', 'object', 'svg', 'math', 'form', 'input', 'img'], true)) { $node->removeChild($child); continue; }
                    $walk($child);
                    if (!in_array($tag, ['p', 'br', 'strong', 'b', 'em', 'i', 'ul', 'ol', 'li', 'h1', 'h2', 'h3', 'blockquote', 'a', 'hr'], true)) {
                        while ($child->firstChild) $node->insertBefore($child->firstChild, $child);
                        $node->removeChild($child); continue;
                    }
                    foreach (iterator_to_array($child->attributes) as $attribute) {
                        $allowed = $tag === 'a' && $attribute->name === 'href' && preg_match('#^(https?://|mailto:)#i', $attribute->value) && !preg_match('/[\x00-\x20]/', $attribute->value);
                        if (!$allowed) $child->removeAttributeNode($attribute);
                    }
                } elseif (!($child instanceof DOMText)) $node->removeChild($child);
            }
        };
        $walk($root); $result = ''; foreach ($root->childNodes as $node) $result .= $document->saveHTML($node); return $result;
    }
    private function emailTemplate(string $html): string {
        $theme = $this->config['email_theme'] ?? []; $color = $theme['primary'] ?? '#264653'; $background = $theme['background'] ?? '#F5EFE7';
        if (!preg_match('/^#[a-f0-9]{6}$/iD', $color)) $color = '#264653';
        if (!preg_match('/^#[a-f0-9]{6}$/iD', $background)) $background = '#F5EFE7';
        return '<!doctype html><html><body style="margin:0;background:'.$background.';color:'.$color.';font-family:Arial,sans-serif"><main style="max-width:640px;margin:0 auto;padding:24px;background:#ffffff">'.$html.'</main></body></html>';
    }
    private function text(string $html): string { return trim(html_entity_decode(strip_tags(preg_replace('#</(?:p|li|h[1-3]|blockquote)>|<br\s*/?>#i', "\n", $html) ?? ''), ENT_QUOTES | ENT_HTML5, 'UTF-8')); }
    private function audience(string $language, string $list, array $interests): array {
        $rows = $this->q("SELECT s.id,s.email,s.language,s.interests,s.consent_at,s.consent_revision,s.revision FROM subscribers s JOIN memberships m ON m.subscriber_id=s.id LEFT JOIN suppressions x ON x.email=s.email WHERE s.status='active' AND m.status='active' AND m.list_id=? AND s.language=? AND x.email IS NULL ORDER BY s.id", [$list, $language])->fetchAll();
        return array_values(array_filter($rows, fn($row) => !$interests || (bool)array_intersect($interests, json_decode($row['interests'], true))));
    }

    private function campaignPreview(array $request): array {
        $language = $this->lang($request['language'] ?? 'ca'); $list = $this->key($request['list_id'] ?? 'main'); $interests = $this->interests($request['interests'] ?? []);
        $subject = trim((string)($request['subject'] ?? ''));
        if ($subject === '' || strlen($subject) > 300 || preg_match('/[\r\n]/', $subject)) throw new InvalidArgumentException('subject');
        $html = $this->safeHtml((string)($request['body_html'] ?? '')); $text = (string)($request['body_text'] ?? $this->text($html));
        if (strlen($text) > 200000) throw new InvalidArgumentException('body_length');
        return $this->tx(function () use ($language, $list, $interests, $subject, $html, $text) {
            $audience = $this->audience($language, $list, $interests); foreach ($audience as $row) $this->email($row['email']);
            $id = $this->id(); $expires = time() + 900;
            $this->q('INSERT INTO previews VALUES (?,?,?,?,?,?,?,?,?,NULL)', [$id, $subject, $html, $text, $language, $list, $this->json($interests), $this->json($audience), $expires]);
            $rendered = $this->emailTemplate($html); $sender = (string)($this->config['smtp']['from'] ?? '');
            $this->q('INSERT INTO preview_contexts VALUES (?,?,?,?,?)', [$id, $rendered, $sender, (int)$this->config['test_mode'], $this->config['public_base_url']]);
            return ['preview_id' => $id, 'subject' => $subject, 'body_html' => $rendered, 'body_text' => $text, 'from_email' => $sender, 'recipient_count' => count($audience), 'expires_at' => gmdate('c', $expires), 'test_mode' => $this->config['test_mode']];
        });
    }
    private function campaignQueue(array $request): array {
        return $this->tx(function () use ($request) {
            $preview = $this->q('SELECT * FROM previews WHERE id=?', [(string)($request['preview_id'] ?? '')])->fetch();
            if (!$preview) throw new InvalidArgumentException('preview_unavailable');
            if ($preview['campaign_id']) return ['campaign_id' => $preview['campaign_id'], 'queued' => (int)$this->q('SELECT COUNT(*) FROM queue WHERE owner_id=?', [$preview['campaign_id']])->fetchColumn(), 'status' => 'queued', 'test_mode' => $this->config['test_mode']];
            if ((int)$preview['expires_at'] < time()) throw new InvalidArgumentException('preview_expired');
            $context = $this->q('SELECT * FROM preview_contexts WHERE preview_id=?', [$preview['id']])->fetch();
            if (!$context || (bool)$context['test_mode'] !== $this->config['test_mode'] || $context['public_base_url'] !== $this->config['public_base_url']) throw new InvalidArgumentException('preview_context_changed');
            $audience = $this->audience($preview['language'], $preview['list_id'], json_decode($preview['interests'], true));
            if (!hash_equals(hash('sha256', $preview['audience']), hash('sha256', $this->json($audience)))) throw new InvalidArgumentException('audience_changed');
            $due = time(); if (!empty($request['scheduled_at'])) { $parsed = strtotime((string)$request['scheduled_at']); if ($parsed === false || $parsed < $due - 60) throw new InvalidArgumentException('schedule'); $due = max($due, $parsed); }
            $id = $preview['id'];
            $this->q("INSERT INTO campaigns VALUES (?,?,?,?,?,?,'queued',?,?,?,0)", [$id, $preview['subject'], $preview['body_html'], $preview['body_text'], $preview['language'], $preview['list_id'], count($audience), time(), $due]);
            foreach ($audience as $recipient) {
                $token = $this->token((int)$recipient['id'], 'unsubscribe', $preview['list_id'], $due); $global = $this->token((int)$recipient['id'], 'unsubscribe', '*', $due); $prefs = $this->token((int)$recipient['id'], 'preferences', $preview['list_id'], $due);
                $labels = $this->labels($recipient['language']); $off = $this->tokenLink('unsubscribe', $token, $recipient['language']); $all = $this->tokenLink('unsubscribe', $global, $recipient['language']); $preferences = $this->tokenLink('preferences', $prefs, $recipient['language']);
                $footer = '<hr><p><a href="'.$this->escape($off).'">'.$this->escape($labels['unsubscribe']).'</a> · <a href="'.$this->escape($all).'">'.$this->escape($labels['unsubscribe']).' (all)</a> · <a href="'.$this->escape($preferences).'">'.$this->escape($labels['preferences']).'</a></p>';
                $rendered = str_replace('</main>', $footer.'</main>', $context['rendered_html']);
                $this->queue('campaign', $id, $recipient['email'], $preview['subject'], $rendered, $preview['body_text']."\n\n".$labels['unsubscribe'].': '.$off."\n".$labels['unsubscribe'].' (all): '.$all."\n".$labels['preferences'].': '.$preferences, '', (int)$recipient['id'], $preview['list_id'], $due, [$token, $global, $prefs], $context['from_email']);
            }
            $this->q('UPDATE previews SET campaign_id=? WHERE id=?', [$id, $preview['id']]);
            return ['campaign_id' => $id, 'queued' => count($audience), 'status' => 'queued', 'test_mode' => $this->config['test_mode']];
        });
    }

    private function capture(array $message): void {
        if (!self::synthetic($message['to_email'])) throw new SiteSmtpFailure('rejected', 'synthetic_destination_required');
        $path = $this->config['spool_path'].'/'.$message['id'].'.json';
        if (is_file($path)) return;
        $file = tempnam($this->config['spool_path'], '.capture-'); if (!$file) throw new RuntimeException('Capture unavailable');
        try {
            chmod($file, 0600);
            $data = $this->json(['test_mode' => true, 'id' => $message['id'], 'kind' => $message['kind'], 'to' => $message['to_email'], 'from_email' => $message['from_email'] ?? '', 'reply_to' => $message['reply_to'], 'subject' => $message['subject'], 'body_html' => $message['body_html'], 'body_text' => $message['body_text'], 'captured_at' => gmdate('c')]);
            if (file_put_contents($file, $data) === false || !rename($file, $path)) throw new RuntimeException('Capture unavailable');
        } finally { if (is_file($file)) unlink($file); }
    }

    private function refreshDeliveryTokens(array $message): void {
        if (!in_array($message['kind'], ['campaign', 'confirmation'], true)) return;
        $this->tx(function () use ($message) {
            // Older queued messages predate the explicit mapping. Their private
            // bodies retain the same random tokens; backfill without rotating them.
            if (!(int)$this->q('SELECT COUNT(*) FROM queue_tokens WHERE queue_id=?', [$message['id']])->fetchColumn()) {
                preg_match_all('/(?:[?&]|&amp;)token=([a-f0-9]{64})\b/', $message['body_html'].' '.$message['body_text'], $matches);
                $subscriber = $message['subscriber_id'];
                if (!$subscriber && $message['kind'] === 'confirmation') $subscriber = $this->q("SELECT subscriber_id FROM tokens WHERE hash=? AND kind='confirm'", [$message['owner_id']])->fetchColumn();
                if ($subscriber) foreach (array_unique($matches[1]) as $token) $this->q('INSERT OR IGNORE INTO queue_tokens SELECT ?,hash FROM tokens WHERE hash=? AND subscriber_id=?', [$message['id'], hash('sha256', $token), $subscriber]);
            }
            // Scheduling, pausing and delivery backlogs must not consume link
            // validity before delivery. Used tokens remain permanently used.
            $this->q("UPDATE tokens SET expires_at=MAX(expires_at,? + CASE kind WHEN 'confirm' THEN 86400 ELSE 7776000 END) WHERE used_at IS NULL AND hash IN (SELECT token_hash FROM queue_tokens WHERE queue_id=?)", [time(), $message['id']]);
        });
    }

    private function worker(array $request): array {
        $limit = min(100, max(1, (int)($request['limit'] ?? 20))); $stats = ['processed' => 0, 'accepted' => 0, 'rejected' => 0, 'uncertain' => 0, 'captured' => 0, 'suppressed' => 0, 'pending' => 0];
        $lock = fopen($this->config['spool_path'].'/.worker.lock', 'c'); if (!$lock || !flock($lock, LOCK_EX | LOCK_NB)) { if ($lock) fclose($lock); return $stats + ['busy' => true]; }
        try {
            // The lock proves no other worker can still own a previously claimed row.
            $this->q("UPDATE queue SET status='uncertain',error_code='worker_interrupted',updated_at=? WHERE status='sending'", [time()]);
            $perMinute = min(100, max(1, (int)($this->config['smtp']['per_minute'] ?? 20)));
            $recent = (int)$this->q("SELECT COUNT(*) FROM queue WHERE started_at>=? AND status IN ('accepted','captured','uncertain')", [time() - 60])->fetchColumn();
            $limit = min($limit, max(0, $perMinute - $recent));
            for ($i = 0; $i < $limit; $i++) {
                if (is_file($this->config['spool_path'].'/.daemon-stop')) break;
                $row = $this->tx(function () {
                    $row = $this->q("SELECT q.* FROM queue q LEFT JOIN campaigns c ON q.kind='campaign' AND c.id=q.owner_id WHERE q.status='pending' AND q.due_at<=? AND (q.kind!='campaign' OR c.paused=0) ORDER BY q.due_at,q.id LIMIT 1", [time()])->fetch();
                    if (!$row) return null;
                    $suppressed = false;
                    if ($row['kind'] === 'campaign') $suppressed = !$this->q("SELECT s.id FROM subscribers s JOIN memberships m ON s.id=m.subscriber_id LEFT JOIN suppressions x ON x.email=s.email WHERE s.id=? AND s.status='active' AND m.list_id=? AND m.status='active' AND x.email IS NULL", [$row['subscriber_id'], $row['list_id']])->fetchColumn();
                    elseif ($row['kind'] === 'confirmation') {
                        $subscriber = $this->q("SELECT t.subscriber_id FROM tokens t JOIN memberships m ON m.subscriber_id=t.subscriber_id AND m.list_id=t.list_id WHERE t.hash=? AND t.kind='confirm' AND t.used_at IS NULL AND m.status='pending'", [$row['owner_id']])->fetchColumn();
                        $suppressed = !$subscriber || $this->stronglySuppressed((int)$subscriber, $row['list_id']);
                    }
                    $state = $suppressed ? 'suppressed' : 'sending';
                    $this->q('UPDATE queue SET status=?,started_at=?,updated_at=?,attempts=attempts+1 WHERE id=?', [$state, time(), time(), $row['id']]);
                    $row['status'] = $state; return $row;
                });
                if (!$row) break;
                $stats['processed']++;
                if ($row['status'] === 'suppressed') { $stats['suppressed']++; continue; }
                $state = 'pending'; $error = '';
                try {
                    $context = $this->q('SELECT * FROM queue_contexts WHERE queue_id=?', [$row['id']])->fetch();
                    if (($context && (bool)$context['test_mode'] !== $this->config['test_mode']) || (!$context && !$this->config['test_mode'])) throw new SiteSmtpFailure('rejected', 'delivery_context_changed');
                    $row['from_email'] = $context['from_email'] ?? (string)($this->config['smtp']['from'] ?? '');
                    $this->refreshDeliveryTokens($row);
                    if ($this->config['test_mode']) { $this->capture($row); $state = 'captured'; }
                    else {
                        if (($this->config['allow_delivery'] ?? false) !== true) throw new SiteSmtpFailure('rejected', 'delivery_disabled');
                        $smtp = $this->config['smtp'] ?? []; $smtp['from'] = $row['from_email'];
                        (new SiteSmtp($smtp))->send($row); $state = 'accepted';
                    }
                    $this->refreshDeliveryTokens($row);
                } catch (SiteSmtpFailure $e) { $state = $e->deliveryState; $error = $e->getMessage(); }
                catch (Throwable $e) { $state = $this->config['test_mode'] ? 'pending' : 'uncertain'; $error = 'transport_unavailable'; }
                $this->q('UPDATE queue SET status=?,error_code=?,due_at=?,updated_at=? WHERE id=?', [$state, $error, time() + 300, time(), $row['id']]);
                $stats[$state]++;
            }
            foreach ($this->q("SELECT id FROM campaigns WHERE status='queued'")->fetchAll() as $campaign) {
                if (!(int)$this->q("SELECT COUNT(*) FROM queue WHERE owner_id=? AND kind='campaign' AND status IN ('pending','sending','uncertain')", [$campaign['id']])->fetchColumn()) $this->q("UPDATE campaigns SET status='completed' WHERE id=?", [$campaign['id']]);
            }
            return $stats;
        } finally { flock($lock, LOCK_UN); fclose($lock); }
    }

    private function listMessages(array $request): array {
        $where = []; $args = [];
        foreach (['form_id', 'status'] as $key) if (!empty($request[$key])) { $where[] = 'm.'.$key.'=?'; $args[] = (string)$request[$key]; }
        if (!empty($request['q'])) { $where[] = '(m.email LIKE ? OR m.fields LIKE ?)'; $args[] = '%'.(string)$request['q'].'%'; $args[] = end($args); }
        $filter = $where ? ' WHERE '.implode(' AND ', $where) : '';
        $total = (int)$this->q('SELECT COUNT(*) FROM messages m'.$filter, $args)->fetchColumn();
        $limit = min(1000, max(1, (int)($request['limit'] ?? 100))); $offset = max(0, (int)($request['offset'] ?? 0));
        $query = $this->q('SELECT m.* FROM messages m'.$filter.' ORDER BY m.created_at DESC,m.id LIMIT '.$limit.' OFFSET '.$offset, $args);
        $rows = []; $bytes = 0;
        while ($row = $query->fetch()) {
            $row['fields'] = json_decode($row['fields'], true); unset($row['dedup_key']); $row['created_at'] = gmdate('c', (int)$row['created_at']);
            $row['notification_status'] = $this->q("SELECT status FROM queue WHERE owner_id=? AND kind='contact' ORDER BY CASE status WHEN 'uncertain' THEN 0 WHEN 'rejected' THEN 1 WHEN 'pending' THEN 2 WHEN 'sending' THEN 3 ELSE 4 END LIMIT 1", [$row['id']])->fetchColumn() ?: 'not_configured';
            $size = strlen($this->json($row)); if ($rows && $bytes + $size > 3000000) break;
            $bytes += $size; $rows[] = $row;
        }
        return ['items' => $rows, 'total' => $total];
    }
    private function listSubscribers(array $request): array {
        $where = []; $args = [];
        foreach (['language', 'status'] as $key) if (!empty($request[$key])) { $where[] = 's.'.$key.'=?'; $args[] = (string)$request[$key]; }
        if (!empty($request['list_id'])) { $where[] = 'EXISTS (SELECT 1 FROM memberships m WHERE m.subscriber_id=s.id AND m.list_id=?)'; $args[] = (string)$request['list_id']; }
        if (!empty($request['q'])) { $where[] = 's.email LIKE ?'; $args[] = '%'.(string)$request['q'].'%'; }
        $filter = $where ? ' WHERE '.implode(' AND ', $where) : '';
        $total = (int)$this->q('SELECT COUNT(*) FROM subscribers s'.$filter, $args)->fetchColumn();
        $limit = min(1000, max(1, (int)($request['limit'] ?? 100))); $offset = max(0, (int)($request['offset'] ?? 0));
        $rows = $this->q('SELECT s.* FROM subscribers s'.$filter.' ORDER BY s.id LIMIT '.$limit.' OFFSET '.$offset, $args)->fetchAll();
        foreach ($rows as &$row) { $row['interests'] = json_decode($row['interests'], true); $row['lists'] = $this->q('SELECT list_id AS id,status FROM memberships WHERE subscriber_id=? ORDER BY list_id', [$row['id']])->fetchAll(); foreach (['consent_at', 'updated_at'] as $key) $row[$key] = gmdate('c', (int)$row[$key]); }
        unset($row); return ['items' => $rows, 'total' => $total];
    }
    private function importSubscribers(array $request): array {
        $items = $request['items'] ?? []; if (!is_array($items) || count($items) > 1000) throw new InvalidArgumentException('items');
        return $this->tx(function () use ($items) {
            $stats = ['imported' => 0, 'skipped' => 0, 'rejected' => 0];
            foreach ($items as $item) {
                try { if (!is_array($item)) throw new InvalidArgumentException('item'); $email = $this->email($item['email'] ?? ''); $language = $this->lang($item['language'] ?? 'ca'); $list = $this->key($item['list_id'] ?? 'main'); $interests = $this->interests($item['interests'] ?? []); }
                catch (InvalidArgumentException $e) { $stats['rejected']++; continue; }
                $existing = $this->q('SELECT * FROM subscribers WHERE email=?', [$email])->fetch();
                $state = in_array($item['status'] ?? '', ['unsubscribed', 'suppressed'], true) ? $item['status'] : 'pending';
                $consent = $item['consent_at'] ?? 0; $consent = is_int($consent) ? $consent : (strtotime((string)$consent) ?: 0); $revision = substr((string)($item['consent_revision'] ?? ''), 0, 100);
                if (($item['status'] ?? '') === 'active' && $consent > 0 && $revision !== '') $state = 'active';
                $reason = $this->q('SELECT reason FROM suppressions WHERE email=?', [$email])->fetchColumn();
                if (($reason === 'suppressed' || ($existing && $this->stronglySuppressed((int)$existing['id']))) && $state !== 'suppressed') { $stats['skipped']++; continue; }
                if ($existing) {
                    // Imports cannot reset existing consent or make inactive memberships active.
                    if ($state === 'pending' || $state === 'active') { $stats['skipped']++; continue; }
                    $id = (int)$existing['id'];
                } else {
                    if ($reason !== false && $state !== 'suppressed') { $stats['skipped']++; continue; }
                    $this->q('INSERT INTO subscribers(email,language,status,interests,consent_at,consent_revision,updated_at) VALUES (?,?,?,?,?,?,?)', [$email, $language, $state, $this->json($interests), $consent, $revision, time()]); $id = (int)$this->storage->db->lastInsertId();
                }
                $this->q("INSERT INTO memberships VALUES (?,?,?) ON CONFLICT(subscriber_id,list_id) DO UPDATE SET status=CASE WHEN memberships.status='suppressed' THEN memberships.status ELSE excluded.status END", [$id, $list, $state]);
                if (in_array($state, ['unsubscribed', 'suppressed'], true)) $this->restrictSubscriber($id, $email, $state);
                $stats['imported']++;
            }
            return $stats;
        });
    }

    private function daemonStatus(): array {
        $path = $this->config['spool_path'].'/daemon-status.json';
        $data = is_file($path) ? json_decode((string)file_get_contents($path, false, null, 0, 16384), true) : [];
        if (!is_array($data)) $data = [];
        $lock = fopen($this->config['spool_path'].'/.daemon.lock', 'c'); $running = false;
        if ($lock) { if (flock($lock, LOCK_EX | LOCK_NB)) flock($lock, LOCK_UN); else $running = true; fclose($lock); }
        return ['running' => $running, 'updated_at' => is_string($data['updated_at'] ?? null) ? $data['updated_at'] : null, 'last_error' => is_string($data['last_error'] ?? null) ? $data['last_error'] : null];
    }

    public function admin(string $action, array $request): array {
        if ($action === 'forms_sync') return $this->syncForms($request['forms'] ?? [], $request['form_delivery'] ?? []);
        if ($action === 'status' || $action === 'newsletter_status') {
            $subscribers = ['pending' => 0, 'active' => 0, 'unsubscribed' => 0, 'suppressed' => 0]; foreach ($this->q('SELECT status,COUNT(*) AS n FROM subscribers GROUP BY status')->fetchAll() as $row) $subscribers[$row['status']] = (int)$row['n'];
            $messages = ['new' => 0, 'read' => 0, 'resolved' => 0, 'spam' => 0]; foreach ($this->q('SELECT status,COUNT(*) AS n FROM messages GROUP BY status')->fetchAll() as $row) $messages[$row['status']] = (int)$row['n'];
            $queue = []; foreach ($this->q('SELECT status,COUNT(*) AS n FROM queue GROUP BY status')->fetchAll() as $row) $queue[$row['status']] = (int)$row['n'];
            return ['schema_version' => 1, 'test_mode' => $this->config['test_mode'], 'site_id' => $this->config['site_id'], 'subscribers' => $subscribers, 'messages' => $messages, 'queue' => $queue, 'campaigns' => $this->campaigns(), 'worker' => $this->daemonStatus()];
        }
        if (in_array($action, ['messages_list', 'messages_export'], true)) return $this->listMessages($request);
        if ($action === 'messages_update') {
            if (!in_array($request['status'] ?? '', ['new', 'read', 'resolved', 'spam'], true)) throw new InvalidArgumentException('status');
            $this->q('UPDATE messages SET status=? WHERE id=?', [$request['status'], $this->key($request['id'] ?? null)]); return ['updated' => true];
        }
        if ($action === 'messages_delete') {
            $ids = $request['ids'] ?? []; if (!is_array($ids) || count($ids) > 1000) throw new InvalidArgumentException('ids');
            $captures = [];
            $result = $this->tx(function () use ($ids, &$captures) { $count = 0; foreach ($ids as $id) { $id = $this->key($id); $captures = array_merge($captures, $this->q("SELECT id FROM queue WHERE owner_id=? AND kind IN ('contact','autoresponse')", [$id])->fetchAll(PDO::FETCH_COLUMN)); $this->q("DELETE FROM queue WHERE owner_id=? AND kind IN ('contact','autoresponse')", [$id]); $count += $this->q('DELETE FROM messages WHERE id=?', [$id])->rowCount(); } return ['deleted' => $count]; });
            foreach ($captures as $id) { $path = $this->config['spool_path'].'/'.$id.'.json'; if (is_file($path)) unlink($path); }
            return $result;
        }
        if (in_array($action, ['subscribers_list', 'subscribers_export'], true)) return $this->listSubscribers($request);
        if ($action === 'subscribers_import') return $this->importSubscribers($request);
        if ($action === 'subscribers_update') return $this->updateSubscriber($request);
        if (in_array($action, ['campaign_preview', 'newsletter_preview'], true)) return $this->campaignPreview($request);
        if (in_array($action, ['campaign_queue', 'newsletter_send'], true)) return $this->campaignQueue($request);
        if ($action === 'campaigns_list') return ['items' => $this->campaigns()];
        if ($action === 'campaign_pause') { $this->q('UPDATE campaigns SET paused=? WHERE id=?', [($request['paused'] ?? true) ? 1 : 0, $this->key($request['id'] ?? null)]); return ['updated' => true]; }
        if ($action === 'worker') return $this->worker($request);
        if ($action === 'reconcile') {
            if (!in_array($request['status'] ?? '', ['accepted', 'rejected', 'pending'], true)) throw new InvalidArgumentException('status');
            $changed = $this->q("UPDATE queue SET status=?,due_at=?,updated_at=?,error_code='' WHERE id=? AND status='uncertain'", [$request['status'], time(), time(), $this->key($request['id'] ?? null)])->rowCount(); return ['updated' => $changed === 1];
        }
        if ($action === 'captured_get') return $this->capturedView($request);
        if ($action === 'captured_apply') return $this->applyCaptured($request);
        if ($action === 'queue_list') {
            $rows = $this->q('SELECT id,kind,owner_id,to_email,status,attempts,due_at,updated_at,error_code FROM queue ORDER BY updated_at DESC LIMIT 1000')->fetchAll(); return ['items' => $rows];
        }
        if ($action === 'retention') {
            $days = (int)($request['days'] ?? 0); if ($days < 0 || $days > 3650) throw new InvalidArgumentException('days');
            $this->q("INSERT INTO metadata VALUES ('retention_days',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", [(string)$days]); return ['days' => $days];
        }
        if ($action === 'maintenance') {
            $days = (int)$this->q("SELECT value FROM metadata WHERE key='retention_days'")->fetchColumn();
            if ($days === 0) return ['deleted' => 0];
            $ids = $this->q('SELECT id FROM messages WHERE created_at<?', [time() - $days * 86400])->fetchAll(PDO::FETCH_COLUMN); return $this->admin('messages_delete', ['ids' => array_slice($ids, 0, 1000)]);
        }
        throw new InvalidArgumentException('unsupported_action');
    }

    private function campaigns(): array {
        $rows = $this->q('SELECT * FROM campaigns ORDER BY created_at DESC,id LIMIT 1000')->fetchAll();
        foreach ($rows as &$row) { unset($row['body_html'], $row['body_text']); $row['created_at'] = gmdate('c', (int)$row['created_at']); $row['scheduled_at'] = gmdate('c', (int)$row['scheduled_at']); $row['paused'] = (bool)$row['paused']; $row['deliveries'] = []; foreach ($this->q("SELECT status,COUNT(*) AS n FROM queue WHERE owner_id=? AND kind='campaign' GROUP BY status", [$row['id']])->fetchAll() as $delivery) $row['deliveries'][$delivery['status']] = (int)$delivery['n']; }
        unset($row); return $rows;
    }
    private function updateSubscriber(array $request): array {
        return $this->tx(function () use ($request) {
            $id = (int)($request['id'] ?? 0); $row = $this->q('SELECT * FROM subscribers WHERE id=?', [$id])->fetch(); if (!$row) throw new InvalidArgumentException('subscriber');
            $lang = isset($request['language']) ? $this->lang($request['language']) : $row['language']; $interests = isset($request['interests']) ? $this->interests($request['interests']) : json_decode($row['interests'], true);
            $list = isset($request['list_id']) ? $this->key($request['list_id']) : null;
            $membership = $list ? $this->q('SELECT status FROM memberships WHERE subscriber_id=? AND list_id=?', [$id, $list])->fetchColumn() : null;
            if ($list && $membership === false) throw new InvalidArgumentException('membership');
            $state = $request['status'] ?? ($list ? $membership : $row['status']); if (!in_array($state, ['pending', 'active', 'unsubscribed', 'suppressed'], true)) throw new InvalidArgumentException('status');
            if ($this->stronglySuppressed($id, $list) && $state !== 'suppressed') throw new InvalidArgumentException('suppression_requires_review');
            if ($state === 'active' && ($row['status'] !== 'active' || ($list && $membership !== 'active'))) throw new InvalidArgumentException('confirmation_required');
            if (in_array($state, ['unsubscribed', 'suppressed'], true)) {
                $this->q('UPDATE subscribers SET language=?,interests=? WHERE id=?', [$lang, $this->json($interests), $id]);
                $this->restrictSubscriber($id, $row['email'], $state, $list);
            } else {
                $globalState = $list ? $row['status'] : $state;
                $this->q('UPDATE subscribers SET language=?,interests=?,status=?,revision=revision+1,updated_at=? WHERE id=?', [$lang, $this->json($interests), $globalState, time(), $id]);
                if ($list) $this->q('UPDATE memberships SET status=? WHERE subscriber_id=? AND list_id=?', [$state, $id, $list]);
            }
            return ['updated' => true];
        });
    }
}
