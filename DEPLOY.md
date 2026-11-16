# Moving the site to zakaliyasbm-mn.com (FTPS)

Every push to `main` uploads the site with GitHub Actions over **FTPS** (encrypted FTP).
The server details live in GitHub **secrets**, never in the code.

## 1. Before switching: protect the old WordPress site
- In WordPress, go to **Donations (GiveWP) → Donors / Subscriptions**. Check for **active monthly donors**.
  Their monthly payments run through the payment gateway (Stripe or PayPal), not this website. Note who they are
  and decide whether to keep them or move them to the new Stripe links. Export the donor list (CSV).
- Make a full **backup** of the WordPress files and database from the hosting control panel.

## 2. Get the FTPS details from the new host
In the hosting control panel (cPanel → **FTP Accounts**, or similar):
- **Server**: use the host's FTP server name (often `ftp.zakaliyasbm-mn.com` or the server's own hostname shown in the panel).
- **Username / password**: create an FTP account limited to the website folder, with a long random password.
- **Folder**: usually `/public_html/` (must end with `/`).
- Confirm the host supports **FTPS / FTP over TLS** on port 21 (most do).

## 3. Update the GitHub secrets
GitHub → repository **zakaliya** → **Settings → Secrets and variables → Actions** → edit each:

| Secret | Value |
|---|---|
| `FTP_SERVER` | FTP server name from step 2 |
| `FTP_USERNAME` | FTP username |
| `FTP_PASSWORD` | FTP password |
| `FTP_SERVER_DIR` | e.g. `/public_html/` |

Never paste these into chat, email, or any file in the repository.

## 4. Clear the old site from the folder
After the backup, remove the WordPress files from the website folder (or move them to a backup folder outside `public_html`).
The site's `.htaccess` already prefers `index.html`, but leftover WordPress files can still be reached by address.

## 5. Deploy
Push to `main` (or GitHub → **Actions → Deploy to FTPS → Run workflow**). The first upload sends every file.

If it fails with a **certificate** error, the server name doesn't match the host's TLS certificate.
Use the exact hostname the host shows for FTPS. Only as a last resort, change `security: strict` to `security: loose`
in `.github/workflows/main.yml` (still encrypted, but the certificate isn't checked).

## 6. Domain (DNS at GoDaddy) and HTTPS
DNS is managed at **GoDaddy** (nameservers `ns03/ns04.domaincontrol.com`). As of 16 Nov 2026:

| Type | Name | Value |
|---|---|---|
| A | `@` | `160.153.0.42` (old WordPress hosting; this is the rollback value) |
| CNAME | `www` | `@` (keep as is) |
| MX / TXT | none | no domain email to protect |

1. In the new hosting account, add `zakaliyasbm-mn.com` as the account's domain (cPanel: **Domains**), so the host knows to serve it.
2. A day before: GoDaddy → **Domain → DNS** → edit the `@` A record and set **TTL** to the lowest option (e.g. 600 seconds / 1/2 hour).
3. Deploy the site to the new host first (steps 3-5), and optionally preview it via your computer's `hosts` file.
4. Switch: edit the `@` **A** record to the **new host's IP address** (cPanel shows it as "Shared IP Address"). Leave `www` alone.
5. Once the domain points at the new host, run **SSL/TLS Status → Run AutoSSL** (or install the host's free certificate).
6. Rollback if anything goes wrong: set the `@` A record back to `160.153.0.42`.

The site redirects `http://` and `www.` to `https://zakaliyasbm-mn.com/` automatically.

## 7. After going live: check
- https://zakaliyasbm-mn.com/ loads the new home page.
- Old addresses redirect, e.g. `/about/` → About, `/contact/` → Contact, `/donations/...` → Donate.
- A made-up address shows the "page has moved" page.
- `https://` shows a valid padlock (certificate issued by the new host).
- Submit `https://zakaliyasbm-mn.com/sitemap.xml` in Google Search Console.

## 8. Stripe
Payment Links must redirect to `https://zakaliyasbm-mn.com/thank-you.html` after payment.
Paste the links into `assets/donate-links.js`.
