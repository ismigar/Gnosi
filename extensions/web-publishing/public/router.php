<?php
declare(strict_types=1);
// Loopback PHP preview router. Apache uses the release's own rewrite rules.
clearstatcache(true);
$root=realpath((string)(getenv('GNOSI_SITES_PUBLIC_ROOT')?:($_SERVER['DOCUMENT_ROOT']??'')));
$releases=getenv('GNOSI_SITES_RELEASE_ROOT');
if($releases){$owned=realpath($releases);if(!$owned||!$root||!preg_match('~^'.preg_quote($owned,'~').'/[a-f0-9]{32}/public$~D',$root)){http_response_code(503);exit;}}
if(!$root){http_response_code(503);exit;}
$path=parse_url($_SERVER['REQUEST_URI']??'/',PHP_URL_PATH);
if(!is_string($path)||str_contains($path,"\0")||str_contains($path,'\\')){http_response_code(400);exit;}
$base=(string)(getenv('GNOSI_SITES_BASE_PATH')?:'');
if($base!==''&&($path===$base||str_starts_with($path,$base.'/')))$path=substr($path,strlen($base))?:'/';
$segments=explode('/',rawurldecode($path));
foreach($segments as $segment){if($segment==='..'||str_starts_with($segment,'.')){http_response_code(404);exit;}}
$relative=ltrim(implode('/',$segments),'/');
$candidate=$root.'/'.$relative;
if($path==='/')$candidate=$root.'/index.html';
elseif(is_dir($candidate)&&is_file($candidate.'/index.html'))$candidate.='/index.html';
elseif(!is_file($candidate)&&is_file($candidate.'.html'))$candidate.='.html';
$file=realpath($candidate);
if(!$file||!str_starts_with($file,$root.'/')||!is_file($file)){http_response_code(404);exit;}
header('X-Robots-Tag: noindex, nofollow');header('X-Content-Type-Options: nosniff');
if(str_ends_with($file,'.php')){
 if(!in_array($relative,['api/contact.php','api/newsletter.php'],true)){http_response_code(404);exit;}
 $_SERVER['DOCUMENT_ROOT']=$root;require $file;return;
}
$mime=['html'=>'text/html; charset=UTF-8','css'=>'text/css; charset=UTF-8','js'=>'text/javascript; charset=UTF-8','wasm'=>'application/wasm','json'=>'application/json','xml'=>'application/xml; charset=UTF-8','svg'=>'image/svg+xml','png'=>'image/png','jpg'=>'image/jpeg','jpeg'=>'image/jpeg','webp'=>'image/webp','woff2'=>'font/woff2','woff'=>'font/woff','ttf'=>'font/ttf','otf'=>'font/otf','ico'=>'image/x-icon','txt'=>'text/plain; charset=UTF-8','pdf'=>'application/pdf'];
$extension=strtolower(pathinfo($file,PATHINFO_EXTENSION));header('Content-Type: '.($mime[$extension]??'application/octet-stream'));
readfile($file);
