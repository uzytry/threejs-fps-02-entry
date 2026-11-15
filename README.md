# CINDERFALL — a three.js tactical FPS

A complete, original, round-based tactical FPS that runs offline from static
files. You are EMBER, attacking the Reactor pad in an abandoned solar refinery
at dusk; ASH holds it. First to five rounds takes the match.

## Play it

```sh
node serve.ts
# open http://localhost:8080
```

No build step, no network requests, no assets to download: three.js 0.187.0 is
vendored under `game/vendor/three/`, and every sound is synthesized in WebAudio.

## What is in the game

- **Rounds that resolve three ways** — elimination, the bomb (plant in 3.5 s,
  40-second fuse, 5-second defuse), or the clock — with a buy phase between them.
- **An economy and a shop** — $800 to start, $300 a kill, $3,250 a round win;
  buy the VK-7 rifle, the Kestrel-9 SMG, frag grenades and armour with keys 1–4.
- **Gunplay where accuracy pays** — spread grows with movement speed and halves
  while aiming, recoil kicks the view, headshots deal 4×, armour absorbs half.
- **Nine bots with a real AI** — waypoint routes down three lanes, hold spots,
  a vision cone plus line-of-sight, hearing (gunshots draw investigation),
  burst fire with a reaction delay and aim that sharpens as it tracks, strafing,
  bomb pickup, planting, defusing and post-plant defence.
- **A full HUD** — health and armour, ammo, money, round timer, score, team
  status, killfeed, bomb state, plant progress, hitmarkers and a damage
  vignette; death drops you into spectating an ally until the next round.
- **A fixed 60 Hz simulation** decoupled from rendering, a pooled tracer system,
  and one shared collision mover for the player and every bot.

## Controls

| Key | Action |
| --- | --- |
| W A S D / Space / Ctrl | Move / jump / crouch |
| Mouse / Click / Right-click | Look / fire / aim |
| R / 1 2 3 / G | Reload / switch weapon / throw grenade |
| E | Plant the charge (at the Reactor pad) |
| B | Buy menu (buy phase) |
| M | Mute |

## Layout

- `game/index.html` — the page, the HUD DOM and the import map.
- `game/src/main.js` — boot, the fixed-step loop, shooting, tracers, shots.
- `game/src/world.js` — the map, the waypoint graph, collision, line of sight.
- `game/src/bots.js` — the bot AI.
- `game/src/weapons.js` — the arsenal and its view models.
- `game/src/player.js` — movement, health, armour.
- `game/src/rounds.js` — rounds, money, the shop, the bomb.
- `game/src/grenades.js` — thrown frags.
- `game/src/audio.js` — synthesized sound.
- `game/src/input.js`, `game/src/hud.js` — input and the DOM HUD.
- `main.ts` — the entry program: copies `game/` and `screenshots/` to
  `/output` and writes `dossier.json`.
- `shots.json` — the four deterministic screenshot frames (`?shot=`).

## Deterministic screenshots

`?shot=combat|push|site|buy&seed=N` builds a fixed frame and sets
`window.__shotReady` when it has painted twice, so captures are reproducible.

## License

MIT — see `LICENSE`. three.js is vendored under its own MIT license.
