# Editing the website

Editors sign in at **https://zakaliyasbm-mn.com/admin** with a **username and password** that the admin gives them.
Every save goes to GitHub, which rebuilds the site, uploads it to GoDaddy and clears GoDaddy's cache automatically
(about 2 minutes; the editor shows "Live on the website" when it's done). Every change is kept in the history and can be undone.

How it fits together:
- **Sign-in and accounts:** WordPress's own login (already on the GoDaddy hosting), branded for Zakaliya. Editors never see WordPress.
- **The editor:** `assets/admin/editor.js`. Its forms are built from `.pages.yml`.
- **Saving:** `wp-content/mu-plugins/zakaliya-editor.php` commits the changed files to GitHub with an access key that only the server knows.

## One-time setup (admin)

### 1. Create the GitHub access key
1. On github.com (signed in as the repository owner): profile picture → **Settings** → **Developer settings** → **Personal access tokens** → **Fine-grained tokens** → **Generate new token**.
2. **Name:** `Zakaliya website editor`. **Expiration:** 1 year (put a reminder in your calendar to renew it).
3. **Repository access:** **Only select repositories** → `zakaliya`.
4. **Permissions** → **Repository permissions** → **Contents: Read and write**. Leave everything else as it is.
5. **Generate token** and copy it (it starts with `github_pat_`). Don't paste it anywhere else: not in chat, email or a file.

### 2. Connect the editor
1. Go to https://zakaliyasbm-mn.com/wp-admin and sign in with your WordPress administrator account.
2. **Settings → Website editor** → paste the key → **Save**.
3. The status must say **Connected to patrickemma143-droid/zakaliya. Editors can save.**

The key is stored encrypted. To renew it later, paste a new key the same way. To disconnect the editor, tick **Remove the saved key**.

## Give someone access
1. In WordPress: **Users → Add New User**.
2. Fill in a **username** and their **email**. Set a strong **password** (or keep the suggested one).
3. **Role: Website editor** (not Administrator), then **Add New User**.
4. Send them the username and password privately (in person, by phone or SMS; not in a public group).

To remove someone: **Users** → hover over their name → **Delete**. To reset a password: open the user → **Set New Password**.
Editors can change their own password in the editor (round initials button → **Change my password**) and can use **Lost your password?** on the sign-in page.

What the **Website editor** role can do: open the editor and save content and photos. It can't open the WordPress dashboard, plugins
or settings, can't change the website's code, and can't add other users. After 5 wrong passwords, that username is locked for 15 minutes.

## What editors can change
| In the editor | What it controls |
|---|---|
| **Pages → Home page, About us, Projects page, Donate page, Contact page, Thank-you page, Page-not-found page** | Every heading, paragraph, button label and photo on those pages, plus the Google title and description |
| **Projects** | Each project: completed/ongoing, order, photos, home-page card, Projects-page text, its own page (facts, progress updates with dates and photos, gallery). **Add project** creates a new project with its own page. **Remove** takes it off the website. |
| **Verse of the day** | The list of verses (one is shown each day) |
| **Website settings** | Ministry name, logo, menu labels, footer, email, phone, address, Facebook and YouTube links |
| **Donate page → Stripe donation links** | The Stripe Payment Links behind each amount (only `https://buy.stripe.com/` links are accepted) |

The page layout and design are fixed in the code, so an edit can't break the design.

## Tips for editors
- **Save & publish** appears at the bottom as soon as something changes. You can change several pages and save them together.
- **Photos:** use **Upload photo** (phones are fine: photos are made smaller automatically and their location data is removed) or
  **Choose from website photos**. Always fill in **Describe the photo**.
- **Bold text:** in text boxes with a toolbar, select words and click **B**.
- **New progress update:** open the project → **Progress updates** → **Add update** (it's added at the top).
- Fields marked **\*** must be filled in. If something is missing, the editor points to it when you save.
- If someone else saved the same page while you were editing, the editor asks you to reload so nothing is overwritten.
- If a change doesn't appear after 5 minutes, refresh the page (Ctrl + F5). If it still doesn't, flush GoDaddy's cache by hand (Managed WordPress → Settings → Tools → Flush Cache); the GitHub run will also show a warning in that case.

## Undoing a change
Every save is a commit in the GitHub repository ("Website edit: … (name)"). An admin can undo one on github.com:
open the commit → **⋯** → **Revert** (or ask a developer), which publishes the previous version.

## For developers
- Content lives in `content/` (YAML). Page templates are in `src/`. Editor forms are defined in `.pages.yml`, which the
  editor at `/admin` reads (Pages CMS can still read it too).
- `npm install` then `npm start` for a local preview at http://localhost:8080; `npm run build` writes `_site/`.
- The deploy workflow builds `_site/` and uploads only that folder (see `DEPLOY.md`).
- Editor API (all POSTs to `/wp-admin/admin-ajax.php`, signed-in users with the `zakaliya_edit_site` capability, nonce-checked):
  `zakaliya_session`, `zakaliya_load`, `zakaliya_upload`, `zakaliya_save`. Saves may only touch `content/site.yml`,
  `content/verses.yml`, existing `content/pages/*.yml`, `content/projects/*.yml` and new photos in `assets/uploads/`.
