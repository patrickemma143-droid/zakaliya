<?php
/**
 * Plugin Name: Zakaliya website editor
 * Description: Username + password login for the website editor at zakaliyasbm-mn.com/admin.
 *              Editors are WordPress users with the "Website editor" role (Users > Add New).
 *              Their edits are saved to the GitHub repository, which rebuilds and uploads the site.
 *              The GitHub access key is set by an administrator under Settings > Website editor.
 *              To undo: delete this file (the editor stops working; the website is not affected).
 */

if (!defined('ABSPATH')) {
    exit;
}

define('ZK_ED_CAP', 'zakaliya_edit_site');
define('ZK_ED_ROLE', 'zakaliya_editor');
define('ZK_ED_DEFAULT_REPO', 'patrickemma143-droid/zakaliya');
define('ZK_ED_DEFAULT_BRANCH', 'main');
define('ZK_ED_MAX_FAILS', 5);          // failed logins before a 15-minute lock
define('ZK_ED_LOCK_SECONDS', 15 * 60);

/* ------------------------------------------------------------------ accounts */

// The "Website editor" role: can use the website editor, nothing else in WordPress.
add_action('init', function () {
    if (!get_role(ZK_ED_ROLE)) {
        add_role(ZK_ED_ROLE, 'Website editor', array('read' => true, ZK_ED_CAP => true));
    }
});

// Administrators can always use the editor too.
add_filter('user_has_cap', function ($allcaps) {
    if (!empty($allcaps['manage_options'])) {
        $allcaps[ZK_ED_CAP] = true;
    }
    return $allcaps;
});

function zk_ed_is_editor_only($user = null)
{
    $user = $user ?: wp_get_current_user();
    return $user && $user->exists() && user_can($user, ZK_ED_CAP)
        && !user_can($user, 'manage_options') && !user_can($user, 'edit_posts');
}

// Editors go straight to the editor after signing in, and never see the WordPress dashboard.
add_filter('login_redirect', function ($redirect_to, $requested, $user) {
    if ($user instanceof WP_User && zk_ed_is_editor_only($user)) {
        return home_url('/admin/');
    }
    return $redirect_to;
}, 10, 3);

add_action('admin_init', function () {
    if (wp_doing_ajax() || !zk_ed_is_editor_only()) {
        return;
    }
    global $pagenow;
    if (in_array($pagenow, array('profile.php', 'admin-post.php'), true)) {
        return; // they may change their own password
    }
    wp_safe_redirect(home_url('/admin/'));
    exit;
});

add_filter('show_admin_bar', function ($show) {
    return zk_ed_is_editor_only() ? false : $show;
});

/* ------------------------------------------------------- branded login page */

add_action('login_enqueue_scripts', function () {
    wp_enqueue_style('zk-ed-fonts', 'https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600;700;800&display=swap', array(), null);
    wp_enqueue_style('zk-ed-login', home_url('/assets/admin/login.css'), array('login'), '1');
});
add_filter('login_headerurl', function () {
    return home_url('/');
});
add_filter('login_headertext', function () {
    return 'Zakaliya Shared Blessings Ministry';
});
add_filter('login_title', function () {
    return 'Sign in - Zakaliya website editor';
});
add_filter('login_message', function ($message) {
    $action = isset($_REQUEST['action']) ? sanitize_key($_REQUEST['action']) : 'login';
    if ($action === 'login' && empty($_GET['loggedout'])) {
        $message .= '<p class="zk-login-intro"><strong>Website editor</strong>Sign in with the username and password the website admin gave you.</p>';
    }
    return $message;
});
// One message for a wrong username or password, so the login doesn't reveal which usernames exist.
add_filter('login_errors', function ($errors) {
    if (strpos((string) $errors, 'zk-locked') !== false) {
        return $errors;
    }
    if (preg_match('/incorrect|invalid username|not registered|unknown email/i', wp_strip_all_tags((string) $errors))) {
        return '<strong>Sign-in failed.</strong> The username or password is incorrect.';
    }
    return $errors;
});

/* ----------------------------------------------- brute-force protection */

function zk_ed_fail_key($username)
{
    $ip = isset($_SERVER['REMOTE_ADDR']) ? $_SERVER['REMOTE_ADDR'] : '';
    return 'zk_ed_fail_' . md5(strtolower(trim((string) $username)) . '|' . $ip);
}

