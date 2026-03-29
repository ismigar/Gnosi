<?php
ini_set('display_errors', 1);
error_reportg(E_ALL);


// Only local settings, never public secrets
$settings['notion_api_key'] = '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';

// Optional: disable config and css/js caching if you are locals
$settings['cache']['bins']['render'] = 'cache.backend.memory';
$settings['cache']['bins']['dynamic_page_cache'] = 'cache.backend.memory';
$settings['cache']['bins']['page'] = 'cache.backend.memory';
$settings['cache']['default'] = 'cache.backend.memory';
