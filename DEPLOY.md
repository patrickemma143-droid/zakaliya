# Deploying zakaliyasbm-mn.com

Every push to `main` uploads the site with GitHub Actions.
Server details live in GitHub **secrets**, never in the code.

| Workflow | Method | Runs |
|---|---|---|
| `deploy-sftp.yml` | **SFTP** (port 22, encrypted) for GoDaddy Managed WordPress | **automatically on every push** (active) |
| `deploy-ftps.yml` | **FTPS** (FTP over TLS) for cPanel-type hosting | only when started by hand (standby) |

The domain already points to the Managed WordPress hosting and HTTPS already works there,
so **no DNS change is needed** for the SFTP route.

---

## A. Before the first upload: back up WordPress
1. GoDaddy → **My Products → Managed WordPress → Manage All → Settings** (the site) → **Backups → Back up now**, then download it.
2. In WordPress: **UpdraftPlus → Backup Now** (database + files) and download every part.
3. GiveWP: export **Donations** and **Donors** to CSV. Check **Donations → Subscriptions** for active monthly donors.
4. Download a copy of WordPress's current **`.htaccess`** (from the site folder, via FileZilla). It's the undo button.
Keep backups private (they contain passwords and donor details): your computer + a private cloud folder.

## B. Get the SFTP login (GoDaddy)
1. **My Products → Managed WordPress → Manage All → Settings** (the site).
2. **Production Site → SSH/SFTP login → Change**. Copy the **Hostname**.
3. **Create New Login** (this replaces any old SFTP login). Copy the **Username** and **Password**.
4. Connect once with **FileZilla** (Host, Username, Password, Port **22**). Accept the host key only if the host is your domain/hostname.
5. Note the folder that contains `wp-config.php` and `wp-content`. That is the site folder (often `/html/`).

## C. Add the GitHub secrets
GitHub → repository → **Settings → Secrets and variables → Actions → New repository secret**:

| Secret | Value |
|---|---|
| `SFTP_HOST` | Hostname from step B2 |
| `SFTP_PORT` | `22` |
| `SFTP_USERNAME` | Username from step B3 |
| `SFTP_PASSWORD` | Password from step B3 |
| `SFTP_DIR` | `html/` (the SFTP login opens one level above the site; `html` holds `wp-config.php`) |
| `SFTP_KNOWN_HOSTS` | The server's host key line (see below) |

**SFTP_KNOWN_HOSTS** pins the server's identity so uploads can't be redirected to a fake server.
Get it by running this on any computer with OpenSSH (Windows 10/11 PowerShell has it), replacing the host:

    ssh-keyscan -p 22 YOUR-SFTP-HOSTNAME

Paste the whole output into the secret. (The host key is public, not a password.)
Never paste the password into chat, email, or any file in the repository.

## D. Check first, then go live
**Safety switch:** a push only *checks* the server (connects and confirms `wp-config.php` is in `SFTP_DIR`) until the
repository **variable** `DEPLOY_LIVE` is `true` (GitHub → Settings → Secrets and variables → Actions → **Variables** tab).
A manual run (Actions → Deploy via SFTP → Run workflow) is also check-only unless you untick **Check only**.
Every upload is refused if `wp-config.php` is not in the target folder.

The site goes live **the moment the first upload finishes** (our `index.html` and `.htaccess` take over), so pick a quiet time,
ideally after the Stripe links are added.
1. Run the check (push, or Run workflow with **Check only** ticked) and confirm it lists `wp-config.php`.
2. Go live: add the variable `DEPLOY_LIVE` = `true`, then re-run the workflow (or push).
3. GoDaddy's cache is cleared automatically after each upload (the run ends with "GoDaddy cache refreshed"). If the run shows a warning instead, flush it by hand: **Managed WordPress → Settings → Tools → Flush Cache → Flush Now**.
4. Check: home page, `/about/` → About, `/donations/...` → Donate, a made-up address → "page has moved", padlock on https.

**Undo:** upload the saved WordPress `.htaccess` again and delete our `index.html`; WordPress takes over again.

## E. After going live
- WordPress stays installed underneath (Managed WordPress doesn't allow removing it). Keep it updated and protect the admin login
  with a strong password + two-step login. Once the GiveWP data is exported, `/wp-admin` can be locked in `.htaccess`.
- Submit `https://zakaliyasbm-mn.com/sitemap.xml` in Google Search Console.
- Stripe Payment Links must redirect to `https://zakaliyasbm-mn.com/thank-you.html`; paste the links into `assets/donate-links.js`.

---

## F. Switching to FTP/FTPS later (e.g. moving to a cPanel plan)
1. In the new host, create an FTP account limited to the website folder. Confirm it supports **FTPS (FTP over TLS)** on port 21.
2. Add/update the secrets `FTP_SERVER`, `FTP_USERNAME`, `FTP_PASSWORD`, `FTP_SERVER_DIR` (e.g. `/public_html/`).
3. In `.github/workflows/deploy-ftps.yml`, add the push trigger back:

       on:
         push:
           branches: [main]
         workflow_dispatch:

4. In `.github/workflows/deploy-sftp.yml`, remove the `push:` and `branches:` lines (keep `workflow_dispatch:`).
5. If the domain moves to that host: in GoDaddy DNS edit the `@` **A** record to the new host's IP
   (rollback value today: `160.153.0.42`; lower the TTL a day before), then turn on the host's free SSL (cPanel: **SSL/TLS Status → Run AutoSSL**).
6. If an FTPS upload fails with a certificate error, use the exact hostname the host shows for FTPS.
   Only as a last resort, change `security: strict` to `security: loose` in `deploy-ftps.yml`.

DNS is managed at **GoDaddy** (nameservers `ns03/ns04.domaincontrol.com`). As of 16 Nov 2026: A `@` → `160.153.0.42`, CNAME `www` → `@`, no MX/TXT records.
