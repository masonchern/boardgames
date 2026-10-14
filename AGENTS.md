# AGENTS.md: Project handbook for AI assistants

Read this first. It assumes you have **zero prior context**. It covers what the project is, how it is built, how to run and deploy it, and how git is set up.

---

## 1. What this is

**Boardgames Hub**: a web platform for playing board games in the browser.

- **Live site:** https://masonchern.github.io/boardgames/
- **Repo:** https://github.com/masonchern/boardgames (public, owner `masonchern`, default branch `main`)
- **Original product spec:** `docs/platform-spec.txt` (written in Chinese). It is the source of truth for product intent.

### Goals (from the spec)
1. **Plug-and-play games.** Adding a game must not require changing platform code.
2. **Future online multiplayer through a server.** Phase 1 is local "pass-and-play" (one device, players take turns), but the architecture must not hard-code that. A WebSocket server must be addable later without rewriting games.
3. **High-quality modern UI.** Bright light theme (Mason asked for it: white page background, black text, boxes in light blue / light brown by function), card layout, smooth transitions. Colors are CSS variables at the top of `src/platform/styles/main.css` (`--blue-*` interface, `--brown-*` games and boards, `--green-*`/`--red-*` status). Keep text black or near-black.

### Current state
- Sidebar tabs: **Games** (lobby), **Account** (register / sign in / guest / friends), **Settings** (placeholder rows). Top bar switches the whole UI between English and Traditional Chinese.
- Lobby shows one game: **Close Circuit**, Mason's own invented game, fully playable in Normal and Advanced mode (see section 11). Pass-and-play on one device, or **Play online** (room code, shareable link, friend invite).
- Online referee is a Cloudflare Worker (`server/`): accounts in D1, one Durable Object per room, WebSockets. The site on GitHub Pages stays static. Win/loss lives in D1 and is not wiped when the site or Worker is updated. If an online opponent disconnects for 2 minutes, the remaining player can kick them and take the win.
- The platform still supports `status: 'wip'` / `'coming-soon'` manifests (greyed-out lobby cards) for future games.
- Deployed to GitHub Pages with auto-deploy on push to `main`. The Worker deploys from the same workflow when Cloudflare secrets are set.
- Unit tests for Close Circuit's rules (`npm test`), run in CI before every deploy.

### Not done yet (likely next work)
- Real settings (sound, music, theme).
- Password reset / email; ranked matchmaking; more than 2 players; chat.
- Tuning Close Circuit's advanced mode after Mason plays it (section 11), and more games.
- Tests beyond Close Circuit's rules (nothing covers the platform or the views).

---

## 2. User preferences and conventions

- The user is **Mason**. They prefer working directly in code (creating, debugging, iterating).
- They write to you in Chinese or English. **All code comments, docs and notes must be in English** (explicit request). The UI is English or Traditional Chinese (`src/core/i18n.js`); a language switch sits in the top bar.
- They are not a git or deployment expert. Prefer doing things for them. **Users of the product must be able to play by visiting a URL.** Never rely on `.bat` files or local servers for end users.
- Keep explanations short and actionable.

---

## 3. Tech stack

- **Vanilla JavaScript (ES modules)**, **no framework**, **no TypeScript**. Types are documented with JSDoc `@typedef` in `src/core/types.js`.
- **Vite 8** for dev server and build. The only dev dependency is `vite`.
- **Hash routing** (`#/games/close-circuit`), so it works on any static host, including GitHub Pages sub-paths.
- Plain CSS with custom properties. Platform styles live in `src/platform/styles/main.css`; each game has its own `styles.css` imported by its `view.js`.
- Node.js 24 LTS, npm 11.

---

## 4. Project structure

