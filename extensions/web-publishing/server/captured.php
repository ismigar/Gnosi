<?php
declare(strict_types=1);

/** Administrator-only access to synthetic mail; never part of a public handler. */
trait SiteCapturedMail {
    private function capturedMail(mixed $id): array {
        if ($this->config['test_mode'] !== true || !empty($this->config['allow_delivery']) || !empty($this->config['smtp']['allow_delivery'])) throw new InvalidArgumentException('test_capture_required');
        if (!is_string($id) || !preg_match('/^[a-f0-9]{32}$/D', $id)) throw new InvalidArgumentException('capture_unavailable');
        $row = $this->q("SELECT * FROM queue WHERE id=? AND status='captured'", [$id])->fetch();
        if (!$row || !self::synthetic($row['to_email'])) throw new InvalidArgumentException('capture_unavailable');
        $directory = realpath($this->config['spool_path']);
        if (!$directory) throw new InvalidArgumentException('capture_unavailable');
        $path = $directory.'/'.$id.'.json'; clearstatcache(true, $path);
        $before = @lstat($path);
        if (!$before || is_link($path) || !is_file($path) || $before['size'] > 1000000) throw new InvalidArgumentException('capture_unavailable');
        $stream = @fopen($path, 'rb');
        if (!$stream) throw new InvalidArgumentException('capture_unavailable');
        try {
            $opened = fstat($stream); $raw = stream_get_contents($stream, 1000001);
            clearstatcache(true, $path); $after = @lstat($path);
            if (!$opened || !$after || is_link($path) || $opened['ino'] !== $before['ino'] || $opened['dev'] !== $before['dev'] || $after['ino'] !== $opened['ino'] || $after['dev'] !== $opened['dev'] || $raw === false || strlen($raw) > 1000000) throw new InvalidArgumentException('capture_unavailable');
        } finally { fclose($stream); }
        $mail = json_decode($raw, true, 32, JSON_THROW_ON_ERROR);
        if (!is_array($mail) || ($mail['test_mode'] ?? null) !== true || ($mail['id'] ?? null) !== $id || ($mail['to'] ?? null) !== $row['to_email'] || ($mail['kind'] ?? null) !== $row['kind']) throw new InvalidArgumentException('capture_unavailable');
        foreach (['subject', 'body_html', 'body_text'] as $field) if (!is_string($mail[$field] ?? null) || strlen($mail[$field]) > 400000) throw new InvalidArgumentException('capture_unavailable');
        $links = []; $subscriber = null;
        if (in_array($row['kind'], ['confirmation', 'campaign'], true) && $row['subscriber_id']) {
            $profile = $this->q('SELECT language,interests,email FROM subscribers WHERE id=?', [$row['subscriber_id']])->fetch();
            if ($profile && $profile['email'] === $row['to_email']) {
                $subscriber = ['language' => $profile['language'], 'interests' => json_decode($profile['interests'], true)];
                $endpoint = rtrim($this->config['public_base_url'], '/').'/api/newsletter.php'; $base = parse_url($endpoint);
                preg_match_all('~https?://[^\s<>"\']+~', html_entity_decode($mail['body_text'].' '.$mail['body_html'], ENT_QUOTES | ENT_HTML5, 'UTF-8'), $matches);
                foreach (array_unique($matches[0]) as $url) {
                    $parts = parse_url($url);
                    if (!$parts || isset($parts['user']) || isset($parts['pass']) || isset($parts['fragment']) || ($parts['scheme'] ?? '') !== $base['scheme'] || ($parts['host'] ?? '') !== $base['host'] || ($parts['port'] ?? null) !== ($base['port'] ?? null) || ($parts['path'] ?? '') !== $base['path']) continue;
                    parse_str($parts['query'] ?? '', $query);
                    if (count($query) !== 3 || !in_array($query['action'] ?? '', ['confirm', 'preferences', 'unsubscribe'], true) || !is_string($query['token'] ?? null) || !preg_match('/^[a-f0-9]{64}$/D', $query['token']) || !is_string($query['language'] ?? null) || !in_array($query['language'], $this->config['languages'] ?? ['ca', 'es', 'en-gb', 'fr'], true)) continue;
                    $token = $this->q('SELECT t.* FROM tokens t JOIN queue_tokens qt ON qt.token_hash=t.hash WHERE qt.queue_id=? AND t.hash=? AND t.subscriber_id=? AND t.kind=?', [$id, hash('sha256', $query['token']), $row['subscriber_id'], $query['action']])->fetch();
                    if (!$token) continue;
                    $state = $token['used_at'] !== null ? 'used' : ((int)$token['expires_at'] < time() ? 'expired' : 'ready');
                    if ($state === 'ready' && $this->stronglySuppressed((int)$row['subscriber_id'], $token['list_id'] === '*' ? null : $token['list_id'])) $state = 'unavailable';
                    $links[] = ['index' => count($links), 'action' => $query['action'], 'url' => $this->tokenLink($query['action'], $query['token'], $query['language']), 'language' => $query['language'], 'list_id' => $token['list_id'], 'state' => $state, 'token' => $query['token']];
                }
            }
        }
        return ['test_mode' => true, 'id' => $id, 'kind' => $row['kind'], 'to_email' => $row['to_email'], 'from_email' => (string)($mail['from_email'] ?? ''), 'reply_to' => (string)($mail['reply_to'] ?? ''), 'subject' => $mail['subject'], 'created_at' => gmdate('c', (int)$row['updated_at']), 'body_html' => $mail['body_html'], 'body_text' => $mail['body_text'], 'subscriber' => $subscriber, 'links' => $links];
    }

    private function capturedView(array $request): array {
        $mail = $this->capturedMail($request['id'] ?? null);
        foreach ($mail['links'] as &$link) unset($link['token']); unset($link);
        return $mail;
    }

    private function applyCaptured(array $request): array {
        $mail = $this->capturedMail($request['id'] ?? null);
        $index = $request['link_index'] ?? null;
        if (!is_int($index) || !isset($mail['links'][$index])) throw new InvalidArgumentException('capture_link_unavailable');
        $link = $mail['links'][$index];
        if ($link['state'] !== 'ready') return array_merge($this->capturedView($request), ['action_applied' => false]);
        $values = ['action' => $link['action'], 'token' => $link['token'], 'language' => $link['language']];
        if ($link['action'] === 'preferences') {
            $values['language'] = $this->lang($request['language'] ?? null);
            $values['interests'] = $this->interests($request['interests'] ?? []);
        }
        // This is exactly the token operation used by the public POST handler.
        $this->applyToken($values);
        $fresh = $this->capturedView($request);
        return array_merge($fresh, ['action_applied' => ($fresh['links'][$index]['state'] ?? '') === 'used']);
    }
}
