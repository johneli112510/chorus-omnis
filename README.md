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

## Sending replies from the website
Admin -> Messages -> **Reply** opens a box under the message. **Send reply** emails the visitor from your site address
(for example `info@chorus-omnis.com`). Visitors who answer reach your choir inbox (Reply-To is the email set in Admin -> Contact).
Sent replies are saved under the message. This uses Cloudflare **Email Service**:
1. Cloudflare dashboard -> Compute & AI (or Email) -> **Email Service** -> onboard your domain `chorus-omnis.com`
   and add the DNS records it shows. Wait until the domain shows as active for sending.
2. The binding `EMAIL` is already in `wrangler.jsonc` (`"send_email": [{ "name": "EMAIL" }]`). Redeploy.
3. Optional variable `MAIL_FROM` = the address replies are sent from (must be on your onboarded domain).
   If you skip it, `info@<your domain>` is used.
4. Optional variable `NOTIFY_EMAIL` = your inbox. You then also get an email alert for each new message.
If sending is not set up yet, the Reply box shows the reason and an "Open in my mail app instead" link.
Email Service may need a paid Workers plan for sending to people who are not verified addresses; check your Cloudflare plan.

## Limits
- Uploads up to 95 MB each (Cloudflare request limit is 100 MB on Free and Pro). For long videos, upload to YouTube and add the link under Social.
- One shared admin password. Use a long one and keep it private.

## Files
- `wrangler.jsonc` Worker config (static assets folder and R2 binding)
- `worker.js` the API: login, content, media upload, media serving
- `build.py` regenerates the page shells in `public/` (optional)