add_action('wp_login_failed', function ($username) {
    $key = zk_ed_fail_key($username);
    set_transient($key, (int) get_transient($key) + 1, ZK_ED_LOCK_SECONDS);
});

add_filter('authenticate', function ($user, $username) {
    if ($username !== '' && $username !== null && (int) get_transient(zk_ed_fail_key($username)) >= ZK_ED_MAX_FAILS) {
        return new WP_Error('zk_locked', '<span class="zk-locked"></span><strong>Too many attempts.</strong> Please wait 15 minutes, then try again.');
    }
    return $user;
}, 99, 2);

add_action('wp_login', function ($username) {
    delete_transient(zk_ed_fail_key($username));
});

/* ------------------------------------------------------- GitHub connection */

function zk_ed_secret_key()
{
    $material = (defined('AUTH_KEY') ? AUTH_KEY : '') . (defined('SECURE_AUTH_KEY') ? SECURE_AUTH_KEY : '') . 'zakaliya-editor';
    return sodium_crypto_generichash($material, '', SODIUM_CRYPTO_SECRETBOX_KEYBYTES);
}

function zk_ed_store_token($token)
{
    if ($token === '') {
        delete_option('zakaliya_editor_token');
        return;
    }
    $nonce = random_bytes(SODIUM_CRYPTO_SECRETBOX_NONCEBYTES);
    $box   = sodium_crypto_secretbox($token, $nonce, zk_ed_secret_key());
    update_option('zakaliya_editor_token', base64_encode($nonce . $box), false);
}

function zk_ed_token()
{
    if (defined('ZAKALIYA_GITHUB_TOKEN') && ZAKALIYA_GITHUB_TOKEN) {
        return ZAKALIYA_GITHUB_TOKEN; // optional: set in wp-config.php instead of the settings page
    }
    $stored = get_option('zakaliya_editor_token', '');
    if (!$stored) {
        return '';
    }
    $raw = base64_decode($stored, true);
    if ($raw === false || strlen($raw) <= SODIUM_CRYPTO_SECRETBOX_NONCEBYTES) {
        return '';
    }
    $plain = sodium_crypto_secretbox_open(
        substr($raw, SODIUM_CRYPTO_SECRETBOX_NONCEBYTES),
        substr($raw, 0, SODIUM_CRYPTO_SECRETBOX_NONCEBYTES),
        zk_ed_secret_key()
    );
    return $plain === false ? '' : $plain;
}

function zk_ed_repo()
{
    $repo = get_option('zakaliya_editor_repo', ZK_ED_DEFAULT_REPO);
    return preg_match('#^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$#', $repo) ? $repo : ZK_ED_DEFAULT_REPO;
}

function zk_ed_branch()
{
    $branch = get_option('zakaliya_editor_branch', ZK_ED_DEFAULT_BRANCH);
    return preg_match('#^[A-Za-z0-9_./-]+$#', $branch) ? $branch : ZK_ED_DEFAULT_BRANCH;
}

/** Calls the GitHub API. Returns array(status code, decoded body). */
function zk_ed_github($method, $path, $body = null)
{
    $token = zk_ed_token();
    if ($token === '') {
        return array(0, array('message' => 'not configured'));
    }
    $args = array(
        'method'  => $method,
        'timeout' => 45,
        'headers' => array(
            'Authorization'        => 'Bearer ' . $token,
            'Accept'               => 'application/vnd.github+json',
            'X-GitHub-Api-Version' => '2022-11-28',
            'User-Agent'           => 'zakaliya-website-editor',
        ),
    );
    if ($body !== null) {
        $args['headers']['Content-Type'] = 'application/json';
        $args['body'] = wp_json_encode($body);
    }
    $url = (strpos($path, 'https://') === 0) ? $path : 'https://api.github.com' . $path;
    $res = wp_remote_request($url, $args);
    if (is_wp_error($res)) {
        return array(0, array('message' => $res->get_error_message()));
    }
    return array((int) wp_remote_retrieve_response_code($res), json_decode(wp_remote_retrieve_body($res), true));
}

/* ------------------------------------------------------------ editor API */
// All calls are POSTs to /wp-admin/admin-ajax.php (never cached), checked against the
// signed-in user's role and a per-session security code (nonce).

function zk_ed_fail($message, $status = 400, $extra = array())
{
    wp_send_json(array_merge(array('ok' => false, 'error' => $message), $extra), $status);
}

