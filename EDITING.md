# Editing the website

Editors sign in at **https://zakaliyasbm-mn.com/admin** (it opens the Pages CMS editor).
Every save goes to GitHub, which rebuilds the site and uploads it to GoDaddy automatically
(about 2 minutes). Every change is kept in the history and can be undone.

## One-time setup (admin, with the GitHub account that owns the repository)
1. Go to https://app.pagescms.org and click **Sign in with GitHub**.
2. When asked, **install the Pages CMS GitHub app** and give it access to **only** the `zakaliya` repository.
3. Open the `zakaliya` repository in Pages CMS. You should see: Pages, Projects, Verse of the day, Website settings.

## Invite an editor (no GitHub account needed)
1. In Pages CMS, open the `zakaliya` repository → **Settings → Collaborators**.
2. Enter the person's email address and invite them.
3. They go to https://zakaliyasbm-mn.com/admin → **Sign in** → **Continue with email**, using that same address.

Remove someone the same way. Editors can change content and photos only; they can't change the editor setup
or invite others (only GitHub users with access to the repository can).

## What editors can change
| In the editor | What it controls |
|---|---|
| **Pages → Home page, About us, Projects page, Donate page, Contact page, Thank-you page, Page-not-found page** | Every heading, paragraph, button label and photo on those pages, plus the Google title and description |
| **Projects** | Each project: completed/ongoing, order, photos, home-page card, Projects-page text, its own page (facts, progress updates with dates and photos, gallery). **Add new** creates a new project with its own page. |
| **Verse of the day** | The list of verses (one is shown each day) |
| **Website settings** | Ministry name, logo, menu labels, footer, email, phone, address, Facebook and YouTube links |
| **Donate page → Stripe donation links** | The Stripe Payment Links behind each amount (only `https://buy.stripe.com/` links are accepted) |

The page layout and design are fixed in the code, so an edit can't break the design.

## Tips for editors
- **Photos:** upload JPG photos up to about 1–2 MB (phone photos are often 4–8 MB; most phones can share a smaller size). Always fill in **Describe the photo**.
- **Bold text:** in text boxes with a toolbar, select words and click **B**.
- **New progress update:** open the project → **Progress updates** → add one and drag it to the top.
- If a change doesn't appear after 5 minutes, flush GoDaddy's cache (Managed WordPress → Settings → Tools → Flush Cache).

## For developers
- Content lives in `content/` (YAML). Page templates are in `src/`. Editor forms are defined in `.pages.yml`.
- `npm install` then `npm start` for a local preview at http://localhost:8080; `npm run build` writes `_site/`.
- The deploy workflow builds `_site/` and uploads only that folder (see `DEPLOY.md`).
