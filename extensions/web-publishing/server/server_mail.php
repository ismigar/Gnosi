<?php
declare(strict_types=1);

/** Hand messages to the host MTA; acceptance does not establish inbox delivery. */
final class SiteServerMail {
    public function __construct(private array $config) {}

    public function send(array $message): void {
        $from = (string)($this->config['from'] ?? '');
        $to = (string)($message['to_email'] ?? '');
        $reply = (string)($message['reply_to'] ?? '');
        foreach ([$from, $to, $reply, (string)($message['subject'] ?? '')] as $value) {
            if (preg_match('/[\r\n\x00]/', $value)) throw new SiteSmtpFailure('rejected', 'mail_headers');
        }
        if (!filter_var($from, FILTER_VALIDATE_EMAIL) || !filter_var($to, FILTER_VALIDATE_EMAIL) || ($reply !== '' && !filter_var($reply, FILTER_VALIDATE_EMAIL))) throw new SiteSmtpFailure('rejected', 'mail_address');
        // Never pass shell options or user-provided command arguments to mail().
        $boundary = 'gnosi_'.bin2hex(random_bytes(16));
        $headers = ['From' => '<'.$from.'>', 'MIME-Version' => '1.0', 'Content-Type' => 'multipart/alternative; boundary="'.$boundary.'"'];
        if ($reply !== '') $headers['Reply-To'] = '<'.$reply.'>';
        $body = '';
        foreach (['text/plain' => 'body_text', 'text/html' => 'body_html'] as $type => $key) $body .= '--'.$boundary."\r\nContent-Type: ".$type."; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n".chunk_split(base64_encode((string)($message[$key] ?? '')), 76, "\r\n")."\r\n";
        $body .= '--'.$boundary."--\r\n";
        $subject = '=?UTF-8?B?'.base64_encode((string)($message['subject'] ?? '')).'?=';
        if (!function_exists('mail')) throw new SiteSmtpFailure('rejected', 'mail_unavailable');
        if (!@mail($to, $subject, $body, $headers)) throw new SiteSmtpFailure('pending', 'mail_not_accepted');
    }
}
