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

## Replying from the website
Admin -> Messages -> **Reply** opens a box under the message. **Send reply** emails the visitor from `info@<your domain>`
(change with the `REPLY_FROM` variable), saves your reply under the message, and sends a hidden copy (BCC) to the same choir inbox
that receives new-message alerts (by default `info@chorus-omnis.com`, which Email Routing forwards to Gmail). The visitor's answers go to the
Contact email set in the admin (or `info@<your domain>`). Needs the domain enabled in Cloudflare Email Service.
The reply box works like an email: **To**, optional **Cc**, **Subject**, **Message**, and **Attach files** (button or drag and drop;
up to 10 files, 17 MB in total, because Cloudflare limits a whole email to 25 MB). Common program files (.exe, .bat, .js ...) are blocked.
For bigger files, upload them in Photos and Videos, press **Copy link** and paste the link in the message.
Attachments are not stored on the website; the thread keeps only the file names.

## Email alerts for new messages
Every message sent through the Contact page is saved under Admin -> Messages and also emailed to your choir address.
It goes to the first of these that exists:
1. the `NOTIFY_EMAIL` variable (one or more addresses, separated by commas, up to 5),
2. the Contact email saved in Admin -> Contact and Social,
3. `info@<your domain>` (for example `info@chorus-omnis.com`).
With Cloudflare Email Routing, mail to `info@chorus-omnis.com` is forwarded to your Gmail. Press Reply in Gmail to answer the visitor
(the visitor's address is set as Reply-To). Emails come from `website@<your domain>` (change with the `MAIL_FROM` variable).

Sending from the website to an address on your own domain needs the domain enabled in Cloudflare **Email Service**
(Email Service -> onboard the domain -> add the DNS records it shows). Until then Cloudflare only delivers to verified
destination addresses; the quick fix is to set `NOTIFY_EMAIL` to your Gmail address.
**Checking it works:** Admin -> Messages shows an *Email settings* box (connection, recipients, last result with the exact error) and a **Send test email** button.

## Limits
- Uploads up to 95 MB each (Cloudflare request limit is 100 MB on Free and Pro). For long videos, upload to YouTube and add the link under Social.
- One shared admin password. Use a long one and keep it private.

## Files
- `wrangler.jsonc` Worker config (static assets folder and R2 binding)
- `worker.js` the API: login, content, media upload, media serving
- `build.py` regenerates the page shells in `public/` (optional)
