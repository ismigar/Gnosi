<?php
declare(strict_types=1);

final class SiteSmtpFailure extends RuntimeException {
    public function __construct(public string $deliveryState, string $message) { parent::__construct($message); }
}

/** Small bounded SMTP submission client; no MTA or delivery tracking is implied. */
final class SiteSmtp {
    private mixed $stream = null;
    private bool $bodySubmitted = false;
    private float $deadline = 0;
    private array $config;

    public function __construct(array $config) { $this->config = $config; }

    private function response(array $expected): void {
        $last = ''; $lines = 0;
        while (true) {
            $remaining = $this->deadline - microtime(true);
            if ($remaining <= 0) throw new SiteSmtpFailure($this->bodySubmitted ? 'uncertain' : 'pending', 'smtp_timeout');
            stream_set_timeout($this->stream, max(1, min(15, (int)ceil($remaining))));
            $line = fgets($this->stream, 8192);
            if ($line === false || ++$lines > 100) throw new SiteSmtpFailure($this->bodySubmitted ? 'uncertain' : 'pending', 'smtp_connection');
            if (!preg_match('/^[0-9]{3}[ -]/', $line)) throw new SiteSmtpFailure($this->bodySubmitted ? 'uncertain' : 'pending', 'smtp_response');
            $last = $line;
            if (strlen($line) < 4 || $line[3] !== '-') break;
        }
        $code = (int)substr($last, 0, 3);
        if (!in_array($code, $expected, true)) throw new SiteSmtpFailure($code >= 500 ? 'rejected' : (($code >= 400 && $code < 500) || !$this->bodySubmitted ? 'pending' : 'uncertain'), 'smtp_rejected');
    }

    private function write(string $value): void {
        $offset = 0;
        while ($offset < strlen($value)) {
            $written = fwrite($this->stream, substr($value, $offset));
            if ($written === false || $written === 0) throw new SiteSmtpFailure($this->bodySubmitted ? 'uncertain' : 'pending', 'smtp_connection');
            $offset += $written;
        }
    }

    private function command(string $command, array $expected): void { $this->write($command."\r\n"); $this->response($expected); }

    public function send(array $message): void {
        $this->bodySubmitted = false; $this->deadline = microtime(true) + 30;
        $host = $this->config['host'] ?? '';
        $port = (int)($this->config['port'] ?? 587);
        $security = $this->config['security'] ?? 'starttls';
        $from = (string)($this->config['from'] ?? '');
        if (!is_string($host) || !preg_match('/^[a-zA-Z0-9.:-]{1,253}$/D', $host) || $port < 1 || $port > 65535 || !filter_var($from, FILTER_VALIDATE_EMAIL)) throw new SiteSmtpFailure('rejected', 'smtp_configuration');
        $loopbackTest = ($this->config['allow_insecure_loopback'] ?? false) === true && in_array($host, ['127.0.0.1', '::1'], true);
        if (!in_array($security, ['starttls', 'tls'], true) && !($security === 'none' && $loopbackTest)) throw new SiteSmtpFailure('rejected', 'smtp_tls_required');
        foreach (['to_email', 'reply_to', 'subject'] as $key) if (preg_match('/[\r\n]/', (string)($message[$key] ?? ''))) throw new SiteSmtpFailure('rejected', 'smtp_headers');
        if (!filter_var($message['to_email'], FILTER_VALIDATE_EMAIL) || ($message['reply_to'] && !filter_var($message['reply_to'], FILTER_VALIDATE_EMAIL))) throw new SiteSmtpFailure('rejected', 'smtp_address');
        $context = stream_context_create(['ssl' => ['verify_peer' => true, 'verify_peer_name' => true, 'peer_name' => $host]]);
        $target = ($security === 'tls' ? 'tls' : 'tcp').'://'.(str_contains($host, ':') ? '['.$host.']' : $host).':'.$port;
        $errno = 0; $error = '';
        $this->stream = @stream_socket_client($target, $errno, $error, 10, STREAM_CLIENT_CONNECT, $context);
        if (!$this->stream) throw new SiteSmtpFailure('pending', 'smtp_connection');
        stream_set_timeout($this->stream, 15);
        try {
            $this->response([220]); $this->command('EHLO gnosi.local', [250]);
            if ($security === 'starttls') {
                $this->command('STARTTLS', [220]);
                if (!stream_socket_enable_crypto($this->stream, true, STREAM_CRYPTO_METHOD_TLS_CLIENT)) throw new SiteSmtpFailure('pending', 'smtp_tls');
                $this->command('EHLO gnosi.local', [250]);
            }
            if (!empty($this->config['username'])) {
                $this->command('AUTH LOGIN', [334]);
                $this->command(base64_encode((string)$this->config['username']), [334]);
                $this->command(base64_encode((string)($this->config['password'] ?? '')), [235]);
            }
            $this->command('MAIL FROM:<'.$from.'>', [250]);
            $this->command('RCPT TO:<'.$message['to_email'].'>', [250, 251]);
            $this->command('DATA', [354]);
            $boundary = 'gnosi_'.bin2hex(random_bytes(16));
            $domain = substr(strrchr($from, '@'), 1);
            $headers = ['Date: '.gmdate('D, d M Y H:i:s').' +0000', 'From: <'.$from.'>', 'To: <'.$message['to_email'].'>', 'Message-ID: <'.$message['id'].'@'.$domain.'>', 'Subject: =?UTF-8?B?'.base64_encode($message['subject']).'?=', 'MIME-Version: 1.0', 'Content-Type: multipart/alternative; boundary="'.$boundary.'"'];
            if ($message['reply_to']) $headers[] = 'Reply-To: <'.$message['reply_to'].'>';
            $body = implode("\r\n", $headers)."\r\n\r\n";
            foreach (['text/plain' => 'body_text', 'text/html' => 'body_html'] as $type => $key) $body .= '--'.$boundary."\r\nContent-Type: ".$type."; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n".chunk_split(base64_encode($message[$key]), 76, "\r\n")."\r\n";
            $body .= '--'.$boundary."--\r\n";
            // Once a body can have reached DATA's terminator, losing the reply is ambiguous.
            $this->bodySubmitted = true;
            $this->write(preg_replace('/(?m)^\./', '..', $body).".\r\n");
            $this->response([250]);
            // QUIT loss cannot invalidate an already accepted DATA response.
            @fwrite($this->stream, "QUIT\r\n");
        } finally { fclose($this->stream); $this->stream = null; }
    }
}
