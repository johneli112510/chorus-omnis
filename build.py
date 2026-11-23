"""Generates the HTML shells in public/. Run: python3 build.py (optional; the generated files are committed)."""
NAV=[("index.html","Home"),("about.html","About"),("news.html","News"),("concerts.html","Concerts"),("gallery.html","Gallery"),("recordings.html","Recordings"),("contact.html","Contact")]
ABOUT_SUB=[("about.html","The Choir"),("organization.html","Organization"),("vmo.html","Vision, Mission and Objectives")]
PAGES=[("index.html","home","Home"),("about.html","about","The Choir"),("organization.html","organization","Organization"),
("vmo.html","vmo","Vision, Mission and Objectives"),("news.html","news","News"),("post.html","post","News"),("concerts.html","concerts","Concerts"),("gallery.html","gallery","Gallery"),
("recordings.html","recordings","Recordings"),("contact.html","contact","Contact")]

def shell(fname,key,title):
    nav=""
    for f,l in NAV:
        if f=="about.html":
            sub="".join(f'<a href="{sf}">{sl}</a>' for sf,sl in ABOUT_SUB)
            cur=' aria-current="page"' if fname in [s[0] for s in ABOUT_SUB] else ''
            nav+=f'<li class="has-sub"><a href="about.html"{cur}>About</a><div class="sub">{sub}</div></li>'
        else:
            cur=' aria-current="page"' if (f==fname or (fname=='post.html' and f=='news.html')) else ''
            nav+=f'<li><a href="{f}"{cur}>{l}</a></li>'
    ld=('\n<script type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":"Organization","name":"Chorus Omnis","url":"https://chorus-omnis.com/","logo":"https://chorus-omnis.com/assets/logo.png"},{"@type":"WebSite","name":"Chorus Omnis","url":"https://chorus-omnis.com/"}]}</script>' if key=="home" else '')
    full="Chorus Omnis" if key=="home" else f"{title} | Chorus Omnis"
    og='<!--META-->' if key=="post" else f'<meta property="og:title" content="{full}"><meta property="og:image" content="/assets/logo.png"><meta property="og:type" content="website">'
    return f'''<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>{full}</title>
<meta name="description" content="Chorus Omnis, a choir singing together for everyone.">
{og}
<link rel="icon" href="/favicon.ico" sizes="any">
<link rel="icon" type="image/png" sizes="48x48" href="/assets/favicon-48.png">
<link rel="icon" type="image/png" sizes="96x96" href="/assets/favicon-96.png">
<link rel="apple-touch-icon" href="/assets/apple-touch-icon.png">{ld}
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,400;0,9..144,600;1,9..144,400&family=Figtree:wght@400;500;600&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/assets/style.css">
</head><body>
<header class="top"><a class="brand" href="/index.html"><img src="/assets/logo-transparent.png" alt="Chorus Omnis"></a>
<button class="menu-btn" aria-expanded="false" aria-controls="nav">Menu</button>
<nav id="nav"><ul>{nav}</ul></nav></header>
<main id="root" data-page="{key}"><noscript><p class="wrap">Please enable JavaScript to view this page.</p></noscript></main>
<footer><div class="ribbon" aria-hidden="true"></div><div class="foot"><a href="/index.html"><img class="foot-logo" src="/assets/logo-transparent.png" alt="Chorus Omnis"></a><div class="social" id="social"></div><p>Chorus Omnis &copy; 2026</p></div></footer>
<script src="/assets/site.js"></script></body></html>'''
for f,k,t in PAGES: open(f"public/{f}","w").write(shell(f,k,t))
