<?php
/**
 * Plugin Name: Zakaliya static site
 * Description: Serves the static Zakaliya website (index.html, 404.html) in front of WordPress,
 *              redirects old WordPress addresses, and sends www to the main domain.
 *              GoDaddy Managed WordPress can't remove WordPress, so this hands normal page
 *              visits to the static site while leaving wp-admin, login, the API and payment
 *              callbacks to WordPress. To undo: delete this file.
 */

if (!defined('ABSPATH') || PHP_SAPI === 'cli' || defined('WP_CLI')) {
    return;
}
if (is_admin() || (defined('DOING_AJAX') && DOING_AJAX) || (defined('DOING_CRON') && DOING_CRON)) {
    return;
}

$zk_method = isset($_SERVER['REQUEST_METHOD']) ? strtoupper($_SERVER['REQUEST_METHOD']) : 'GET';
if ($zk_method !== 'GET' && $zk_method !== 'HEAD') {
    return; // POSTs (forms, payment notifications) go to WordPress untouched
}

$zk_uri   = isset($_SERVER['REQUEST_URI']) ? $_SERVER['REQUEST_URI'] : '/';
$zk_path  = parse_url($zk_uri, PHP_URL_PATH);
$zk_path  = is_string($zk_path) && $zk_path !== '' ? $zk_path : '/';
$zk_query = (string) parse_url($zk_uri, PHP_URL_QUERY);

// Leave WordPress's own areas alone
if (preg_match('#^/(wp-admin|wp-login\.php|wp-json|xmlrpc\.php|wp-cron\.php|wp-content|wp-includes)(/|$)#i', $zk_path)) {
    return;
}

$zk_site = 'https://zakaliyasbm-mn.com';

// www.zakaliyasbm-mn.com -> zakaliyasbm-mn.com (path only; query dropped on purpose)
$zk_host = isset($_SERVER['HTTP_HOST']) ? strtolower($_SERVER['HTTP_HOST']) : '';
if (strpos($zk_host, 'www.') === 0) {
    header('Location: ' . $zk_site . $zk_path, true, 301);
    exit;
}

// Old WordPress addresses -> new pages
$zk_redirects = array(
    '#^/home/?$#i'                                   => '/',
    '#^/(about|about-2)/?$#i'                        => '/about-us.html',
    '#^/(contact|contact-3|join-us)/?$#i'            => '/contact.html',
    '#^/(projects01|services)/?$#i'                  => '/projects.html',
    '#^/donation-confirmation/?$#i'                  => '/thank-you.html',
    '#^/(donations(/.*)?|donation-failed|donate)/?$#i' => '/donate.html',
    '#^/(blog|blog-post-title|my-account|my-cart|checkout|shop|donor-dashboard|terms|privacy)/?$#i' => '/',
    '#^/(about-us|projects|contact|thank-you)/?$#i'  => null, // handled below (adds .html)
);
foreach ($zk_redirects as $zk_pattern => $zk_target) {
    if (preg_match($zk_pattern, $zk_path, $zk_m)) {
        if ($zk_target === null) {
            $zk_target = '/' . strtolower($zk_m[1]) . '.html';
        }
        header('Location: ' . $zk_site . $zk_target, true, 301);
        exit;
    }
}

function zakaliya_serve_static($file, $status)
{
    $full = ABSPATH . $file; // fixed file names only, never from the request
    if (!is_readable($full)) {
        return;
    }
    if (function_exists('status_header')) {
        status_header($status);
    } else {
        http_response_code($status);
    }
    header('Content-Type: text/html; charset=utf-8');
    header('Cache-Control: no-cache, must-revalidate');
    header('X-Content-Type-Options: nosniff');
    header('Referrer-Policy: strict-origin-when-cross-origin');
    header('X-Frame-Options: SAMEORIGIN');
    if (isset($_SERVER['REQUEST_METHOD']) && strtoupper($_SERVER['REQUEST_METHOD']) !== 'HEAD') {
        readfile($full);
    }
    exit;
}

// Website editor sign-in page: zakaliyasbm-mn.com/admin (also /edit, /editor, /login)
if (preg_match('#^/(admin|edit|editor|login)/?$#i', $zk_path)) {
    header('X-Robots-Tag: noindex, nofollow');
    zakaliya_serve_static('editor.html', 200);
}

// Home page: our index.html (only plain "/" with no query, so WordPress callbacks like /?give-listener=... still work)
if (($zk_path === '/' || $zk_path === '/index.php') && $zk_query === '') {
    zakaliya_serve_static('index.html', 200);
}

// Any page WordPress can't find: our 404 page instead of the old theme's
add_action('template_redirect', function () {
    if (is_404()) {
        zakaliya_serve_static('404.html', 404);
    }
}, 0);
