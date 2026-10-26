# Deploying from the browser — no terminal

About five minutes of clicking at dash.cloudflare.com. A free account is fine.
You need one file: `mortgage-review-worker.js`.

## 1. Make the database

Left sidebar: **Storage & Databases** -> **D1 SQL Database** -> **Create**.
Name it `mortgage-reviews`. Create.

That's it — the app builds its own table the first time you use it.

## 2. Make the Worker

Left sidebar: **Compute** -> **Workers & Pages** -> **Create** ->
**Start with Hello World!** -> **Get started**.

Name it something you don't mind seeing in the URL. `reviews` is good.
Click **Deploy**, then **Edit code**.

## 3. Paste the app

In the editor, select everything that's there and delete it.
Open `mortgage-review-worker.js`, select all, copy, paste it in.

Near the top you'll see:

    const SIGN_IN_PASSWORD = "change-me-before-you-deploy";

Change that to the password you want to sign in with. Keep the quotes.

Click **Deploy**.

## 4. Connect the database

Still in the Worker: **Settings** -> **Bindings** -> **Add** -> **D1 database**.

- Variable name: `DB`  (exactly that, capital D capital B)
- D1 database: `mortgage-reviews`

**Deploy** again so the binding takes effect.

## Done

Your URL is on the Worker's overview page, something like
`https://reviews.yourname.workers.dev`. Open it, sign in with the password from
step 3, and build a review.

**Generate Review** -> **Create client link** -> copy and send. Default expiry is
3 days; 7, 14 and 30 are in the dropdown. **Your client links** below the strip
lists everything you've issued and revokes any of it, any time, from any device
you're signed in on.

## Printing

Both the builder and the client's page have a **Print or save PDF** button. It
produces a single Letter page with every figure on it: liabilities down the left,
the comparison and loan details on the right, your licensing and the disclosure
along the bottom. The scrolling version you see on screen is for reading; the
one-page version is what prints.

## If something looks wrong

**"No database is connected yet"** when you create a link — step 4 didn't take.
Check the variable name is exactly `DB` and that you deployed after adding it.

**Can't sign in** — the password is whatever you typed in step 3. If you're not
sure, open **Edit code** and look at that line.

**Want a nicer address** — Worker -> **Settings** -> **Domains & Routes** ->
**Add** -> **Custom domain**, e.g. `reviews.yourdomain.com`. Links already sent
keep working.

## Changing the password later

**Edit code**, change the line, **Deploy**. Anyone already signed in stays signed
in; it only affects new sign-ins.
