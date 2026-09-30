# RB Poker Coach

A free web app for learning No-Limit Texas Hold'em. You play against friendly bots, and a coach
explains every decision in plain words. Play money only: nothing to buy, nothing to win.

- No sign-up and no account: open the app, tap **Play**, and a hand is dealt.
- Works offline after the first visit, and installs to a phone's home screen.
- Private: no analytics, no cookies, no requests to other websites. Your stats stay on your device.

The app is still being built. The plan is [docs/PLAN.md](docs/PLAN.md) (the single source of
truth) and the progress is in [docs/EXECUTION.md](docs/EXECUTION.md).

## What you need

- **Node.js 24** (the exact major version is in `.nvmrc`). npm 11 comes with it.
- **Docker** (optional): only to check the production image on your computer.

Install the dependencies once, in the repository folder:

```sh
npm ci
```

## Run it on your computer

There are three ways. The first gives the fastest feedback; the last is closest to production.

| Command | What runs | Open | Use it for |
|---|---|---|---|
| `npm run dev`, and `npm run dev:server` in a second terminal | Vite dev server (reloads on every save) and the Nest server in watch mode | http://localhost:5173 | Writing code |
| `npm run build && npm start` | The production build, served by the Nest server | http://localhost:3000 | The "local deploy" that ends every stage; the E2E tests use it |
| `npm run docker:up` | The same Docker image that Coolify runs | http://localhost:3000 | Checking the image before a Coolify deploy |

Good to know:

- Dev mode has no service worker (no offline mode) and no security headers. Check offline mode
  and headers with `npm start` or Docker.
- `npm run docker:up` runs `docker compose up --build`. In a second terminal, `docker compose ps`
  must show the container as `healthy` (within about 30 seconds). Stop it with Ctrl+C, then
  `docker compose down`.
- Port 3000 is busy? `PORT=3100 npm start` uses port 3100 instead.

## Checks

Run these before you push. CI runs them too.

| Command | What it checks |
|---|---|
| `npm run typecheck` | TypeScript in both apps |
| `npm run lint` | ESLint, including the module boundary rules and the `Math.random` ban |
| `npm run format:check` | Prettier formatting (`npm run format` fixes it) |
| `npm test` | Unit, component and server tests |
| `npm run test:slow` | The long tests (CI runs them once a week) |
| `npm run e2e` | Playwright in Chromium and WebKit at six screen sizes, against the E2E build (`npm run build:e2e`: the production build plus the test hooks `?seed=` and `window.__pc`). It builds first when that build is missing, is a production build, or is older than the code. Before the first run: `npx playwright install chromium webkit` |
| `npm run size` | Bundle sizes against the budget (after `npm run build`) |
| `npm run gen:check` | The generated preflop tables in `src/data/generated/`: checksums, and 20 cells sampled again (a few seconds). `npm run gen` rebuilds them (about 3 minutes on 8 cores); never edit those files by hand |
| `npm run check:html -w @rb/web` | The built `index.html` has no inline script and carries the CSP (after `npm run build`) |

## Test on your phone

Your phone can open the game from your computer over Wi-Fi:

1. Connect the phone and the computer to the **same Wi-Fi** (a guest network often blocks this).
2. On the computer, run `npm run build && npm start`.
3. Find the computer's address on the network. On a Mac: `ipconfig getifaddr en0`, or System
   Settings → Wi-Fi → Details. It looks like `192.168.1.20`.
4. On the phone, open `http://192.168.1.20:3000` (with your address).
5. If the Mac asks whether `node` may accept incoming connections, click **Allow**.

For dev mode, run `npm run dev` instead and open port `5173`. Vite prints the address to use on
the line that starts with `Network:`.

What you can test this way:

- **Works:** the game, the layout, touch, speed.
- **Does not work:** offline mode, installing to the home screen, and the shuffle check.
  Browsers allow these only on an `https://` address or on `localhost`, and
  `http://192.168.x.x` is neither. The app notices this and leaves them out; it does not break.
- To test install and offline mode on the phone, use the Coolify `https://` address (next section).
- Optional, before Coolify exists: `cloudflared tunnel --url http://localhost:3000` (install it
  with `brew install cloudflared`, no account needed) gives a temporary `https://….trycloudflare.com`
  address for a quick look. It changes on every run, so it is never used to accept a stage.

## Deploy on Coolify (checklist for the owner)

Only you can do steps 1 to 4, and only once. After that, every push to `main` deploys by itself.

1. **Source.** In Coolify, click **+ New** and pick this Git repository (`romanbitca/rb-pocker`).
   Use the GitHub App: it turns **Auto Deploy** on, so every push to `main` deploys.
2. **Build.** Build Pack: **Dockerfile**. Base Directory: `/`. Dockerfile Location:
   `/Dockerfile`. Ports Exposes: `3000`.
3. **Domain.** Configuration → General → Domains: type the full address with `https://`, for
   example `https://poker.example.com`. At your DNS provider, add an **A record** for that name
   that points to the Coolify server's IP address. Ports 80 and 443 must be open on the server.
   The proxy (Traefik, the default) then gets a free Let's Encrypt certificate by itself. Turn
   **Force HTTPS** on (check it: its default is not confirmed).
4. **Environment.** Add one variable: `NODE_ENV` = `production` (runtime). Nothing else; the app
   has no secrets. Leave **Include Source Commit in Build** off, so the build cache keeps working.
   The app still reports the commit: it reads `SOURCE_COMMIT`, which Coolify sets when it runs
   the container.
5. **Health check.** Nothing to set. Coolify uses the health check inside the `Dockerfile`
   (`/api/health`), not the one in the dashboard (that one would need `curl`, which the image
   does not have). On each deploy, Coolify waits until the new container is healthy before it
   removes the old one.
6. **Keep these off:** basic auth, sticky sessions (they set a cookie), and proxy access logs.
   They would add a login, a cookie or a log of visitors. Gzip compression may stay on.
7. **After each deploy,** run this on your computer (after `npm ci`):

   ```sh
   node scripts/check-deploy.mjs https://poker.example.com
   ```

   It checks the security headers, the cache rules, that no response sets a cookie, and that
   `/api/health` answers with the commit that is running (it should be the latest commit on
   `main`). If it says the commit is `dev`, Coolify did not pass `SOURCE_COMMIT`: tell the
   developer. Then open the address on your phone, install it (Add to Home Screen), and try it
   in airplane mode.
8. **Optional:** in GitHub → Settings → Secrets and variables → Actions → **Variables**, add
   `DEPLOY_URL` = your address. The weekly CI job then runs the same check.

## Where things are

- `apps/web`: the game (React, Vite, installable offline app). Builds to `apps/web/dist`.
- `apps/server`: the small NestJS server that serves the game and `/api/health`.
- `scripts/`: `build-if-needed.mjs` (used by `npm run e2e`) and `check-deploy.mjs` (after a deploy).
- `docs/PLAN.md`: what to build and why. `docs/EXECUTION.md`: what is done.
- Third-party licences: [THIRD_PARTY_LICENSES.md](THIRD_PARTY_LICENSES.md).