function zk_ed_guard()
{
    nocache_headers();
    if (!is_user_logged_in()) {
        zk_ed_fail('Your session has ended. Please sign in again.', 401, array('signin' => true));
    }
    if (!current_user_can(ZK_ED_CAP)) {
        zk_ed_fail('Your account does not have access to the website editor.', 403);
    }
    if (!check_ajax_referer('zakaliya_editor', '_nonce', false)) {
        zk_ed_fail('Your session has expired. Please reload the page.', 403, array('reload' => true));
    }
    if (zk_ed_token() === '') {
        zk_ed_fail('The editor is not connected to GitHub yet. An administrator must add the access key under Settings > Website editor.', 503);
    }
}

// Who is signed in (also answers signed-out visitors, so the editor page can send them to the login).
function zk_ed_session()
{
    nocache_headers();
    $login = wp_login_url(home_url('/admin/'));
    if (!is_user_logged_in()) {
        wp_send_json(array('ok' => true, 'signedIn' => false, 'loginUrl' => $login));
    }
    $user = wp_get_current_user();
    wp_send_json(array(
        'ok'         => true,
        'signedIn'   => true,
        'allowed'    => current_user_can(ZK_ED_CAP),
        'name'       => $user->display_name ?: $user->user_login,
        'isAdmin'    => current_user_can('manage_options'),
        'configured' => zk_ed_token() !== '',
        'nonce'      => wp_create_nonce('zakaliya_editor'),
        'logoutUrl'  => wp_logout_url(home_url('/admin/')),
        'profileUrl' => admin_url('profile.php'),
        'usersUrl'   => current_user_can('list_users') ? admin_url('users.php') : '',
        'settingsUrl'=> current_user_can('manage_options') ? admin_url('options-general.php?page=zakaliya-editor') : '',
        'loginUrl'   => $login,
    ));
}
add_action('wp_ajax_zakaliya_session', 'zk_ed_session');
add_action('wp_ajax_nopriv_zakaliya_session', 'zk_ed_session');
// Signed-out calls (e.g. the session ended while editing) get a clear answer instead of WordPress's bare "0"
foreach (array('load', 'upload', 'save') as $zk_ed_action) {
    add_action('wp_ajax_nopriv_zakaliya_' . $zk_ed_action, 'zk_ed_guard');
}

// Everything the editor needs in one GitHub request: the form definitions (.pages.yml),
// every content file with its version id, and the list of photos.
add_action('wp_ajax_zakaliya_load', function () {
    zk_ed_guard();
    list($owner, $name) = explode('/', zk_ed_repo(), 2);
    $b = zk_ed_branch();
    $blob = '... on Blob { text oid }';
    $tree = '... on Tree { entries { name type oid object { ' . $blob . ' } } }';
    $query = 'query($owner:String!,$name:String!,$ref:String!,$schema:String!,$content:String!,$assets:String!){
      repository(owner:$owner,name:$name){
        ref(qualifiedName:$ref){ target{ oid } }
        schema: object(expression:$schema){ ' . $blob . ' }
        content: object(expression:$content){ ... on Tree { entries { name type oid object { ' . $blob . ' ' . $tree . ' } } } }
        assets: object(expression:$assets){ ... on Tree { entries { name type object { ... on Tree { entries { name type } } } } } }
      }
    }';
    list($code, $res) = zk_ed_github('POST', '/graphql', array('query' => $query, 'variables' => array(
        'owner' => $owner, 'name' => $name, 'ref' => 'refs/heads/' . $b,
        'schema' => $b . ':.pages.yml', 'content' => $b . ':content', 'assets' => $b . ':assets',
    )));
    $repo = isset($res['data']['repository']) ? $res['data']['repository'] : null;
    if ($code !== 200 || !$repo || empty($repo['schema']['text'])) {
        $msg = isset($res['errors'][0]['message']) ? $res['errors'][0]['message'] : (isset($res['message']) ? $res['message'] : 'HTTP ' . $code);
        zk_ed_fail('Could not load the website content from GitHub (' . $msg . '). Check the access key under Settings > Website editor.', 502);
    }
    $files = array();
    $walk = function ($entries, $prefix) use (&$walk, &$files) {
        foreach ((array) $entries as $e) {
            $path = $prefix . $e['name'];
            if ($e['type'] === 'blob' && preg_match('/\.ya?ml$/', $e['name']) && isset($e['object']['text'])) {
                $files[$path] = array('text' => $e['object']['text'], 'oid' => $e['oid']);
            } elseif ($e['type'] === 'tree' && isset($e['object']['entries'])) {
                foreach ($e['object']['entries'] as $child) {
                    if ($child['type'] === 'blob' && preg_match('/\.ya?ml$/', $child['name']) && isset($child['object']['text'])) {
                        $files[$path . '/' . $child['name']] = array('text' => $child['object']['text'], 'oid' => $child['oid']);
                    }
                }
            }
        }
    };
    $walk(isset($repo['content']['entries']) ? $repo['content']['entries'] : array(), 'content/');
    $images = array();
    foreach ((array) (isset($repo['assets']['entries']) ? $repo['assets']['entries'] : array()) as $e) {
        if ($e['type'] === 'blob' && preg_match('/\.(jpe?g|png|webp|gif)$/i', $e['name'])) {
            $images[] = '/assets/' . $e['name'];
        } elseif ($e['type'] === 'tree' && isset($e['object']['entries'])) {
            foreach ($e['object']['entries'] as $child) {
                if ($child['type'] === 'blob' && preg_match('/\.(jpe?g|png|webp|gif)$/i', $child['name'])) {
                    $images[] = '/assets/' . $e['name'] . '/' . $child['name'];
                }
            }
        }
    }
    wp_send_json(array(
        'ok'     => true,
        'head'   => isset($repo['ref']['target']['oid']) ? $repo['ref']['target']['oid'] : '',
        'schema' => $repo['schema']['text'],
        'files'  => $files,
        'images' => $images,
    ));
});