```
index.html                  Vite entry (loads src/main.js)
package.json                Scripts: dev, build, preview, test
vite.config.js              base './' (relative paths, works under /boardgames/)
AGENTS.md                   This file
.github/workflows/deploy.yml   CI: test + build + deploy Pages (and the Worker when secrets exist)
wrangler.toml               Cloudflare Worker config (at repo root so it can import src/games/)
server/                     Worker source, D1 schema, setup notes (server/README.md)
docs/
  platform-spec.txt         Original product spec (Chinese)
scripts/
  dev.bat                   Optional Windows shortcut for `npm run dev` (not for end users)
src/
  main.js                   Boots the app (imports platform CSS)
  core/                     Platform-agnostic engine pieces
    types.js                The plugin CONTRACT (JSDoc typedefs). Read this to add a game.
                            (includes pre-game `options` and the `meta.now` time stamp)
    session.js              GameSession: client-side match, one-way data flow
    transport.js            LocalTransport (pass-and-play) and WebSocketTransport (online)
    auth.js / api.js / hub.js  Client session, HTTP API, presence socket
    gameLoader.js           mountGame(): resolves id -> loads module -> builds session -> mounts view
    i18n.js                 English / Traditional Chinese UI strings (top-bar language switch)
    registry.js             Auto-discovers games in src/games/ via import.meta.glob
    router.js               Hash router (#/games, #/join/CODE, #/room/CODE, #/account)
    dom.js                  el() hyperscript helper
  platform/
    app.js                  Shell: sidebar tabs, route -> page rendering, page teardown
    pages/                  lobby.js, gamePage.js, gameSetup.js, room.js, join.js, account.js, settings.js
    styles/main.css         Platform shell styles
  games/                    One self-contained folder per game (nothing else lives here)
    close-circuit/          Mason's game: SPEC.txt, manifest.js, circuit.js, rules.js, rules.test.js, view.js, styles.css, index.js
```

---

## 5. Architecture (the important part)

### Data flow (designed so online play is a transport swap)
```
View --dispatch(action)--> GameSession --> Transport.send({playerId, action})
   authority validates (rules.validate) and applies (rules.reduce)
   --> Transport onState(newState, seq) --> GameSession --> View.update(state)
```
- Today the `LocalTransport` plays the "server" in memory. It deliberately answers **asynchronously** (`queueMicrotask`) to mimic network latency, so game code never depends on synchronous updates. Do not "optimize" this away.
- For online play, write a `WebSocketTransport` with the same interface (`connect(handlers)`, `send(msg)`, `close()`), pass it to `GameSession` with `mode: 'online'` and a `localPlayerId`. Games and platform code stay unchanged. A sketch is in the comment at the bottom of `transport.js`.
- `rules.js` files are **pure functions with no DOM access**, so they can later run on a Node server as the authoritative rules.

### Game plugin contract (see `src/core/types.js`)
Each game is a folder in `src/games/<id>/`:

| File | Loaded | Purpose |
|---|---|---|
| `manifest.js` | eagerly (lobby needs it) | Default-exports metadata: `id`, `title`, `subtitle`, `description`, `players {min,max}`, `status` (`playable` / `wip` / `coming-soon`), `icon`, `accent`, `order`, `tags`, optional `layout: 'wide'` (bigger stage) and optional `options` (see below). Keep it tiny. Never import game code here. |
| `index.js` | lazily (when played) | Default-exports `{ rules, mount }` |

`rules` = `{ setup({players, options, now}), validate(state, action, playerId, meta) -> {ok, error?}, reduce(state, action, playerId, meta) -> newState (never mutate), getStatus(state) -> {isOver, currentPlayerId, winnerId, message} }`

