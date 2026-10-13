/**
 * The contract between the platform and games.
 * To add a new game, just satisfy the types below. No platform code changes needed.
 */

/**
 * @typedef {Object} Player
 * @property {string} id      Unique player ID (maps to a server-side user id in the future)
 * @property {string} name
 * @property {string} [color]
 */

/**
 * Game manifest (manifest.js). It is loaded synchronously by the lobby to render
 * cards, so keep it lightweight and never import the game implementation here.
 *
 * @typedef {Object} GameManifest
 * @property {string} id
 * @property {string} title
 * @property {string} [subtitle]
 * @property {string} description
 * @property {{min:number,max:number}} players
 * @property {'playable'|'wip'|'coming-soon'} status
 * @property {string} [icon]      Emoji or SVG string
 * @property {string} [accent]    Theme color (any CSS color)
 * @property {string[]} [tags]
 * @property {number} [order]     Lobby sort order (lower first, default 100)
 * @property {GameOptionDef[]} [options]  Pre-game settings. When present, the platform shows a
 *                                setup screen first and passes the chosen values to rules.setup().
 * @property {'default'|'wide'} [layout]  'wide' gives the game a larger stage (e.g. big boards)
 */

/**
 * One pre-game setting, rendered by the platform's generic setup screen.
 *
 * @typedef {Object} GameOptionDef
 * @property {string} id            Key in the options object given to rules.setup()
 * @property {string} label
 * @property {string} [description]
 * @property {'number'|'select'} type   `number`: a number input. `select`: pick one of `choices`.
 * @property {number|string} default
 * @property {number} [min]             (number only)
 * @property {number} [max]             (number only)
 * @property {number} [step]            (number only)
 * @property {string} [unit]            (number only)
 * @property {boolean} [unlimited]      (number only) Offer a "No limit" checkbox. When ticked the
 *                                      value is `null`, so rules must treat `null` as "no limit".
 * @property {{value:string, label:string, description?:string}[]} [choices]  (select only)
 */

/**
 * @typedef {Object} GameStatus
 * @property {boolean} isOver
 * @property {string|null} currentPlayerId  Whose turn it is (null once the game is over)
 * @property {string|null} winnerId         null = no winner yet / draw
 * @property {string} [message]
 */

/**
 * Game rules: pure functions with no DOM access, so they can later be moved as-is
 * to a Node server and used as the authoritative rules.
 *
 * Time and randomness: rules must never call Date.now() or Math.random(). The authority
 * (transport / future server) stamps every action with `meta.now` (ms since epoch) and
 * `meta.seed` (a random 32-bit integer for shuffles), and `setup` receives `now` and `seed`.
 * That keeps rules deterministic, and lets a server enforce time limits and own the shuffle.
 *
 * Hidden information (e.g. hands): the authoritative state contains everything. A client
 * must only show what its player may see. Online play: export `redact(state, playerId)`; the
 * Worker sends each client that subset.
 *
 * @typedef {Object} GameRules
 * @property {(ctx:{players:Player[], options?:Object, now:number, seed?:number}) => any} setup
 *     Create the initial state.
 * @property {(state:any, action:any, playerId:string, meta?:{now:number, seed?:number}) => {ok:boolean, error?:string}} validate
 *     Check whether a player's action is legal.
 * @property {(state:any, action:any, playerId:string, meta?:{now:number, seed?:number}) => any} reduce
 *     Apply the action and return a NEW state (never mutate the input).
 * @property {(state:any) => GameStatus} getStatus
 * @property {(state:any, playerId:string) => any} [redact]
 *     Online play: the subset of state this player may see (e.g. hide the opponent's hand).
 */

/**
 * @typedef {Object} GameViewApi
 * @property {Player[]} players
 * @property {() => any} getState
 * @property {(action:any, playerId?:string) => void} dispatch
 *     Send an action. When playerId is omitted, Pass-and-Play uses the current turn's player.
 * @property {'local'|'online'} mode
 * @property {string|null} localPlayerId   In online mode, the player this device represents
 *                                         (null for local pass-and-play)
 * @property {() => void} exit             Leave the game and return to the lobby
 */

/**
 * Game view: only renders state and turns user input into actions.
 *
 * @typedef {Object} GameView
 * @property {(state:any) => void} update   Called whenever the state changes
 * @property {() => void} destroy           Cleanup on unmount (listeners, timers, ...)
 */

/**
 * Game module (default export of games/<id>/index.js)
 *
 * @typedef {Object} GameModule
 * @property {GameRules} rules
 * @property {(container:HTMLElement, api:GameViewApi) => GameView} mount
 */

export {};
