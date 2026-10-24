<?php
declare(strict_types=1);
require_once __DIR__.'/library.php';
function check(bool $condition, string $message): void { if (!$condition) throw new RuntimeException($message); }
function fails(callable $fn, string $expected): void { try { $fn(); } catch (InvalidArgumentException $e) { check($e->getMessage() === $expected, 'Expected '.$expected.' got '.$e->getMessage()); return; } throw new RuntimeException('Expected '.$expected); }
function removeTree(string $path): void { if (is_dir($path)) { foreach (scandir($path) as $name) if ($name !== '.' && $name !== '..') removeTree($path.'/'.$name); rmdir($path); } elseif (is_file($path)) unlink($path); }
function fixtureToken(PDO $db, int $subscriber, string $kind, string $list): string {
    $token = bin2hex(random_bytes(32)); $insert = $db->prepare('INSERT INTO tokens VALUES (?,?,?,?,?,NULL)'); $insert->execute([hash('sha256', $token), $subscriber, $kind, $list, time() + 86400]); return $token;
}
$temporary = sys_get_temp_dir().'/gnosi-site-service-'.bin2hex(random_bytes(8)); mkdir($temporary, 0700);
$form = ['id' => 'contact', 'revision' => 1, 'enabled' => true, 'fields' => [
    ['id' => 'email', 'type' => 'email', 'label' => ['ca' => 'Correu', 'es' => 'Correo'], 'required' => true, 'max_length' => 254],
    ['id' => 'message', 'type' => 'textarea', 'label' => ['ca' => 'Missatge'], 'required' => true, 'max_length' => 50],
    ['id' => 'topic', 'type' => 'select', 'label' => ['ca' => 'Tema'], 'required' => false, 'max_length' => 50, 'options' => ['A', 'B']],
    ['id' => 'accept', 'type' => 'checkbox', 'label' => ['ca' => 'Opció'], 'required' => false, 'max_length' => 10],
], 'require_privacy' => true, 'newsletter_list' => 'main', 'confirmation' => ['ca' => 'Gràcies!', 'es' => '¡Gracias!'], 'redirect_path' => '/ca/contacte/gracies'];
$config = ['site_id' => 'synthetic', 'public_base_url' => 'http://127.0.0.1:4321/pilot', 'db_path' => $temporary.'/state.sqlite', 'spool_path' => $temporary.'/spool', 'test_mode' => true, 'forms' => [$form], 'form_delivery' => ['contact' => ['recipients' => ['owner@example.invalid'], 'subject' => 'Contact', 'autoresponse' => false]], 'smtp' => ['per_minute' => 100]];
try {
    $originalDirectory = getcwd(); $originalConfig = getenv('GNOSI_SITES_SERVICE_CONFIG'); $hadDocumentRoot = array_key_exists('DOCUMENT_ROOT', $_SERVER); $originalDocumentRoot = $_SERVER['DOCUMENT_ROOT'] ?? null;
    $cliConfig = $temporary.'/cli-config.json'; file_put_contents($cliConfig, json_encode($config, JSON_THROW_ON_ERROR)); chmod($cliConfig, 0600);
    try {
        chdir($temporary); putenv('GNOSI_SITES_SERVICE_CONFIG='.$cliConfig);
        foreach ([null, '', $temporary, $temporary.'/missing-http-root'] as $simulatedRoot) {
            if ($simulatedRoot === null) unset($_SERVER['DOCUMENT_ROOT']); else $_SERVER['DOCUMENT_ROOT'] = $simulatedRoot;
            check(site_service_document_root() === null, 'SVC-06 CLI has no HTTP document-root boundary');
            $probe = new SiteService(site_service_config()); check($probe->admin('status', [])['site_id'] === 'synthetic', 'SVC-06 CLI cwd may contain legitimate private config/database/spool'); unset($probe);
        }
    } finally {
        chdir($originalDirectory); if ($originalConfig === false) putenv('GNOSI_SITES_SERVICE_CONFIG'); else putenv('GNOSI_SITES_SERVICE_CONFIG='.$originalConfig);
        if ($hadDocumentRoot) $_SERVER['DOCUMENT_ROOT'] = $originalDocumentRoot; else unset($_SERVER['DOCUMENT_ROOT']);
    }
    $service = new SiteService($config); $db = new PDO('sqlite:'.$config['db_path']); $db->setAttribute(PDO::ATTR_DEFAULT_FETCH_MODE, PDO::FETCH_ASSOC);
    $request = ['form_id' => 'contact', 'revision' => 1, 'language' => 'ca', '_request_id' => 'synthetic-request-001', 'values' => ['email' => 'visitor@example.invalid', 'message' => '<script>hello</script>', 'topic' => 'A'], 'privacy' => '1'];
    $received = $service->contact($request, 'test1'); check($received['received'] && $received['message'] === 'Gràcies!', 'Localized durable confirmation'); check($received['redirect_path'] === '/pilot/ca/contacte/gracies', 'Subdirectory redirect');
    $replay = $service->contact($request, 'test2'); check($received['id'] === $replay['id'], 'Idempotent replay');
    $conflict = $request; $conflict['values']['message'] = 'changed'; fails(fn() => $service->contact($conflict, 'test3'), 'request_conflict');
    $messages = $service->admin('messages_list', []); check($messages['total'] === 1 && $messages['items'][0]['notification_status'] === 'pending', 'Message stored before notification');
    check((int)$service->admin('status', [])['subscribers']['pending'] === 0, 'Contact never subscribes without independent opt-in');
    $worker = $service->admin('worker', []); check($worker['captured'] === 1, 'Private capture');
    $captures = glob($config['spool_path'].'/*.json'); $capture = json_decode(file_get_contents($captures[0]), true); check($capture['reply_to'] === 'visitor@example.invalid', 'Reply-To sender'); check(!str_contains($capture['body_html'], '<script>'), 'Escaped contact body');
    $invalid = $request; $invalid['_request_id'] = 'synthetic-request-002'; $invalid['values']['topic'] = 'C';
    try { $service->contact($invalid, 'test4'); throw new RuntimeException('Invalid choice accepted'); } catch (SiteValidation $e) { check($e->fields['topic'] === 'invalid', 'Options validated'); }
    $nojs = $request; $nojs['_request_id'] = ''; $nojs['values']['message'] = 'Without JavaScript';
    $one = $service->contact($nojs, 'nojs'); $two = $service->contact($nojs, 'nojs'); check($one['id'] === $two['id'], 'No-JavaScript replay fallback');
    $honey = $request; $honey['website'] = 'spam'; $service->contact($honey, 'honey'); check($service->admin('messages_list', [])['total'] === 2, 'Honeypot discarded');
    for ($i = 0; $i < 6; $i++) { $limited = $request; $limited['_request_id'] = 'rate-limit-request-'.$i; $limited['values']['message'] = 'Message '.$i; $service->contact($limited, 'limited'); }
    check($service->admin('messages_list', [])['total'] === 7, 'Contact rate bounded');
    $form2 = $form; $form2['revision'] = 2; $form2['fields'][1]['label'] = ['ca' => 'Nou']; $service->admin('forms_sync', ['forms' => [$form2], 'form_delivery' => $config['form_delivery']]);
    $old = $service->admin('messages_list', ['q' => 'hello'])['items'][0]; check($old['fields'][1]['label'] === 'Missatge' && $old['form_revision'] === 1, 'Message keeps schema snapshot');
    fails(fn() => $service->contact($request, 'stale'), 'form_changed');
    $bad = $form2; $bad['redirect_path'] = '//evil.invalid/path'; fails(fn() => $service->admin('forms_sync', ['forms' => [$bad]]), 'redirect');
    $bad['redirect_path'] = '/%2f%2fevil.invalid'; fails(fn() => $service->admin('forms_sync', ['forms' => [$bad]]), 'redirect');
    $service->subscribe(['email' => 'reader@example.invalid', 'language' => 'ca', 'consent' => '1', 'list_id' => 'main', 'interests' => ['philosophy']], 'sub');
    check($service->admin('status', [])['subscribers']['pending'] === 1, 'Double opt-in pending');
    $service->admin('worker', []);
    $confirmation = null; foreach (glob($config['spool_path'].'/*.json') as $file) { $mail = json_decode(file_get_contents($file), true); if ($mail['kind'] === 'confirmation') $confirmation = $mail; }
    check($confirmation !== null, 'Confirmation captured'); preg_match('/action=confirm&(?:amp;)?token=([a-f0-9]{64})/', $confirmation['body_html'], $match); $token = $match[1];
    check(!(bool)$db->query("SELECT 1 FROM tokens WHERE hash='".$token."'")->fetchColumn(), 'Token not stored plaintext');
    $service->applyToken(['action' => 'confirm', 'token' => $token]); $service->applyToken(['action' => 'confirm', 'token' => $token]); check($service->admin('status', [])['subscribers']['active'] === 1, 'Confirmation one-use and idempotent');
    $preview = $service->admin('campaign_preview', ['subject' => 'Synthetic', 'body_html' => '<p onclick="evil()">Hi <a href="javascript:evil()">bad</a><a href="https://example.invalid">good</a><img src="https://tracker.invalid"><script>secret()</script></p>', 'language' => 'ca', 'list_id' => 'main', 'interests' => ['philosophy']]);
    check($preview['recipient_count'] === 1 && !str_contains($preview['body_html'], 'onclick') && !str_contains($preview['body_html'], 'javascript:') && !str_contains($preview['body_html'], 'secret()') && !str_contains($preview['body_html'], '<img'), 'Sanitized email preview');
    check(str_contains($preview['body_html'], 'https://example.invalid'), 'Safe links preserved');
    $queued = $service->admin('campaign_queue', ['preview_id' => $preview['preview_id'], 'scheduled_at' => gmdate('c', time() + 600)]); check($queued['queued'] === 1, 'Campaign queued'); check($queued === $service->admin('campaign_queue', ['preview_id' => $preview['preview_id']]), 'Campaign queue idempotent');
    check($service->admin('worker', [])['processed'] === 0, 'Scheduled campaign not sent early');
    $sub = $service->admin('subscribers_list', [])['items'][0]; $service->admin('subscribers_update', ['id' => $sub['id'], 'status' => 'unsubscribed']);
    $db->exec('UPDATE queue SET due_at=0'); $afterUnsubscribe = $service->admin('worker', []); check($afterUnsubscribe['captured'] === 0 && $db->query("SELECT status FROM queue WHERE kind='campaign' AND owner_id='".$queued['campaign_id']."'")->fetchColumn() === 'suppressed', 'Unsubscribe cancels pending campaign before actual send');
    $import = $service->admin('subscribers_import', ['items' => [['email' => 'reader@example.invalid', 'language' => 'ca', 'status' => 'active', 'consent_at' => time(), 'consent_revision' => 'fixture']]]); check($import['skipped'] === 1, 'Import preserves unsubscribe');
    fails(fn() => $service->admin('subscribers_update', ['id' => $sub['id'], 'status' => 'active']), 'confirmation_required');
    $service->subscribe(['email' => 'reader@example.invalid', 'language' => 'ca', 'consent' => '1'], 'resub'); $service->admin('worker', []);
    check($service->admin('status', [])['subscribers']['unsubscribed'] === 1, 'Resubscription cannot activate without fresh confirmation');
    $service->admin('subscribers_import', ['items' => [['email' => 'active@example.invalid', 'language' => 'ca', 'status' => 'active', 'consent_at' => time(), 'consent_revision' => 'fixture']]]);
    $p = $service->admin('campaign_preview', ['subject' => 'Bound audience', 'body_html' => '<p>Body</p>', 'language' => 'ca']); $active = $service->admin('subscribers_list', ['q' => 'active@'])['items'][0]; $service->admin('subscribers_update', ['id' => $active['id'], 'interests' => ['updated']]); fails(fn() => $service->admin('campaign_queue', ['preview_id' => $p['preview_id']]), 'audience_changed');
    $p = $service->admin('campaign_preview', ['subject' => 'Expiry', 'body_html' => 'Body', 'language' => 'ca']); $db->exec('UPDATE previews SET expires_at=0'); fails(fn() => $service->admin('campaign_queue', ['preview_id' => $p['preview_id']]), 'preview_expired');
    $service->admin('subscribers_import', ['items' => [['email' => 'real@example.com', 'language' => 'ca']]]); check($service->admin('subscribers_list', ['q' => 'real@'])['total'] === 0, 'Test mode rejects real addresses');
    $db->exec("UPDATE queue SET status='sending' WHERE id=(SELECT id FROM queue WHERE kind='confirmation' LIMIT 1)"); $uncertainBefore = (int)$db->query("SELECT COUNT(*) FROM queue WHERE status='uncertain'")->fetchColumn(); $service->admin('worker', []); check((int)$db->query("SELECT COUNT(*) FROM queue WHERE status='uncertain'")->fetchColumn() > $uncertainBefore, 'Interrupted sending becomes uncertain');
    $uncertain = $db->query("SELECT id FROM queue WHERE status='uncertain' LIMIT 1")->fetchColumn(); check($service->admin('reconcile', ['id' => $uncertain, 'status' => 'rejected'])['updated'], 'Explicit uncertain reconciliation');
    check($service->admin('maintenance', [])['deleted'] === 0, 'Retention disabled by default'); $service->admin('retention', ['days' => 1]); $db->exec('UPDATE messages SET created_at=0'); check($service->admin('maintenance', [])['deleted'] === 7, 'Configured retention removes old messages');
    check($service->admin('status', [])['subscribers']['active'] === 1, 'Message retention does not reset consent');
    $service->admin('forms_sync', ['forms' => []]); $fresh = new SiteService($config); check($fresh->publicForm('contact') === null, 'Removed forms are not reseeded on next request');
    $service->admin('forms_sync', ['forms' => [$form], 'form_delivery' => ['contact' => ['recipients' => ['different@example.invalid'], 'subject' => 'Private']]]);
    $withoutDefaults = $config; unset($withoutDefaults['form_delivery']); $fresh = new SiteService($withoutDefaults); $fresh->admin('forms_sync', ['forms' => [$form2]]);
    $settings = json_decode($db->query("SELECT delivery FROM forms WHERE id='contact'")->fetchColumn(), true); check($settings['recipients'] === ['different@example.invalid'], 'Public schema update preserves omitted private delivery settings');
    $disabled = $withoutDefaults; $disabled['test_mode'] = false; $disabled['allow_delivery'] = false; $fresh = new SiteService($disabled);
    $request['revision'] = 2; $request['_request_id'] = 'smtp-disabled-request'; $saved = $fresh->contact($request, 'transport-error'); $fresh->admin('worker', []);
    $savedMessage = $fresh->admin('messages_list', ['q' => 'hello'])['items'][0]; check($savedMessage['id'] === $saved['id'] && $savedMessage['notification_status'] === 'rejected', 'Notification failure retains durable contact receipt');
    $queueRow = $db->query("SELECT id FROM queue WHERE owner_id='".$saved['id']."'")->fetchColumn();
    check(is_string($queueRow), 'Failed delivery recorded privately');
    // Critic regressions SVC-01/02/03 use their own subscriber and queue history.
    $regressionConfig = $config; $regressionConfig['site_id'] = 'consent-regressions'; $regressionConfig['db_path'] = $temporary.'/regressions.sqlite'; $regressionConfig['spool_path'] = $temporary.'/regressions-spool'; $regressionConfig['forms'] = [];
    $regressions = new SiteService($regressionConfig); $rdb = new PDO('sqlite:'.$regressionConfig['db_path']); $rdb->setAttribute(PDO::ATTR_DEFAULT_FETCH_MODE, PDO::FETCH_ASSOC);
    $regressions->admin('subscribers_import', ['items' => [['email' => 'existing@example.invalid', 'language' => 'ca', 'interests' => ['original'], 'status' => 'active', 'consent_at' => time() - 86400, 'consent_revision' => 'historical-consent']]]);
    $before = $regressions->admin('subscribers_list', [])['items'][0];
    $reviewed = $regressions->admin('campaign_preview', ['subject' => 'Already reviewed', 'body_html' => '<p>Body</p>', 'language' => 'ca', 'interests' => ['original']]);
    $regressions->subscribe(['email' => 'existing@example.invalid', 'language' => 'es', 'interests' => ['requested'], 'list_id' => 'other', 'consent' => '1'], 'unconfirmed-other');
    $pending = $regressions->admin('subscribers_list', [])['items'][0];
    foreach (['language', 'interests', 'consent_at', 'consent_revision', 'revision', 'status', 'updated_at'] as $key) check($before[$key] === $pending[$key], 'SVC-01 unconfirmed request preserves '.$key);
    check($regressions->admin('campaign_queue', ['preview_id' => $reviewed['preview_id'], 'scheduled_at' => gmdate('c', time() + 86400)])['queued'] === 1, 'SVC-01 existing reviewed audience remains eligible');
    $regressions->admin('worker', []);
    $confirmation = null; foreach (glob($regressionConfig['spool_path'].'/*.json') as $file) { $mail = json_decode(file_get_contents($file), true); if ($mail['kind'] === 'confirmation') $confirmation = $mail; }
    preg_match('/action=confirm&(?:amp;)?token=([a-f0-9]{64})/', $confirmation['body_html'], $match); $regressions->applyToken(['action' => 'confirm', 'token' => $match[1]]);
    $confirmed = $regressions->admin('subscribers_list', [])['items'][0]; check($confirmed['language'] === 'es' && $confirmed['interests'] === ['requested'], 'SVC-01 staged profile applies only after confirmation');
    check((bool)$rdb->query("SELECT id FROM consent_history WHERE consent_revision='historical-consent'")->fetchColumn(), 'SVC-01 historical consent remains auditable');
    $regressions->admin('subscribers_update', ['id' => $confirmed['id'], 'list_id' => 'main', 'status' => 'unsubscribed']);
    fails(fn() => $regressions->admin('subscribers_update', ['id' => $confirmed['id'], 'list_id' => 'main', 'status' => 'active']), 'confirmation_required');
    $stillActiveElsewhere = $regressions->admin('subscribers_list', [])['items'][0]; check($stillActiveElsewhere['status'] === 'active', 'SVC-03 active other membership remains active');
    $mainMembership = array_values(array_filter($stillActiveElsewhere['lists'], fn($list) => $list['id'] === 'main'))[0]; check($mainMembership['status'] === 'unsubscribed', 'SVC-03 list cannot reactivate through global active status');
    $previewFuture = $regressions->admin('campaign_preview', ['subject' => 'Far future', 'body_html' => '<p>Future</p>', 'language' => 'es', 'list_id' => 'other']); $due = time() + 100 * 86400;
    $future = $regressions->admin('campaign_queue', ['preview_id' => $previewFuture['preview_id'], 'scheduled_at' => gmdate('c', $due)]);
    $futureQueue = $rdb->query("SELECT * FROM queue WHERE owner_id='".$future['campaign_id']."'")->fetch();
    $lifecycle = $rdb->query("SELECT t.* FROM tokens t JOIN queue_tokens qt ON qt.token_hash=t.hash WHERE qt.queue_id='".$futureQueue['id']."'")->fetchAll(); check(count($lifecycle) === 3, 'SVC-02 lifecycle tokens explicitly bound to delivery');
    foreach ($lifecycle as $tokenRow) check($tokenRow['expires_at'] >= $due + 7776000, 'SVC-02 scheduled send has future-valid links');
    $regressions->admin('campaign_pause', ['id' => $future['campaign_id'], 'paused' => true]);
    $rdb->exec("UPDATE queue SET due_at=0 WHERE id='".$futureQueue['id']."'");
    foreach ($lifecycle as $tokenRow) $rdb->exec("UPDATE tokens SET expires_at=1 WHERE hash='".$tokenRow['hash']."'");
    $regressions->admin('worker', []); check($rdb->query("SELECT status FROM queue WHERE id='".$futureQueue['id']."'")->fetchColumn() === 'pending', 'SVC-02 paused delivery stays queued');
    // Also exercise additive migration of messages queued before queue_tokens existed.
    $rdb->exec("DELETE FROM queue_tokens WHERE queue_id='".$futureQueue['id']."'");
    $regressions->admin('campaign_pause', ['id' => $future['campaign_id'], 'paused' => false]);
    $futureWorker = $regressions->admin('worker', []); check($futureWorker['captured'] === 1, 'SVC-02 delayed delivery proceeds');
    foreach ($lifecycle as $tokenRow) check((int)$rdb->query("SELECT expires_at FROM tokens WHERE hash='".$tokenRow['hash']."'")->fetchColumn() >= time() + 7776000 - 1, 'SVC-02 backlog renews lifecycle validity at delivery');
    $futureCapturePath = $regressionConfig['spool_path'].'/'.$futureQueue['id'].'.json'; $futureCapture = json_decode(file_get_contents($futureCapturePath), true);
    check($futureCapture['body_html'] === $futureQueue['body_html'], 'SVC-02 retry-safe tokens are not rotated');
    $rdb->exec("UPDATE queue SET status='uncertain' WHERE id='".$futureQueue['id']."'");
    check($regressions->admin('worker', [])['processed'] === 0, 'SVC-02 uncertain delivery is never retried automatically');
    $regressions->admin('reconcile', ['id' => $futureQueue['id'], 'status' => 'pending']); $regressions->admin('worker', []);
    check(count(glob($regressionConfig['spool_path'].'/*.json')) === 2, 'SVC-02 explicit test retry keeps captures idempotent');
    preg_match('/action=unsubscribe&(?:amp;)?token=([a-f0-9]{64})/', $futureCapture['body_html'], $offMatch); $regressions->applyToken(['action' => 'unsubscribe', 'token' => $offMatch[1]]);
    check($rdb->query("SELECT status FROM memberships WHERE subscriber_id=".$confirmed['id']." AND list_id='other'")->fetchColumn() === 'unsubscribed', 'SVC-02 delivered late unsubscribe remains usable');
    $regressions->admin('subscribers_import', ['items' => [['email' => 'theme@example.invalid', 'language' => 'ca', 'status' => 'active', 'consent_at' => time(), 'consent_revision' => 'theme-fixture']]]);
    $beforeTheme = $regressionConfig; $beforeTheme['email_theme'] = ['primary' => '#111111', 'background' => '#EEEEEE']; $beforeTheme['smtp']['from'] = 'reviewed@example.invalid';
    $themeService = new SiteService($beforeTheme); $themePreview = $themeService->admin('campaign_preview', ['subject' => 'Reviewed theme', 'body_html' => '<p>Reviewed body</p>', 'language' => 'ca']);
    check($themePreview['from_email'] === 'reviewed@example.invalid', 'SVC-04 preview exposes reviewed sender');
    $afterTheme = $beforeTheme; $afterTheme['email_theme'] = ['primary' => '#FF0000', 'background' => '#000000']; $afterTheme['smtp']['from'] = 'changed@example.invalid';
    $changedThemeService = new SiteService($afterTheme); $themeCampaign = $changedThemeService->admin('campaign_queue', ['preview_id' => $themePreview['preview_id']]);
    $themeQueue = $rdb->query("SELECT q.*,c.from_email FROM queue q JOIN queue_contexts c ON c.queue_id=q.id WHERE owner_id='".$themeCampaign['campaign_id']."'")->fetch();
    check(str_contains($themeQueue['body_html'], 'color:#111111') && str_contains($themeQueue['body_html'], 'background:#EEEEEE') && !str_contains($themeQueue['body_html'], '#FF0000'), 'SVC-04 queued email freezes reviewed theme');
    check($themeQueue['from_email'] === 'reviewed@example.invalid', 'SVC-04 queued sender freezes reviewed identity');
    $changedThemeService->admin('worker', []); $themeCapture = json_decode(file_get_contents($regressionConfig['spool_path'].'/'.$themeQueue['id'].'.json'), true);
    check($themeCapture['body_html'] === $themeQueue['body_html'] && $themeCapture['from_email'] === 'reviewed@example.invalid', 'SVC-04 delivery preserves reviewed rendering and sender');
    $legacyPreview = $themeService->admin('campaign_preview', ['subject' => 'Unbound old preview', 'body_html' => '<p>Body</p>', 'language' => 'ca']);
    $rdb->exec("DELETE FROM preview_contexts WHERE preview_id='".$legacyPreview['preview_id']."'"); fails(fn() => $changedThemeService->admin('campaign_queue', ['preview_id' => $legacyPreview['preview_id']]), 'preview_context_changed');
    $modePreview = $themeService->admin('campaign_preview', ['subject' => 'Capture review', 'body_html' => '<p>Body</p>', 'language' => 'ca']);
    $realConfig = $afterTheme; $realConfig['test_mode'] = false; $realService = new SiteService($realConfig); fails(fn() => $realService->admin('campaign_queue', ['preview_id' => $modePreview['preview_id']]), 'preview_context_changed');
    unset($themeService, $changedThemeService, $realService);
    // SVC-05 checks the restriction state machine across every mutation entrypoint.
    foreach (['admin-update', 'admin-import', 'import-upgrade', 'legacy-status', 'legacy-reason'] as $entrypoint) {
        $email = $entrypoint.'@example.invalid';
        $regressions->admin('subscribers_import', ['items' => [['email' => $email, 'language' => 'ca', 'interests' => ['effective'], 'status' => 'active', 'consent_at' => time() - 100, 'consent_revision' => 'matrix']]]);
        $fixture = $regressions->admin('subscribers_list', ['q' => $email])['items'][0]; $sid = (int)$fixture['id'];
        $regressions->subscribe(['email' => $email, 'language' => 'es', 'interests' => ['pending'], 'list_id' => 'other', 'consent' => '1'], 'matrix-'.$entrypoint);
        $pendingBody = $rdb->query("SELECT body_html FROM queue WHERE subscriber_id=".$sid." AND kind='confirmation'")->fetchColumn();
        preg_match('/action=confirm&(?:amp;)?token=([a-f0-9]{64})/', $pendingBody, $pendingToken);
        $actions = [
            ['action' => 'confirm', 'token' => $pendingToken[1]],
            ['action' => 'unsubscribe', 'token' => fixtureToken($rdb, $sid, 'unsubscribe', '*')],
            ['action' => 'unsubscribe', 'token' => fixtureToken($rdb, $sid, 'unsubscribe', 'main')],
            ['action' => 'preferences', 'token' => fixtureToken($rdb, $sid, 'preferences', 'main'), 'language' => 'es', 'interests' => ['stale']],
        ];
        if ($entrypoint === 'admin-update') $regressions->admin('subscribers_update', ['id' => $sid, 'status' => 'suppressed']);
        elseif ($entrypoint === 'admin-import') $regressions->admin('subscribers_import', ['items' => [['email' => $email, 'language' => 'ca', 'status' => 'suppressed']]]);
        elseif ($entrypoint === 'import-upgrade') {
            $regressions->admin('subscribers_update', ['id' => $sid, 'status' => 'unsubscribed']);
            check($regressions->admin('subscribers_import', ['items' => [['email' => $email, 'language' => 'ca', 'status' => 'suppressed']]])['imported'] === 1, 'SVC-05 imports may strengthen soft unsubscribe');
        } elseif ($entrypoint === 'legacy-status') {
            $rdb->exec("UPDATE subscribers SET status='suppressed' WHERE id=".$sid);
            $query = $rdb->prepare("INSERT INTO suppressions VALUES (?,'unsubscribed',?)"); $query->execute([$email, time()]);
        } else { $query = $rdb->prepare("INSERT INTO suppressions VALUES (?,'suppressed',?)"); $query->execute([$email, time()]); }
        if (!str_starts_with($entrypoint, 'legacy-')) {
            check((int)$rdb->query('SELECT COUNT(*) FROM tokens WHERE subscriber_id='.$sid.' AND used_at IS NULL')->fetchColumn() === 0, 'SVC-05 '.$entrypoint.' revokes every lifecycle token');
            check((int)$rdb->query('SELECT COUNT(*) FROM subscription_requests WHERE confirmed_at IS NULL AND token_hash IN (SELECT hash FROM tokens WHERE subscriber_id='.$sid.')')->fetchColumn() === 0, 'SVC-05 '.$entrypoint.' revokes pending profile requests');
            check((int)$rdb->query("SELECT COUNT(*) FROM queue WHERE subscriber_id=".$sid." AND kind='confirmation' AND status='pending'")->fetchColumn() === 0, 'SVC-05 '.$entrypoint.' cancels confirmation backlog');
        }
        $restricted = $regressions->admin('subscribers_list', ['q' => $email])['items'][0];
        $reasonBefore = $rdb->query("SELECT reason FROM suppressions WHERE email='".$email."'")->fetchColumn();
        foreach ($actions as $action) {
            // Simulate links issued by an older service lacking revocation: guards
            // must independently preserve the strongest authoritative restriction.
            $rdb->exec("UPDATE tokens SET used_at=NULL WHERE hash='".hash('sha256', $action['token'])."'");
            $regressions->applyToken($action);
            check($regressions->admin('subscribers_list', ['q' => $email])['items'][0] === $restricted, 'SVC-05 '.$entrypoint.' stale '.$action['action'].' cannot mutate restricted state');
            check($rdb->query("SELECT reason FROM suppressions WHERE email='".$email."'")->fetchColumn() === $reasonBefore, 'SVC-05 '.$entrypoint.' preserves suppression reason');
        }
        $queueBefore = (int)$rdb->query('SELECT COUNT(*) FROM queue WHERE subscriber_id='.$sid)->fetchColumn();
        $regressions->subscribe(['email' => $email, 'language' => 'es', 'interests' => ['retry'], 'list_id' => 'new-list', 'consent' => '1'], 'matrix-retry-'.$entrypoint);
        check((int)$rdb->query('SELECT COUNT(*) FROM queue WHERE subscriber_id='.$sid)->fetchColumn() === $queueBefore, 'SVC-05 '.$entrypoint.' public subscribe cannot request reactivation');
        foreach (['pending', 'active', 'unsubscribed'] as $weaker) {
            check($regressions->admin('subscribers_import', ['items' => [['email' => $email, 'language' => 'es', 'status' => $weaker, 'consent_at' => time(), 'consent_revision' => 'attempt']]])['skipped'] === 1, 'SVC-05 '.$entrypoint.' import '.$weaker.' cannot downgrade');
            fails(fn() => $regressions->admin('subscribers_update', ['id' => $sid, 'status' => $weaker]), 'suppression_requires_review');
        }
    }
    // List-level suppression remains stronger even while global unsubscribe and
    // resubscription to an unrelated list are allowed to change the global state.
    $listEmail = 'list-restriction@example.invalid';
    $regressions->admin('subscribers_import', ['items' => [['email' => $listEmail, 'language' => 'ca', 'status' => 'active', 'consent_at' => time(), 'consent_revision' => 'list-matrix']]]);
    $listRow = $regressions->admin('subscribers_list', ['q' => $listEmail])['items'][0]; $listId = (int)$listRow['id'];
    $listTokens = [
        ['action' => 'confirm', 'token' => fixtureToken($rdb, $listId, 'confirm', 'main')],
        ['action' => 'unsubscribe', 'token' => fixtureToken($rdb, $listId, 'unsubscribe', 'main')],
        ['action' => 'preferences', 'token' => fixtureToken($rdb, $listId, 'preferences', 'main'), 'language' => 'es', 'interests' => ['blocked']],
    ];
    $globalOff = fixtureToken($rdb, $listId, 'unsubscribe', '*');
    $regressions->admin('subscribers_update', ['id' => $listId, 'list_id' => 'main', 'status' => 'suppressed']);
    $listBefore = $regressions->admin('subscribers_list', ['q' => $listEmail])['items'][0];
    foreach ($listTokens as $action) {
        $rdb->exec("UPDATE tokens SET used_at=NULL WHERE hash='".hash('sha256', $action['token'])."'"); $regressions->applyToken($action);
        check($regressions->admin('subscribers_list', ['q' => $listEmail])['items'][0] === $listBefore, 'SVC-05 list-suppressed stale '.$action['action'].' is inert');
    }
    foreach (['pending', 'active', 'unsubscribed'] as $weaker) fails(fn() => $regressions->admin('subscribers_update', ['id' => $listId, 'list_id' => 'main', 'status' => $weaker]), 'suppression_requires_review');
    $regressions->applyToken(['action' => 'unsubscribe', 'token' => $globalOff]);
    check($rdb->query("SELECT status FROM memberships WHERE subscriber_id=".$listId." AND list_id='main'")->fetchColumn() === 'suppressed', 'SVC-05 global unsubscribe preserves stronger list restriction');
    $beforeMainRetry = (int)$rdb->query('SELECT COUNT(*) FROM queue WHERE subscriber_id='.$listId)->fetchColumn();
    $regressions->subscribe(['email' => $listEmail, 'language' => 'ca', 'list_id' => 'main', 'consent' => '1'], 'matrix-list-main');
    check((int)$rdb->query('SELECT COUNT(*) FROM queue WHERE subscriber_id='.$listId)->fetchColumn() === $beforeMainRetry, 'SVC-05 public signup cannot bypass list suppression');
    $regressions->subscribe(['email' => $listEmail, 'language' => 'ca', 'list_id' => 'other', 'consent' => '1'], 'matrix-list-other');
    $body = $rdb->query("SELECT body_html FROM queue WHERE subscriber_id=".$listId." AND kind='confirmation' AND list_id='other'")->fetchColumn(); preg_match('/action=confirm&(?:amp;)?token=([a-f0-9]{64})/', $body, $confirmOther); $regressions->applyToken(['action' => 'confirm', 'token' => $confirmOther[1]]);
    check($rdb->query("SELECT status FROM subscribers WHERE id=".$listId)->fetchColumn() === 'active', 'SVC-05 unrelated voluntary DOI remains available');
    check($rdb->query("SELECT status FROM memberships WHERE subscriber_id=".$listId." AND list_id='main'")->fetchColumn() === 'suppressed', 'SVC-05 unrelated DOI never weakens list suppression');
    $regressions->admin('subscribers_import', ['items' => [['email' => $listEmail, 'language' => 'ca', 'status' => 'unsubscribed']]]);
    check($rdb->query("SELECT status FROM memberships WHERE subscriber_id=".$listId." AND list_id='main'")->fetchColumn() === 'suppressed', 'SVC-05 global unsubscribe import preserves list suppression');
    check($regressions->admin('worker', [])['captured'] === 0, 'SVC-05 worker also suppresses legacy administrative confirmation backlog');
    $rdb->exec("INSERT INTO suppressions VALUES ('orphan@example.invalid','suppressed',0)");
    $regressions->subscribe(['email' => 'orphan@example.invalid', 'language' => 'ca', 'consent' => '1'], 'matrix-orphan');
    check($regressions->admin('subscribers_list', ['q' => 'orphan@'])['total'] === 0, 'SVC-05 suppression tombstone survives absence of subscriber row');
    unset($rdb, $regressions);
    $different = $config; $different['site_id'] = 'other'; try { new SiteService($different); throw new RuntimeException('Cross-site database accepted'); } catch (RuntimeException $e) { check($e->getMessage() === 'Service site mismatch', 'Cross-site isolation'); }
    echo "PASS: forms, persistence, lifecycle, privacy, campaign binding, suppression, scheduling, recovery and retention\n";
} finally { unset($db, $service); removeTree($temporary); }
