# Running it on your machine

You do **not** need a Cloudflare account to run this locally. Local mode uses a
SQLite file on your laptop and ignores the placeholder `database_id` in
`wrangler.jsonc`. Everything works: sign-in, review building, client links,
share pages, revoke.

## Start it

Requires Node 18+ (`node -v` to check).

```
./start-local.sh
```

First run installs dependencies, writes `.dev.vars`, and creates the local
database. Every run after that just starts the server. Then open
**http://127.0.0.1:8787** and sign in with the password printed in the terminal
(default `devpass` — change it in `.dev.vars`).

To use a different port: `PORT=3000 ./start-local.sh`

Windows: run `bash start-local.sh` from Git Bash or WSL, or use the manual steps
in `README.md`.

## What "local" means for each feature

| Feature | Local behavior |
|---|---|
| Sign-in | Password from `.dev.vars`, 30-day cookie. Works on localhost even though the cookie is marked `Secure`. |
| Drafts | Browser localStorage, same as always. |
| Client links | Saved to a local SQLite file under `.wrangler/state/`. |
| Share pages `/r/<token>` | Work — but the URL is `127.0.0.1`, so **only you can open them.** Nothing you generate locally can be sent to a client. |
| Print / save PDF | Works fully. |

That last row is the one real limit. Local is for building, testing, and
practicing the conversation. The moment you want to text a link to a client, you
need the deploy in `README.md`.

## Reset the local database

```
rm -rf .wrangler/state
npx wrangler d1 execute mortgage-reviews --local --file=schema.sql
```

## Verify it's healthy

```
curl http://127.0.0.1:8787/health     # {"ok":true}
npm test                              # 62 passing (20 calc + 35 import + 7 worker)
```

## Two things to fix before a real client sees this

1. **The compliance footer is empty.** `worker/app.html`, line ~423:
   `disclosure: ""`. Paste your broker/state disclosure language in. This is the
   one item on your roadmap that's a compliance exposure, not a nice-to-have —
   an NMLS number without required disclosure language is the kind of thing a
   state examiner flags.
2. **Confirm the advisor block is current.** Same line: name, NMLS 2726985,
   company "eMortgage Funding", phone 313-373-8355. The call-bar name/number on
   share pages is set separately in `worker/index.js`.

## Harmless error you'll ignore

`Unable to fetch the Request.cf object` on startup means wrangler couldn't reach
Cloudflare for geo metadata. The app doesn't use it. If you're online you won't
see it at all.
