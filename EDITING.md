# Editing the website

Editors sign in at **https://zakaliyasbm-mn.com/admin** with an **email and password** that the admin creates for them.
Every save goes to GitHub, which rebuilds the site, uploads it to GoDaddy and clears GoDaddy's cache automatically
(about 2 minutes; the editor shows "Live on the website" when it's done). Every change is kept in the history and can be undone.

How it fits together:
- **Sign-in and accounts:** Supabase (free plan). Public sign-up is switched off: only people the admin adds can sign in.
- **The editor:** `assets/admin/editor.js` (the page at /admin). Its forms are built from `.pages.yml`.
- **Saving:** the Supabase Edge Function `editor` (`supabase/functions/editor/index.ts`) checks the sign-in and commits the
  changed files to GitHub with an access key that only Supabase knows.
- **Public settings:** `editor-config.json` holds the Supabase project address and its *publishable* key (both are meant to be public).
  Never put the secret / service_role key there.

WordPress is not used by the editor.

## One-time setup (admin, about 15 minutes)

### 1. Create the Supabase project
1. Go to https://supabase.com → **Start your project** → sign up (signing in with GitHub is easiest).
2. **New project**: name `zakaliya-editor`, choose a strong database password (save it in your password manager; the editor
   doesn't need it), pick the region closest to the editors, **Free** plan → **Create new project**.

### 2. Lock down sign-in
1. **Authentication → Sign In / Providers**: make sure **Email** is enabled, and turn **off** "Allow new users to sign up". Save.
   The editor checks this: while sign-up is on, it refuses to save anything ("The editor is locked..."), because every
   Supabase account can edit the website.
2. **Authentication → URL Configuration**:
   - **Site URL:** `https://zakaliyasbm-mn.com/admin`
   - **Redirect URLs:** add `https://zakaliyasbm-mn.com/admin`
   (Password-reset emails send people back to the editor.)

### 3. Create the GitHub access key
1. On github.com (signed in as the repository owner): profile picture → **Settings** → **Developer settings** → **Personal access tokens** → **Fine-grained tokens** → **Generate new token**.
2. **Name:** `Zakaliya website editor`. **Expiration:** 1 year (put a reminder in your calendar to renew it).
3. **Repository access:** **Only select repositories** → `zakaliya`.
4. **Permissions** → **Repository permissions** → **Contents: Read and write**. Leave everything else as it is.
5. **Generate token** and copy it (it starts with `github_pat_`). Don't paste it anywhere else: not in chat, email or a file.

### 4. Add the saving function
1. Supabase → **Edge Functions → Secrets** → add a secret named `GITHUB_TOKEN` with the key from step 3 → **Save**.
2. **Edge Functions → Deploy a new function → Via Editor**. Name it exactly `editor`.
3. Replace the sample code with the whole of `supabase/functions/editor/index.ts`
   (on github.com open that file → **Raw** → select all → copy) → **Deploy function**.
4. Open the `editor` function → **Details / Settings** → turn **off** "Enforce JWT verification" (also called "Verify JWT")
   → **Save**. The function checks the sign-in itself; this setting would otherwise block the browser.

### 5. Connect the website
**Project Settings → API Keys** (or the **Connect** button): copy the **Project URL** (`https://xxxx.supabase.co`) and the
**publishable** key (`sb_publishable_...`, or the older "anon public" key). Put them in `editor-config.json` (or send them to
your developer). Both are public. **Never** share the *secret* / *service_role* key.

To renew the GitHub key later: create a new one (step 3) and replace the `GITHUB_TOKEN` secret (step 4.1).

## Give someone access
1. Supabase → **Authentication → Users → Add user → Create new user**.
2. Enter their **email** and a strong **password**, tick **Auto Confirm User** → **Create user**.
3. Send them the email address and password privately (in person, by phone or SMS; not in a public group).
4. Optional, to show their name in the editor and in the history (instead of "Editor 1a2b3c"):
   **SQL Editor** → run (with their email):
   `update auth.users set raw_user_meta_data = raw_user_meta_data || '{"name":"Grace"}' where email = 'grace@example.com';`

To remove someone: **Users** → the **⋯** menu on their row → **Delete user** (they're signed out within the hour and can't save
from that moment). To reset a password: **⋯** → **Send password recovery**, or delete and add them again.
Editors can change their own password in the editor (round initials button → **Change my password**) and can use
**Forgot your password?** on the sign-in page.

Good to know:
- Supabase limits wrong-password attempts automatically.
- Password-reset emails come from Supabase's built-in email service, which sends only a few emails per hour. That's fine for a few editors.
- **Free projects pause after about a week with no activity.** If the editor says it can't reach the sign-in service, open the
  Supabase dashboard and click **Restore project** (takes a minute or two). Content and accounts are kept.

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
- If you're signed out while editing, the editor asks you to sign in again and keeps your unsaved changes.
- If a change doesn't appear after 5 minutes, refresh the page (Ctrl + F5). If it still doesn't, flush GoDaddy's cache by hand (Managed WordPress → Settings → Tools → Flush Cache); the GitHub run will also show a warning in that case.

## Undoing a change
Every save is a commit in the GitHub repository ("Website edit: … (name)"). An admin can undo one on github.com:
open the commit → **⋯** → **Revert** (or ask a developer), which publishes the previous version.

## For developers
- Content lives in `content/` (YAML). Page templates are in `src/`. Editor forms are defined in `.pages.yml`, which the
  editor at `/admin` reads (Pages CMS can still read it too).
- `npm install` then `npm start` for a local preview at http://localhost:8080; `npm run build` writes `_site/`.
- The deploy workflow builds `_site/` and uploads only that folder (see `DEPLOY.md`).
- Editor API: POST to `<Supabase URL>/functions/v1/editor` with the signed-in user's token; actions `load`, `upload`, `save`.
  Saves may only touch `content/site.yml`, `content/verses.yml`, existing `content/pages/*.yml`, `content/projects/*.yml`
  and new photos in `assets/uploads/`. Calls are only accepted from https://zakaliyasbm-mn.com (and localhost for testing).
