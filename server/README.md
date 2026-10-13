# Boardgames Hub server (Cloudflare Worker)

This Worker is the online referee: accounts, friends, rooms, and live games.

The website on GitHub Pages talks to it over HTTPS and WebSockets.

`wrangler.toml` lives at the **repo root** so the Worker can import game rules from `src/games/`.

Accounts, friends, and win/loss live in the D1 database. Deploying a new site or Worker version does **not** wipe that data (`schema.sql` is additive only).

## First-time setup

1. Create a free Cloudflare account. SQLite Durable Objects and D1 work on the Workers Free plan (paid is only needed for higher limits).
2. From the project root: `npx wrangler login` (authorize in the browser).
3. `npx wrangler d1 create boardgames` and paste the printed `database_id` into `wrangler.toml`.
4. `npm run db:apply` (remote schema) and `npm run db:apply:local` (for `wrangler dev`).
5. `npm run deploy:server`. Live URL: `https://boardgames-hub.masonchern.workers.dev`.
6. Put that URL in the GitHub repo variable `VITE_API_URL` (so Pages builds know where to connect).
7. Create GitHub secrets `CLOUDFLARE_API_TOKEN` (Edit Cloudflare Workers) and `CLOUDFLARE_ACCOUNT_ID` (`60b59ff190db3f9e4fee0bd553ff1247`), then set repo variable `WORKER_READY=1` so CI deploys the Worker on every push to `main`.

Local play: `npm run dev:server` in one terminal and `npm run dev` in another. The Vite app calls `http://localhost:8787`.