**Time and randomness:** rules must never call `Date.now()` or `Math.random()`. The authority (today `LocalTransport`, later the server) stamps every action with `meta.now` and `meta.seed` (random 32-bit int) and gives `setup` a `now` and a `seed`. Rules store deadlines in state and compare against `meta.now`; shuffles use a seeded RNG (`makeRandom(seed)` in Close Circuit's `rules.js`). This keeps rules deterministic and lets a server enforce time limits and own the shuffle.

**Hidden information:** the authoritative state contains everything (for example both hands). The view must only show what its player may see. In pass-and-play the Close Circuit view covers the hand at the start of each turn ("Pass the device..."). Online play: games export `redact(state, playerId)` (Close Circuit does); the Worker sends each client that subset.

**Pre-game options:** if a manifest declares `options: [{ id, label, description, type, default, ... }]`, the platform shows a generic setup screen (`platform/pages/gameSetup.js`) before the game starts and passes the chosen values to `rules.setup({ options })`. Games without `options` start immediately. Two types exist: `number` (`min`, `max`, `step`, `unit`; with `unlimited: true` it also gets a "No limit" checkbox, and ticking it passes `null`, so rules must treat `null` as "no limit"; a missing value still means "use the default") and `select` (`choices: [{ value, label, description }]`, passes the chosen `value`).

`mount(container, api)` returns `{ update(state), destroy() }`. `api` = `{ players, getState, dispatch(action, playerId?), mode, localPlayerId, exit }`. In pass-and-play, omitting `playerId` in `dispatch` acts as the current turn's player.

### How to add a new game
1. Create `src/games/<id>/manifest.js` and `src/games/<id>/index.js` (use `close-circuit` as the reference and `src/core/types.js` as the contract).
2. Set `status: 'playable'` in the manifest once it works. Use `order` to control lobby position (lower first; default 100).
3. Put the game's styles in `src/games/<id>/styles.css` and import it from the game's `view.js` (prefix class names with the game, e.g. `.cc__`). Put the game's spec or notes next to it in the same folder.
4. **No registry or platform edits needed.** `import.meta.glob` finds the folder automatically.
5. A non-playable placeholder (`status: 'wip'` or `'coming-soon'`) still needs an `index.js` that exports `null`. The loader globs it, but the platform never mounts non-playable games.

### Known design decisions and gotchas
- `gamePage.js` gives each game its own `game-root` div and removes the loading placeholder by reference. This avoids a race: the view mounts on the first state, which can arrive *before* the loader's `.then`. Do not replace this with `stage.replaceChildren()`.
- `LocalTransport` ignores messages after `close()`. Session `destroy()` unsubscribes everything. Keep teardown paths intact (the shell calls the page's `destroy` on every route change).
- Vite builds use `base: './'` (relative paths) so the site works both at a domain root and under `/boardgames/`.
---

## 6. Commands

Run from the project root (`c:\Users\mason\OneDrive\Desktop\Boardgames` on Mason's machine).

| Command | What it does |
|---|---|
| `npm install` | Install dependencies (first time only) |
| `npm run dev` | Vite dev server with live reload at http://localhost:5173 |
| `npm run build` | Production build to `dist/` (this is what CI deploys) |
| `npm test` | Run unit tests (Node's built-in runner, any `*.test.js`). Pure rules only, no DOM. CI runs this before deploying. |
| `npm run preview` | Serve the built `dist/` locally (default port 4173) |
| `npm run dev:server` | Cloudflare Worker locally at http://localhost:8787 (needs D1 schema applied with `npm run db:apply:local`) |
| `npm run deploy:server` | Deploy the Worker (`npx wrangler login` first) |

**Never tell end users to open `index.html` directly.** Source `index.html` uses ES modules, which browsers block on `file://`. Users play at the hosted URL; developers use `npm run dev`.

---

## 7. Deployment (GitHub Pages)

- Workflow: `.github/workflows/deploy.yml`. On every push to `main` it runs `npm ci`, `npm test`, `npm run build`, uploads `dist/`, and deploys with `actions/deploy-pages`. Takes about 30 seconds. A failing test blocks the deploy.
- Pages is configured with **Source = GitHub Actions** (`build_type: workflow`). That was enabled once through the API. It does not need to be repeated.
- To check a deploy: `gh run list --repo masonchern/boardgames --limit 3`, then `gh run watch <run-id> --repo masonchern/boardgames --exit-status`.
- GitHub Pages only hosts static files. The **game server** is a Cloudflare Worker (`server/`), live at `https://boardgames-hub.masonchern.workers.dev`. CI deploys it when repo variable `WORKER_READY=1` and secrets `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID` are set. The site calls it via `VITE_API_URL` (baked in at build time). First-time setup is in `server/README.md`.
- Accounts and W/L are in the D1 database `boardgames`. Re-applying `server/schema.sql` is additive (`CREATE TABLE IF NOT EXISTS` only). Never `DROP` those tables; a Worker deploy must not reset win/loss.

---

## 8. Git workflow (read carefully)

### State
- Repo initialized locally in the project folder, branch **`main`**, remote **`origin`** = `https://github.com/masonchern/boardgames.git` (HTTPS).
- Single developer, no branching convention yet. Work directly on `main`. Every push to `main` **deploys to production**, so make sure `npm run build` passes first.
- `.gitignore` excludes `node_modules`, `dist`.

### Identity
Repo-local git config (not global) uses the GitHub no-reply address, so the user's real email stays private:
```
user.name  = masonchern
user.email = 28799889+masonchern@users.noreply.github.com
```
Do not replace it with a real email.

### Standing instruction from Mason
**Commit and push every change to `main` as part of finishing a task** (Mason said: "just push every change from now on"). Run `npm test` and `npm run build` first, since a push deploys to the live site. Then confirm the deploy succeeded. This covers ordinary changes only. Still ask before anything destructive or unusual (force-push, deleting branches or the repo, changing repo visibility or Pages settings).

### Publishing a change
```
git add -A
git commit -m "Short imperative description"
git push
```
Commit messages: short, imperative, English.

### Tooling on this machine (Windows, PowerShell)
Git, GitHub CLI (`gh`) and Node were installed with `winget`. They may not be on `PATH` in an already-open terminal. **Refresh PATH first** in your shell session:
```powershell
$env:Path = [System.Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [System.Environment]::GetEnvironmentVariable('Path','User')
```
- If PowerShell blocks `npm` with a script-policy error, use `npm.cmd`.
- `npm` prints a harmless warning: `Unknown env config "devdir"`.

### Authentication
- `gh` is logged in as **masonchern** over HTTPS with scopes `repo`, `workflow`, `read:org`, `gist`. Git uses these credentials through the gh credential helper.
- The `workflow` scope is required to push changes to `.github/workflows/*`. Without it, GitHub rejects the push.
- If auth is lost, `gh auth login --hostname github.com --git-protocol https --web` prints a one-time code (also copied to the clipboard). **The user must enter it at https://github.com/login/device** and click Authorize. The code expires in about 15 minutes, so tell the user clearly and wait for them. You cannot complete this step yourself.
- Cursor's auto-review may block actions that touch GitHub login, a push to `main`, or repo settings. Retry the exact same call with the approval flag so the user can approve it. Do not work around it with a different method.

### Safety rules for git
- Never force-push to `main`, never rewrite published history, and never commit `node_modules`, `dist` or secrets.
- Do not change repo visibility or Pages settings without the user's say-so (the repo is public because free Pages requires that).
- Before committing, check `git status` and make sure nothing unintended is staged.

---

## 9. Environment notes

- The project lives in **OneDrive** (`Desktop\Boardgames`). OneDrive syncs `node_modules` (thousands of small files). Suggest pausing sync for that folder or moving the project if it causes trouble.
- The Cursor in-editor browser **cannot open `file://` URLs**. Test against `http://localhost:5173` (dev) or `http://localhost:4173` (preview), or the live URL. If the first `browser_navigate` leaves you on `about:blank`, create a new tab (`browser_tabs` with `action: new`) and navigate again.
- A leftover dev server may hold port 5173 (Vite then silently falls back to 5174). Check for running processes before assuming a port.
- `npm audit` currently reports 0 vulnerabilities.
- **Build stamp:** every page footer shows `v<major>.<minor>.<commit count> · build <git commit> · <UTC time>` (`src/core/buildInfo.js`, values injected by `define` in `vite.config.js`; CI uses `GITHUB_SHA`). The version number goes up automatically with every commit (patch = `git rev-list --count HEAD`; Mason asked that it change with every change, so never hard-code it). Major.minor come from `version` in `package.json`; bump them by hand only for milestones. CI checks out with `fetch-depth: 0` so the commit count is correct. Dev servers say "dev build". **Stale pages:** the build also writes `dist/version.json` (`{commit, version}`, vite plugin `versionFile`). `src/core/updateCheck.js` fetches it uncached on load, every 5 minutes and when the tab becomes visible; if the commit differs from the running build it shows an "Update now" banner (reloads with `?v=<commit>` to bypass the cached index.html). Pages that predate this feature never get the banner, so a one-off fix for them is opening `https://masonchern.github.io/boardgames/?v=<short commit>`. When Mason reports "the live site looks old", ask him to read this stamp and compare it with `git rev-parse --short=7 HEAD` (browsers and phones cache aggressively).

---

## 10. Quick verification checklist after any change

1. `npm test` and `npm run build` complete without errors.
2. `npm run dev`, then in the browser: lobby lists every game, Close Circuit plays through (setup screen, place cards, win, next game), and back-to-lobby works.
4. Commit and push, then confirm the Actions run succeeded and the live URL reflects the change.

---

## 11. Close Circuit (Mason's invented game)

Spec source: `src/games/close-circuit/SPEC.txt` (English). Rules code: `src/games/close-circuit/rules.js` (heavily commented, with an ASSUMPTIONS list). Geometry and circuit detection: `circuit.js`. Canvas UI: `view.js`.

There are two modes, chosen on the setup screen (`options.mode`: `normal` default, or `advanced`). Rules for both live in `rules.js`; advanced behaviour is gated on `state.options.mode === 'advanced'`. Tests: `rules.test.js` (normal) and `rules.advanced.test.js`.

### Advanced mode (added Oct 2026, "let's see how it works out", expect tuning)
- **Deck:** 80 cards, shuffled with the authority's seed: 48 straight, 24 turn, 4 **Limit**, 4 **Cross**. Constants in `ADVANCED` in `rules.js`. Each player holds **5** cards (`state.hands[playerId]`, cards are `{id, type}`) and refills to 5 after every turn until the deck (`state.deck`, drawn from the front) runs out.
- **Turn:** play 1-3 cards from the hand (function cards count toward the 3, at least one must be a straight or turn). Each placement carries a `cardId`. **Limit**: the opponent's next turn must play exactly `min(3, straight/turn cards in hand)` straight/turn cards (`state.limitedPlayerId`, helper `limitRequirement`); a limited player cannot challenge or solve (can still resign). **Cross**: placement `{kind:'cross', x, y, cardId}` converts a straight already on the board (or placed earlier this turn) into a 4-ended intersection (`cross` in `CARD_KINDS`, cell keeps its owner).
- **No line card in hand:** the hand is shuffled back into the deck and redrawn until it has one (automatic, `notice` explains). A player who still has none (deck has none left) skips; if neither can play the game is a draw (`no-cards`).
- **Deck out (both modes):** players play what is left in their hands; draw if nobody can play. (Normal mode has no hands, so an empty deck is an immediate draw as before.)
- **Challenge:** the challenged player plays from the face-up deck (`poolCounts(state)` = straights/turns left), any cards, any number, one attempt. The UI shows the remaining counts on the Straight/Turn buttons. **Solve** (`SOLVE` action): allowed on your turn when `deckRemaining <= ADVANCED.solveAtDeck` (22, our reading of "round 50"). Same face-up mechanics; success wins, failure/resign/timeout loses (`solve-*` results). `state.challengerId` holds the solver in that phase and `state.current` stays the solver.
- **UI:** `view.js` shows the opponent's hand as card backs above the board (blue paw-print back = straight/turn, gold gift-box back = function card, so only the number of function cards leaks) and your hand face up below it. Tapping a line card selects it, a Cross card selects it (then tap a straight), a Limit card is toggled on/off. The view calls `rules.validate` before dispatching `PLAY` so mistakes (for example not playing 3 under Limit) show a message.
- Not covered yet: per-player state redaction for online play, and no UI for the 22-card threshold other than the Solve button unlocking.

### Rules as implemented (normal mode)
- 2 players share ONE deck of 48 cards. Every card is placed as a **straight** line or a **90-degree turn**, in any rotation.
- Each turn a player places **1 to 3** cards on a **100x100** grid, then ends the turn. The first card of a game goes in the **center cell** (50,50). After that cards may go **anywhere** (they need not touch the board), but the cards placed in ONE turn must be adjacent to each other and form **a straight line** of 1-3 cells (one row or column, any mix of straight/turn cards, no L shapes). This is checked in order by `placementProblem` (each new card must extend the line made by the earlier ones), but a challenged player is exempt: in a challenge they may place any number of cards (up to `deckRemaining`, i.e. the whole deck) in any shape. (Changed Oct 2026 by Mason; advanced mode still uses "must touch the board".)
- **Win:** after a placement, every line end on the board connects to a matching end of a neighbouring card (no loose ends) AND all cards form **one single circuit** (`isOneGroup` in `circuit.js`; no separate loops, no stray cards). Whoever just placed wins. A single line is not closed; a square or rectangle is. `isWinningBoard(board, options)` applies the single-loop rule in normal mode only; advanced mode still counts separate loops as closed.
- **Challenge ("no solution")**: on your turn, instead of placing, you may challenge (needs at least 1 card on the board). The opponent then gets `turnSeconds + challengeSeconds` to close the circuit, with ALL remaining deck cards and no straight-line restriction (one attempt; advanced mode has the same "whole deck" idea via the face-up pool). Closed -> the challenged player wins. Failed, conceded or timed out -> the challenger wins.
- **Timers:** `turnSeconds` (default 30) per turn; `challengeSeconds` (default 30) extra for a challenged player. Both are chosen on the pre-game setup screen, and **each can be switched to "No limit"** (stored as `null`). Running out of time **loses the game**. With no limit, `state.deadline` is `null`, the view shows "∞ No time limit", and `TIMEOUT` is rejected. A challenge has no deadline if either value is `null`.
- **Coordinates:** setup option `coordinates` (`on` default, or `off`). When on, the view draws x/y numbers on the sides of the board. The center cell is (0, 0); x increases right, y increases up. Display-only: rules still use grid indexes 0..99.
- **Series:** player 1 starts game 1, player 2 starts game 2, and so on. Wins are tracked across games (`state.wins`), with `NEXT_GAME` starting the next one.

### Assumptions Mason did not specify (flagged, easy to change)
In advanced mode separate loops all count as closed (normal mode requires one single loop); in normal mode the first card still goes in the center even though later cards need not touch the board; deck empty with no closed circuit = draw; timeout in a normal turn = loss; resigning is allowed any time on your turn; a challenge is only allowed once the board has a card. Confirm these with Mason before building on them.

### Design notes
- State, actions: `PLAY {placements:[{x,y,kind,rot,cardId?}]}`, `CHALLENGE`, `SOLVE` (advanced), `CONCEDE`, `TIMEOUT`, `NEXT_GAME`. A whole turn is ONE atomic `PLAY`; the view keeps a local "draft" of placed-but-unsubmitted cards (Undo removes only the last, so adjacency always holds). The view uses the rules' own `placementProblem()` so UI and rules cannot disagree. After placing, a tap on that draft tile still edits it: **right ~40% of the cell rotates** (straight: 2 ways, turn: 4); **the rest of the cell toggles straight/turn** in normal mode and in advanced challenge/solve. Advanced hand play cannot change type (the hand card is fixed), so only the right-side rotate applies.
- The view dispatches `TIMEOUT` when its countdown hits zero; the rules accept it only if `meta.now >= state.deadline`. In online play the server must stamp time and be the one to enforce it.
- Cards are data: `CARD_KINDS` in `circuit.js` lists each kind's rotations and line ends. The win condition is the single function `isWinningBoard(board, options)`. Option values like `gridSize`, `deckSize`, `maxPerTurn` already exist in `state.options` but are not exposed in the UI.
- **Extending:** new card kinds go in `CARD_KINDS` (and `LINE_KINDS` if they are plain line cards); new win conditions (e.g. single loop, minimum size) go in `isWinningBoard`.
- Rendering is a `<canvas>` with pan (drag), zoom (wheel), hotkeys (R rotate, T toggle kind, Z undo), and a live "open ends" overlay (red dots). Each card kind remembers its own rotation (`rots` in `view.js`): Rotate only turns the selected kind, and the Straight/Turn buttons preview their current rotation. In advanced hand play rotation is per hand card instead (`cardRots` by card id): Rotate turns only the selected card, and each hand card shows its own rotation.
- **Look (set by Mason):** the board is drawn like a xiangqi (Chinese chess) board, i.e. smooth light-brown wood with thin dark-brown grid lines, a double frame line and a wooden border (`.cc__board`). Cards are cream rounded tiles with a pastel track in the owner's color (blue / rose) and a cute animal emoji on a round badge. Each player has an animal team (`teams` in `view.js`); the animal is chosen from the cell coordinates, so it is pure decoration and never part of game state. Animals are skipped below 22px per cell. Emoji rendering depends on the device's emoji font.
- **Mobile:** the UI is responsive (CSS breakpoint 760px, plus `pointer: coarse` for tap-sized buttons), not device-sniffed. On phones the top nav hides while a game is open (`.shell.is-in-game`), the board height follows `100dvh`, and the controls become full-width rows. The canvas uses pointer events: tap places a card, one-finger drag pans, two-finger pinch zooms (the `pointers`/`pinch` logic in `view.js`); long-press does not rotate. Right-click starts a length measure (scroll to change Δx, Shift+scroll for Δy; Esc or right-click the start to stop). Rotate with R or the Rotate button. Test with phone emulation (e.g. 390x780) before shipping UI changes.
- Players are still `Player 1` / `Player 2` (no custom names yet).