// Photo upload: checked, resized to at most 2400px, metadata (like GPS location) removed,
// then stored in GitHub. It only becomes part of the website when the page is saved.
add_action('wp_ajax_zakaliya_upload', function () {
    zk_ed_guard();
    if (empty($_FILES['file']) || !is_array($_FILES['file']) || (int) $_FILES['file']['error'] !== UPLOAD_ERR_OK) {
        zk_ed_fail('The photo did not arrive. Please try again with a smaller photo.');
    }
    $tmp = $_FILES['file']['tmp_name'];
    if (!is_uploaded_file($tmp) || filesize($tmp) > 20 * 1024 * 1024) {
        zk_ed_fail('That photo is too large. Please use a photo under 20 MB.');
    }
    $info = @getimagesize($tmp);
    $types = array(IMAGETYPE_JPEG => 'jpg', IMAGETYPE_PNG => 'png', IMAGETYPE_WEBP => 'webp');
    if (!$info || !isset($types[$info[2]])) {
        zk_ed_fail('Please upload a JPG, PNG or WebP photo.');
    }
    $ext = $types[$info[2]];
    $mime = array('jpg' => 'image/jpeg', 'png' => 'image/png', 'webp' => 'image/webp');

    $bytes = null;
    $width = (int) $info[0];
    $height = (int) $info[1];
    $editor = wp_get_image_editor($tmp);
    if (!is_wp_error($editor)) {
        $editor->set_quality(82);
        if ($width > 2400 || $height > 2400) {
            $editor->resize(2400, 2400, false);
        }
        $out = wp_tempnam('zk-photo') . '.' . $ext;
        $saved = $editor->save($out, $mime[$ext]);
        if (!is_wp_error($saved) && is_readable($saved['path'])) {
            $bytes = file_get_contents($saved['path']);
            $width = (int) $saved['width'];
            $height = (int) $saved['height'];
            @unlink($saved['path']);
        }
        @unlink($out);
    }
    if ($bytes === null) {
        if (filesize($tmp) > 6 * 1024 * 1024) {
            zk_ed_fail('The server could not shrink this photo. Please use a photo under 6 MB.');
        }
        $bytes = file_get_contents($tmp);
    }

    $original = isset($_FILES['file']['name']) ? pathinfo((string) $_FILES['file']['name'], PATHINFO_FILENAME) : 'photo';
    $base = substr(sanitize_title($original), 0, 48);
    $base = trim(preg_replace('/[^a-z0-9-]+/', '-', $base), '-') ?: 'photo';
    $name = $base . '-' . strtolower(wp_generate_password(6, false, false)) . '.' . $ext;

    list($o, $r) = explode('/', zk_ed_repo(), 2);
    list($code, $res) = zk_ed_github('POST', "/repos/$o/$r/git/blobs", array('content' => base64_encode($bytes), 'encoding' => 'base64'));
    if ($code !== 201 || empty($res['sha'])) {
        zk_ed_fail('Could not store the photo in GitHub (' . (isset($res['message']) ? $res['message'] : 'HTTP ' . $code) . ').', 502);
    }
    wp_send_json(array(
        'ok'     => true,
        'path'   => '/assets/uploads/' . $name,
        'sha'    => $res['sha'],
        'width'  => $width,
        'height' => $height,
        'size'   => strlen($bytes),
    ));
});

