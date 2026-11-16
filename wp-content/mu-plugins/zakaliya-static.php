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

/**
 * Automatic cache refresh after each upload (called by the GitHub deploy workflow:
 * POST https://zakaliyasbm-mn.com/?zakaliya-refresh=1).
 * Uses the same calls as GoDaddy's own "wp cache flush" command. It needs no password because it
 * only flushes once per new build: every upload writes a new build-id.txt, and calls made for a
 * build that was already refreshed do nothing.
 */
function zakaliya_refresh_cache()
{
    nocache_headers();
    $file  = ABSPATH . 'build-id.txt';
    $build = is_readable($file) ? trim((string) file_get_contents($file, false, null, 0, 200)) : '';
    if ($build === '') {
        wp_send_json(array('flushed' => false, 'reason' => 'no build id'), 200);
    }
    if (hash_equals((string) get_option('zakaliya_flushed_build', ''), $build)) {
        wp_send_json(array('flushed' => false, 'reason' => 'already refreshed for this build', 'build' => $build), 200);
    }
    if (get_transient('zakaliya_flush_lock')) {
        wp_send_json(array('flushed' => false, 'reason' => 'busy, try again shortly'), 429);
    }
    set_transient('zakaliya_flush_lock', 1, 30);

    $cache = isset($GLOBALS['wpaas_cache_class']) ? $GLOBALS['wpaas_cache_class'] : null;
    $steps = array();
    try {
        if ($cache && method_exists($cache, 'do_ban')) {          // page cache (Varnish)
            $cache->do_ban();
            $steps[] = 'page';
        } elseif ($cache && method_exists($cache, 'ban')) {
            $cache->ban();
            $steps[] = 'page';
        }
        $platform = class_exists('\WPaaS\Hosting_API') && method_exists('\WPaaS\Hosting_API', 'is_available')
            && \WPaaS\Hosting_API::is_available();
        if ($platform) {
            $steps[] = 'cdn (by platform)';                           // CDN flushed by GoDaddy itself
        } elseif ($cache && method_exists($cache, 'flush_cdn')) {
            $cache->flush_cdn();
            $steps[] = 'cdn';
        }
    } catch (\Throwable $e) {
        delete_transient('zakaliya_flush_lock');
        wp_send_json(array('flushed' => false, 'reason' => 'cache error'), 500);
    }
    if (!$steps) {
        delete_transient('zakaliya_flush_lock');
        wp_send_json(array('flushed' => false, 'reason' => 'GoDaddy cache tools not found'), 500);
    }
    update_option('zakaliya_flushed_build', $build, false);
    update_option('gd_system_last_cache_flush', time());
    wp_send_json(array('flushed' => true, 'build' => $build, 'steps' => $steps), 200);
}
if (isset($_GET['zakaliya-refresh'])) {
    add_action('init', 'zakaliya_refresh_cache', 999); // after GoDaddy's system plugin has loaded
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
