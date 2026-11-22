# Chorus Omnis website

Public site plus an admin page (`/admin.html`) for editing text, photos and videos.
Runs as one Cloudflare Worker with static files (`public/`) and a small API (`worker.js`).

## How it works
- Page content is saved as a JSON file in a Cloudflare **R2** bucket (binding `MEDIA`).
- Uploaded photos and videos are stored in the same bucket.
- The admin signs in with one password (the `ADMIN_PASSWORD` secret).
- Until the first save, the site shows the starter text in `public/assets/default-content.json`.

## Deploy (Cloudflare Workers Builds from GitHub)
1. Push this folder to your GitHub repo (replace the old files). The repo root must contain `wrangler.jsonc`, `worker.js` and the `public` folder.
2. In Cloudflare: R2 Object Storage -> Create bucket named `chorus-omnis-media`.
   (If you use another name, change `bucket_name` in `wrangler.jsonc`.)
3. Your Worker project must be named `chorus-omnis` (same as `name` in `wrangler.jsonc`).
   Build settings: build command empty, deploy command `npx wrangler deploy`, root directory `/`.
4. Project -> Settings -> Variables and Secrets -> Add, type **Secret**: `ADMIN_PASSWORD` = a long password.
5. Push again or press Retry deployment.

## Use
Open `https://YOUR-SITE/admin.html`, sign in, edit, press **Save changes**.
Photos and videos: **Photos and Videos** tab. Tick **In gallery** to show a file on the Gallery page.
Photo fields (hero, people, concerts, covers) have a **Choose photo** button.

## Home page slideshow
Admin -> **Home** -> Slideshow photos -> **+ Add photos** (pick several at once or upload new ones).
Photos change every 10 seconds by default (set the seconds and Slide or Fade in the same tab). Visitors can swipe on phones or use the dots and arrows.

## News stories
Admin -> **News stories** -> Add story. Each story gets its own page at `/news/<id>`.
Build it from paragraphs, headings and photos with captions; photos added one after another show side by side.
In text, `*italic*` and `**bold**` work. Shared links (WhatsApp, Facebook) show the cover photo, title and summary.

## Contact form and Messages
Visitors send messages straight from the Contact page (no mail app opens). Messages are stored in the R2 bucket and show in
Admin -> **Messages** (unread count on the tab, Reply by email, Mark read, Delete). Spam is limited with a hidden trap field,
a minimum fill-in time and one message per visitor every 30 seconds.

Optional email alert when a message arrives (needs Cloudflare Email Routing on your domain with your inbox verified):
1. Add to `wrangler.jsonc`: `"send_email": [{ "name": "MAIL", "destination_address": "you@example.com" }]`
2. Add a plain-text variable `NOTIFY_EMAIL` = `you@example.com` (Settings -> Variables and Secrets).
3. Optional variable `MAIL_FROM` = an address on your domain, for example `website@chorus-omnis.com`.
The inbox works without this; the email alert is a bonus.

## Limits
- Uploads up to 95 MB each (Cloudflare request limit is 100 MB on Free and Pro). For long videos, upload to YouTube and add the link under Social.
- One shared admin password. Use a long one and keep it private.

## Files
- `wrangler.jsonc` Worker config (static assets folder and R2 binding)
- `worker.js` the API: login, content, media upload, media serving
- `build.py` regenerates the page shells in `public/` (optional)
