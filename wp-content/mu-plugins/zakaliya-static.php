<?php
/**
 * Plugin Name: Zakaliya static site
 * Description: Serves the static Zakaliya website (pages/*.html) at clean addresses in front of WordPress,
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

// Old WordPress addresses -> the new clean addresses (zakaliyasbm-mn.com/about, /projects, ...)
$zk_redirects = array(
    '#^/home/?$#i'                                   => '/',
    '#^/(about-2|about-us)/?$#i'                     => '/about',
    '#^/(contact-3|join-us)/?$#i'                    => '/contact',
    '#^/(projects01|services)/?$#i'                  => '/projects',
    '#^/donation-confirmation/?$#i'                  => '/thank-you',
    '#^/(donations(/.*)?|donation-failed)/?$#i'      => '/donate',
    '#^/(blog|blog-post-title|my-account|my-cart|checkout|shop|donor-dashboard|terms|privacy)/?$#i' => '/',
);
foreach ($zk_redirects as $zk_pattern => $zk_target) {
    if (preg_match($zk_pattern, $zk_path)) {
        header('Location: ' . $zk_site . $zk_target, true, 301);
        exit;
    }
}

function zakaliya_serve_static($file, $status)
{
    $full = ABSPATH . $file; // fixed file names, or a project name checked against [a-z0-9-] below
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

// The built pages live in /pages (pages/about.html, pages/projects/farming.html, ...) and are shown at
// clean addresses. Old addresses (/about-us.html, /project-farming.html, /about/) still open the same
// page, which then shows the clean address in the browser (no redirect, so browsers that remembered
// the old /about -> /about-us.html redirect can't end up in a loop).

// Website editor: zakaliyasbm-mn.com/admin (also /edit, /editor, /login, /editor.html)
if (preg_match('#^/(admin|edit|editor|login)/?$|^/editor\.html$#i', $zk_path)) {
    header('X-Robots-Tag: noindex, nofollow');
    zakaliya_serve_static('pages/editor.html', 200);
}

// Home page (only plain "/" with no query, so WordPress callbacks like /?give-listener=... still work)
if ((($zk_path === '/' || $zk_path === '/index.php') && $zk_query === '') || $zk_path === '/index.html') {
    zakaliya_serve_static('pages/home.html', 200);
}

// Main pages: /about, /projects, /contact, /donate, /thank-you
if (preg_match('#^/(about|about-us|projects|contact|donate|thank-you)(/|\.html)?$#', $zk_path, $zk_m)) {
    zakaliya_serve_static('pages/' . ($zk_m[1] === 'about-us' ? 'about' : $zk_m[1]) . '.html', 200);
}

// Project pages: /projects/farming (old address: /project-farming.html)
if (preg_match('#^/projects/([a-z0-9][a-z0-9-]{0,80})/?$#', $zk_path, $zk_m)
    || preg_match('#^/project-([a-z0-9][a-z0-9-]{0,80})\.html$#', $zk_path, $zk_m)) {
    zakaliya_serve_static('pages/projects/' . $zk_m[1] . '.html', 200);
}

// Any page WordPress can't find: our 404 page instead of the old theme's
add_action('template_redirect', function () {
    if (is_404()) {
        zakaliya_serve_static('pages/404.html', 404);
    }
}, 0);