// Which files editors may change (everything else in the repository is off limits).
function zk_ed_allowed_path($path, $isNew)
{
    if (preg_match('#^content/projects/[a-z0-9][a-z0-9-]{0,80}\.yml$#', $path)) {
        return true;                        // projects may be added and removed
    }
    if ($isNew) {
        return false;                       // other files can only be changed, not created
    }
    return (bool) preg_match('#^content/((site|verses)\.yml|pages/[a-z0-9-]+\.yml)$#', $path);
}

// Save: one GitHub commit with every changed file and new photo. Refuses to overwrite a file
// someone else changed since it was opened.
add_action('wp_ajax_zakaliya_save', function () {
    zk_ed_guard();
    $payload = json_decode(wp_unslash(isset($_POST['payload']) ? $_POST['payload'] : ''), true);
    if (!is_array($payload)) {
        zk_ed_fail('Nothing to save.');
    }
    $changes = isset($payload['changes']) && is_array($payload['changes']) ? $payload['changes'] : array();
    $deletes = isset($payload['deletes']) && is_array($payload['deletes']) ? $payload['deletes'] : array();
    $uploads = isset($payload['uploads']) && is_array($payload['uploads']) ? $payload['uploads'] : array();
    $summary = isset($payload['summary']) ? sanitize_text_field($payload['summary']) : '';
    if (!$changes && !$deletes) {
        zk_ed_fail('Nothing to save.');
    }
    if (count($changes) + count($deletes) > 20 || count($uploads) > 60) {
        zk_ed_fail('Too many changes at once. Please save in smaller steps.');
    }

    $entries = array();
    $expect = array();   // path => blob id the editor started from (null = new file)
    foreach ($changes as $c) {
        $path = isset($c['path']) ? (string) $c['path'] : '';
        $text = isset($c['text']) ? (string) $c['text'] : '';
        $oid  = isset($c['oid']) && $c['oid'] ? (string) $c['oid'] : null;
        if (!zk_ed_allowed_path($path, $oid === null)) {
            zk_ed_fail('That file can not be changed from the editor: ' . $path, 403);
        }
        if ($text === '' || strlen($text) > 300000 || !mb_check_encoding($text, 'UTF-8') || strpos($text, "\0") !== false) {
            zk_ed_fail('The content of ' . $path . ' is empty or not valid.');
        }
        $entries[] = array('path' => $path, 'mode' => '100644', 'type' => 'blob', 'content' => $text);
        $expect[$path] = $oid;
    }
    foreach ($deletes as $d) {
        $path = isset($d['path']) ? (string) $d['path'] : '';
        $oid  = isset($d['oid']) ? (string) $d['oid'] : '';
        if (!preg_match('#^content/projects/[a-z0-9][a-z0-9-]{0,80}\.yml$#', $path) || $oid === '') {
            zk_ed_fail('Only projects can be removed.', 403);
        }
        $entries[] = array('path' => $path, 'mode' => '100644', 'type' => 'blob', 'sha' => null);
        $expect[$path] = $oid;
    }
    foreach ($uploads as $u) {
        $path = isset($u['path']) ? ltrim((string) $u['path'], '/') : '';
        $sha  = isset($u['sha']) ? (string) $u['sha'] : '';
        if (!preg_match('#^assets/uploads/[a-z0-9-]+\.(jpg|png|webp)$#', $path) || !preg_match('/^[0-9a-f]{40}$/', $sha)) {
            zk_ed_fail('A photo upload is not valid. Please upload it again.');
        }
        $entries[] = array('path' => $path, 'mode' => '100644', 'type' => 'blob', 'sha' => $sha);
    }

    $user = wp_get_current_user();
    $who = preg_replace('/[^\p{L}\p{N} .\'-]/u', '', $user->display_name ?: $user->user_login);
    $paths = array_keys($expect);
    $message = 'Website edit: ' . ($summary !== '' ? $summary : implode(', ', $paths)) . ' (' . $who . ')';

    list($o, $r) = explode('/', zk_ed_repo(), 2);
    $branch = zk_ed_branch();
    for ($attempt = 1; $attempt <= 3; $attempt++) {
        list($code, $ref) = zk_ed_github('GET', "/repos/$o/$r/git/ref/heads/" . $branch);
        if ($code !== 200 || empty($ref['object']['sha'])) {
            zk_ed_fail('Could not reach GitHub (HTTP ' . $code . '). Please try again.', 502);
        }
        $head = $ref['object']['sha'];
        list($code, $commit) = zk_ed_github('GET', "/repos/$o/$r/git/commits/$head");
        if ($code !== 200 || empty($commit['tree']['sha'])) {
            zk_ed_fail('Could not read the latest version from GitHub. Please try again.', 502);
        }
        $baseTree = $commit['tree']['sha'];

        // Has someone else changed one of these files in the meantime?
        list($code, $tree) = zk_ed_github('GET', "/repos/$o/$r/git/trees/$baseTree?recursive=1");
        if ($code !== 200 || !isset($tree['tree'])) {
            zk_ed_fail('Could not check the latest version on GitHub. Please try again.', 502);
        }
        $current = array();
        foreach ($tree['tree'] as $t) {
            if (isset($expect[$t['path']]) || array_key_exists($t['path'], $expect)) {
                $current[$t['path']] = $t['sha'];
            }
        }
        foreach ($expect as $path => $oid) {
            $now = isset($current[$path]) ? $current[$path] : null;
            if ($oid === null && $now !== null) {
                zk_ed_fail('A project with this name already exists. Please choose a different name.', 409, array('conflict' => $path));
            }
            if ($oid !== null && $now !== $oid) {
                zk_ed_fail('Someone else saved changes to this page while you were editing. Reload to get the latest version, then make your change again.', 409, array('conflict' => $path));
            }
        }

        list($code, $newTree) = zk_ed_github('POST', "/repos/$o/$r/git/trees", array('base_tree' => $baseTree, 'tree' => $entries));
        if ($code !== 201 || empty($newTree['sha'])) {
            zk_ed_fail('GitHub did not accept the changes (' . (isset($newTree['message']) ? $newTree['message'] : 'HTTP ' . $code) . ').', 502);
        }
        list($code, $newCommit) = zk_ed_github('POST', "/repos/$o/$r/git/commits", array(
            'message' => $message,
            'tree'    => $newTree['sha'],
            'parents' => array($head),
            // The repository is public, so the editor's own email address is never published.
            'author'  => array('name' => $who . ' (website editor)', 'email' => 'website-editor@zakaliyasbm-mn.com', 'date' => gmdate('c')),
        ));
        if ($code !== 201 || empty($newCommit['sha'])) {
            zk_ed_fail('GitHub did not accept the changes (' . (isset($newCommit['message']) ? $newCommit['message'] : 'HTTP ' . $code) . ').', 502);
        }
        list($code, $moved) = zk_ed_github('PATCH', "/repos/$o/$r/git/refs/heads/" . $branch, array('sha' => $newCommit['sha'], 'force' => false));
        if ($code === 200) {
            // New version ids of the saved files (Git's blob id), so the next save from this page
            // isn't mistaken for a conflict.
            $oids = array();
            foreach ($entries as $e) {
                if (isset($e['content'])) {
                    $oids[$e['path']] = sha1('blob ' . strlen($e['content']) . "\0" . $e['content']);
                }
            }
            wp_send_json(array('ok' => true, 'commit' => $newCommit['sha'], 'oids' => $oids));
        }
        if ($code !== 422 && $code !== 409) {
            zk_ed_fail('GitHub did not accept the changes (HTTP ' . $code . ').', 502);
        }
        // Someone else saved at the same moment: start again from their version.
    }
    zk_ed_fail('GitHub is busy. Please click Save again.', 503);
});

