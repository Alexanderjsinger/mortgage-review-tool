# Running it yourself

One file, no accounts, no dependencies, nothing phoning home. Needs Node 22 or
newer (`node -v` to check; nodejs.org has the installer).

    node mortgage-review-server.js

Open http://localhost:8080 and sign in.

## Before you start

Open `mortgage-review-server.js` in any text editor. Near the top:

    const SIGN_IN_PASSWORD = process.env.ADVISOR_PASSWORD || "change-me-before-you-start";

Replace `change-me-before-you-start` with your password, keeping the quotes.
Save. The server warns you on startup if you forget.

## Your data

Everything lives in `reviews.db`, a single file next to the server. Back it up
by copying that file. Delete it and you start clean. Nothing is sent anywhere.

## Getting client links to actually reach clients

On your own machine the app works fully, but `localhost` links only open on that
machine. For a client to open one, the server has to be reachable from the
internet, which means three things:

1. **A machine that stays on.** Your laptop closing ends the session.
2. **An address.** A domain pointed at that machine.
3. **HTTPS.** The sign-in cookie is marked Secure, so over plain `http://` on
   anything other than localhost you will not stay signed in. This is deliberate
   — a session cookie for an app holding credit reports should not travel in the
   clear.

The usual shape is a small Linux server, a reverse proxy such as Caddy (which
gets certificates automatically), and this app running behind it. Then set:

    PUBLIC_URL=https://reviews.yourdomain.com

so the links it hands you are built with the right address rather than the
internal one.

## Settings

All optional, all overridable without editing the file:

| Variable | Default | What it does |
|---|---|---|
| `ADVISOR_PASSWORD` | the constant in the file | sign-in password |
| `PORT` | 8080 | port to listen on |
| `PUBLIC_URL` | blank | address used when building client links |
| `DB_FILE` | `reviews.db` beside the server | where data is kept |
| `SESSION_SECRET` | the constant in the file | signs the sign-in cookie |

Example:

    ADVISOR_PASSWORD=yourpassword PORT=9000 node mortgage-review-server.js

## What you are taking on

Self-hosting means the security of a machine holding clients' full credit
profiles is yours: operating system patches, certificate renewal, backups, and
making sure nothing else on that machine can read `reviews.db`. That is a real
obligation for client data, not a formality. Worth being deliberate about it
rather than leaving it running on a box you forget.
