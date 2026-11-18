# Editing the website

Editors sign in at **https://zakaliyasbm-mn.com/admin** with an **email and password** that the admin creates for them.
Every save goes to GitHub, which rebuilds the site, uploads it to GoDaddy and clears GoDaddy's cache automatically
(about 2 minutes; the editor shows "Live on the website" when it's done). Every change is kept in the history and can be undone.

How it fits together:
- **Sign-in and accounts:** Supabase (free plan), email + password.
- **Who may edit:** only emails listed in the `website_editors` table in Supabase. Anyone else who manages to sign in is refused.
- **The editor:** `assets/admin/editor.js` (the page at /admin). Its forms are built from `.pages.yml`.
- **Saving:** database functions in the same Supabase project (`supabase/editor-setup.sql`) check the person is on the list
  and commit the changed files to GitHub with an access key kept in Supabase **Vault** (encrypted).
- **Public settings:** `editor-config.json` holds the Supabase project address and its *publishable* key (both are meant to be public).
  Never put the secret / service_role key there.

WordPress is not used by the editor.

## One-time setup (admin, about 10 minutes)

### 1. Create the Supabase project
Already done: `https://cdmdzfyzbokvqjmfkdin.supabase.co` (its address and publishable key are in `editor-config.json`).
For a new project: https://supabase.com → **New project**, Free plan, then put its Project URL and publishable key
(**Project Settings → API Keys**) into `editor-config.json`.

### 2. Sign-in settings
1. **Authentication → Sign In / Providers**: make sure **Email** is enabled. Turning **off** "Allow new users to sign up" is
   recommended (strangers then can't even create an account; they could never edit anyway, because only listed emails can).
2. **Authentication → URL Configuration**: **Site URL** `https://zakaliyasbm-mn.com/admin`, and add the same address under
   **Redirect URLs** (password-reset emails send people back to the editor).

### 3. Create the GitHub access key
1. On github.com (signed in as the repository owner): profile picture → **Settings** → **Developer settings** → **Personal access tokens** → **Fine-grained tokens** → **Generate new token**.
2. **Name:** `Zakaliya website editor`. **Expiration:** 1 year (put a reminder in your calendar to renew it).
3. **Repository access:** **Only select repositories** → `zakaliya`.
4. **Permissions** → **Repository permissions** → **Contents: Read and write**. Leave everything else as it is.
5. **Generate token** and copy it (it starts with `github_pat_`). Don't paste it anywhere else: not in chat, email or a file.

### 4. Put the key in Supabase Vault
Easiest: **Integrations → Vault → Add new secret** (or **Project Settings → Vault**). **Name:** `github_token`, **Secret:** the key → Save.
(Or in the SQL Editor: `select vault.create_secret('github_pat_...', 'github_token');` then delete that query from the editor's history.)
To renew it later, edit the `github_token` secret and paste the new key.

### 5. Run the setup script
**SQL Editor → New query** → paste the whole of `supabase/editor-setup.sql`
(on github.com open that file → **Raw** → select all → copy) → **Run**. It should end with "Success".
It's safe to run again after an update; it keeps the list of editors.

### 6. Add yourself as the first editor (next section).

## Give someone access
Two things: a sign-in account, and their email on the list of editors.

1. **Account:** **Authentication → Users → Add user → Create new user** → their email and a strong password,
   tick **Auto Confirm User** → **Create user**.
2. **On the list:** **SQL Editor** → run (with their email and the name to show in the history):
   `insert into public.website_editors (email, name) values (lower('grace@example.com'), 'Grace');`
3. Send them the email address and password privately (in person, by phone or SMS; not in a public group).

To remove someone: `delete from public.website_editors where email = lower('grace@example.com');` (they can't save from that
moment), and delete their account under **Authentication → Users** (**⋯** → **Delete user**).
To see the list: `select * from public.website_editors;`
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
- Editor API: `POST <Supabase URL>/rest/v1/rpc/editor_load | editor_upload | editor_save` with the signed-in user's token
  (functions in `supabase/editor-setup.sql`). Saves may only touch `content/site.yml`, `content/verses.yml`, existing
  `content/pages/*.yml`, `content/projects/*.yml` and new photos in `assets/uploads/`.