/* ------------------------------------------- settings page (administrators) */

add_action('admin_menu', function () {
    add_options_page('Website editor', 'Website editor', 'manage_options', 'zakaliya-editor', 'zk_ed_settings_page');
});

function zk_ed_settings_page()
{
    if (!current_user_can('manage_options')) {
        return;
    }
    $notice = '';
    if (isset($_POST['zk_ed_save']) && check_admin_referer('zk_ed_settings')) {
        $repo = isset($_POST['zk_repo']) ? trim(sanitize_text_field(wp_unslash($_POST['zk_repo']))) : '';
        $branch = isset($_POST['zk_branch']) ? trim(sanitize_text_field(wp_unslash($_POST['zk_branch']))) : '';
        if (preg_match('#^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$#', $repo)) {
            update_option('zakaliya_editor_repo', $repo, false);
        }
        if (preg_match('#^[A-Za-z0-9_./-]+$#', $branch)) {
            update_option('zakaliya_editor_branch', $branch, false);
        }
        $token = isset($_POST['zk_token']) ? trim(wp_unslash($_POST['zk_token'])) : '';
        if (!empty($_POST['zk_remove'])) {
            zk_ed_store_token('');
            $notice = 'The access key was removed. The editor is now disconnected.';
        } elseif ($token !== '') {
            if (!preg_match('/^(github_pat_|ghp_)[A-Za-z0-9_]{20,}$/', $token)) {
                $notice = 'That does not look like a GitHub access key (it should start with github_pat_). Nothing was saved.';
            } else {
                zk_ed_store_token($token);
                $notice = 'Access key saved.';
            }
        } else {
            $notice = 'Settings saved.';
        }
    }

    // Connection check
    $status = 'Not connected: no access key yet.';
    $ok = false;
    if (zk_ed_token() !== '') {
        list($o, $r) = explode('/', zk_ed_repo(), 2);
        list($code, $res) = zk_ed_github('GET', "/repos/$o/$r");
        if ($code === 200 && !empty($res['permissions']['push'])) {
            $status = 'Connected to ' . esc_html(zk_ed_repo()) . '. Editors can save.';
            $ok = true;
        } elseif ($code === 200) {
            $status = 'The key can read ' . esc_html(zk_ed_repo()) . ' but can not save to it. Give it "Contents: Read and write" permission.';
        } elseif ($code === 401) {
            $status = 'GitHub rejected the access key (it may have expired). Create a new one and paste it below.';
        } else {
            $status = 'Could not reach ' . esc_html(zk_ed_repo()) . ' (HTTP ' . (int) $code . '). Check the repository name and the key\'s repository access.';
        }
    }
    $hasKey = get_option('zakaliya_editor_token', '') !== '' || (defined('ZAKALIYA_GITHUB_TOKEN') && ZAKALIYA_GITHUB_TOKEN);
    ?>
    <div class="wrap">
      <h1>Website editor</h1>
      <?php if ($notice) : ?><div class="notice notice-info"><p><?php echo esc_html($notice); ?></p></div><?php endif; ?>
      <div class="notice <?php echo $ok ? 'notice-success' : 'notice-warning'; ?> inline"><p><strong>Status:</strong> <?php echo $status; // escaped above ?></p></div>
      <p>The editor is at <a href="<?php echo esc_url(home_url('/admin/')); ?>" target="_blank" rel="noopener"><?php echo esc_html(home_url('/admin/')); ?></a>.
         To give someone access: <a href="<?php echo esc_url(admin_url('user-new.php')); ?>">Users &rarr; Add New</a>, role <strong>Website editor</strong>.</p>
      <form method="post">
        <?php wp_nonce_field('zk_ed_settings'); ?>
        <table class="form-table" role="presentation">
          <tr><th scope="row"><label for="zk_token">GitHub access key</label></th>
              <td><input type="password" id="zk_token" name="zk_token" class="regular-text" autocomplete="off" placeholder="<?php echo $hasKey ? esc_attr('Saved (hidden). Paste a new key to replace it.') : 'github_pat_...'; ?>">
              <p class="description">A fine-grained personal access token for this repository only, with <strong>Contents: Read and write</strong>. It is stored encrypted and never shown again.</p>
              <?php if ($hasKey) : ?><p><label><input type="checkbox" name="zk_remove" value="1"> Remove the saved key (disconnects the editor)</label></p><?php endif; ?></td></tr>
          <tr><th scope="row"><label for="zk_repo">Repository</label></th>
              <td><input type="text" id="zk_repo" name="zk_repo" class="regular-text" value="<?php echo esc_attr(zk_ed_repo()); ?>"></td></tr>
          <tr><th scope="row"><label for="zk_branch">Branch</label></th>
              <td><input type="text" id="zk_branch" name="zk_branch" class="regular-text" value="<?php echo esc_attr(zk_ed_branch()); ?>"></td></tr>
        </table>
        <?php submit_button('Save', 'primary', 'zk_ed_save'); ?>
      </form>
    </div>
    <?php
}
