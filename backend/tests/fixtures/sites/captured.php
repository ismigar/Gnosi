<?php
declare(strict_types=1);
require_once $argv[1];
function captureCheck(bool $value, string $message): void { if (!$value) throw new RuntimeException($message); }
function captureFails(callable $fn, string $message): void {
    try { $fn(); } catch (InvalidArgumentException $error) { captureCheck($error->getMessage() === $message, 'Wrong rejection'); return; }
    throw new RuntimeException('Missing rejection: '.$message);
}
function captureRemove(string $path): void {
    if (is_link($path) || is_file($path)) unlink($path);
    elseif (is_dir($path)) { foreach (scandir($path) as $name) if ($name !== '.' && $name !== '..') captureRemove($path.'/'.$name); rmdir($path); }
}
function captureLink(array $mail, string $action, string $list = ''): int {
    foreach ($mail['links'] as $link) if ($link['action'] === $action && ($list === '' || $link['list_id'] === $list)) return $link['index'];
    throw new RuntimeException('Missing captured link');
}
$root = sys_get_temp_dir().'/gnosi-captured-test-'.bin2hex(random_bytes(8)); mkdir($root, 0700);
$config = ['site_id' => 'synthetic-captures', 'public_base_url' => 'http://127.0.0.1:4339/pilot', 'languages' => ['ca', 'es'], 'db_path' => $root.'/state.sqlite', 'spool_path' => $root.'/captures', 'test_mode' => true, 'forms' => [], 'smtp' => ['per_minute' => 100]];
try {
    $service = new SiteService($config); $db = new PDO('sqlite:'.$config['db_path']); $db->setAttribute(PDO::ATTR_DEFAULT_FETCH_MODE, PDO::FETCH_ASSOC);
    $service->subscribe(['email' => 'reader@example.invalid', 'language' => 'ca', 'list_id' => 'main', 'interests' => ['original'], 'consent' => '1'], 'fixture');
    $service->admin('worker', ['limit' => 10]);
    $id = $db->query("SELECT id FROM queue WHERE kind='confirmation'")->fetchColumn();
    $initial = $db->query('SELECT * FROM subscribers')->fetch();
    $mail = $service->admin('captured_get', ['id' => $id]);
    captureCheck($mail['test_mode'] === true && $mail['to_email'] === 'reader@example.invalid' && count($mail['links']) === 2, 'Read captured confirmation');
    captureCheck(!array_key_exists('token', $mail['links'][0]), 'No redundant raw token field');
    captureCheck($db->query('SELECT * FROM subscribers')->fetch() === $initial, 'Reading never confirms');
    $confirm = captureLink($mail, 'confirm');
    $confirmed = $service->admin('captured_apply', ['id' => $id, 'link_index' => $confirm]);
    captureCheck($confirmed['action_applied'] === true && $db->query('SELECT status FROM subscribers')->fetchColumn() === 'active', 'Explicit confirmation applies');
    $profile = $db->query('SELECT * FROM subscribers')->fetch();
    captureCheck($profile['consent_revision'] === 'webs-v1' && $profile['consent_at'] > 0, 'Confirmation records consent');
    captureCheck($service->admin('captured_apply', ['id' => $id, 'link_index' => $confirm])['action_applied'] === false, 'Used confirmation is idempotent');
    captureCheck($db->query('SELECT * FROM subscribers')->fetch() === $profile, 'Repeat does not change profile');
    $preview = $service->admin('campaign_preview', ['language' => 'ca', 'list_id' => 'main', 'subject' => 'Synthetic captured links', 'body_html' => '<p>Test only</p>']);
    $queued = $service->admin('campaign_queue', ['preview_id' => $preview['preview_id']]);
    captureCheck($queued['queued'] === 1, 'One synthetic recipient'); $service->admin('worker', ['limit' => 10]);
    $campaign = $db->query("SELECT id FROM queue WHERE kind='campaign'")->fetchColumn();
    $mail = $service->admin('captured_get', ['id' => $campaign]);
    captureCheck(count($mail['links']) === 3, 'Preferences and scoped/global unsubscribe links');
    $preferences = captureLink($mail, 'preferences');
    captureFails(fn() => $service->admin('captured_apply', ['id' => $campaign, 'link_index' => $preferences, 'language' => 'xx', 'interests' => []]), 'language');
    $updated = $service->admin('captured_apply', ['id' => $campaign, 'link_index' => $preferences, 'language' => 'es', 'interests' => ['new', 'original']]);
    captureCheck($updated['subscriber']['language'] === 'es' && $updated['subscriber']['interests'] === ['new', 'original'], 'Preferences saved');
    captureCheck($db->query('SELECT consent_at FROM subscribers')->fetchColumn() === $profile['consent_at'], 'Preferences retain consent');
    $service->admin('captured_apply', ['id' => $campaign, 'link_index' => captureLink($mail, 'unsubscribe', 'main')]);
    captureCheck($db->query('SELECT status FROM memberships')->fetchColumn() === 'unsubscribed' && $db->query('SELECT status FROM subscribers')->fetchColumn() === 'active', 'List-only unsubscribe');
    $service->admin('captured_apply', ['id' => $campaign, 'link_index' => captureLink($mail, 'unsubscribe', '*')]);
    $off = $db->query('SELECT * FROM subscribers')->fetch(); captureCheck($off['status'] === 'unsubscribed', 'Global unsubscribe');
    $service->admin('captured_apply', ['id' => $campaign, 'link_index' => $preferences, 'language' => 'ca', 'interests' => ['stale']]);
    captureCheck($db->query('SELECT * FROM subscribers')->fetch() === $off, 'Revoked links never alter profile');
    captureFails(fn() => $service->admin('captured_get', ['id' => '../state']), 'capture_unavailable');
    captureFails(fn() => $service->admin('captured_apply', ['id' => $id, 'link_index' => -1]), 'capture_link_unavailable');
    captureFails(fn() => $service->admin('captured_apply', ['id' => $id, 'link_index' => '0']), 'capture_link_unavailable');
    $path = $config['spool_path'].'/'.$id.'.json'; $raw = file_get_contents($path);
    $injected = json_decode($raw, true); $injected['body_text'] .= "\n".$mail['links'][$preferences]['url']; file_put_contents($path, json_encode($injected));
    captureCheck(count($service->admin('captured_get', ['id' => $id])['links']) === 2, 'Tokens from a different queue message are not actionable');
    file_put_contents($path, $raw);
    $foreign = json_decode($raw, true); $foreign['to'] = 'another@example.invalid'; file_put_contents($path, json_encode($foreign));
    captureFails(fn() => $service->admin('captured_get', ['id' => $id]), 'capture_unavailable');
    file_put_contents($path, $raw); rename($path, $path.'.retained'); symlink($path.'.retained', $path);
    captureFails(fn() => $service->admin('captured_get', ['id' => $id]), 'capture_unavailable'); unlink($path); rename($path.'.retained', $path);
    file_put_contents($path, str_repeat('x', 1000001)); captureFails(fn() => $service->admin('captured_get', ['id' => $id]), 'capture_unavailable'); file_put_contents($path, $raw);
    $db->exec("UPDATE queue SET status='pending' WHERE id='".$id."'"); captureFails(fn() => $service->admin('captured_get', ['id' => $id]), 'capture_unavailable'); $db->exec("UPDATE queue SET status='captured' WHERE id='".$id."'");
    $db->exec("UPDATE queue SET to_email='real@example.com' WHERE id='".$id."'"); captureFails(fn() => $service->admin('captured_get', ['id' => $id]), 'capture_unavailable'); $db->exec("UPDATE queue SET to_email='reader@example.invalid' WHERE id='".$id."'");
    $other = new SiteService(array_merge($config, ['site_id' => 'other', 'db_path' => $root.'/other.sqlite'])); captureFails(fn() => $other->admin('captured_get', ['id' => $id]), 'capture_unavailable');
    foreach ([['test_mode' => false], ['allow_delivery' => true], ['smtp' => ['allow_delivery' => true]]] as $unsafe) {
        $unsafeService = new SiteService(array_merge($config, $unsafe)); captureFails(fn() => $unsafeService->admin('captured_get', ['id' => $id]), 'test_capture_required'); captureFails(fn() => $unsafeService->admin('captured_apply', ['id' => $id, 'link_index' => 0]), 'test_capture_required');
    }
    echo "Captured mail lifecycle and isolation checks passed\n";
} finally { captureRemove($root); }
