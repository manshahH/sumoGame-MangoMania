# SUMO TIME

A fast, pixel-art 1v1 sumo arcade game for events: the match plays on a desktop screen (laptop or
TV), and each player's phone browser is their controller. Push your opponent out of the ring to
win. A match is best of 3 rounds, each capped at 25 seconds. Play 2 players, or 1 player vs a bot.

**Live:** <https://sumo-time-mango-mania.vercel.app> — see [Deploying](#deploying) for the caveats
that come with hosting it there rather than on the LAN.

The networking, room and lobby layer is lifted from the author's other phone-as-controller project,
**NAUTILUS**: an Express + Socket.IO relay, a desktop host that runs the authoritative simulation,
and phones as thin controllers that only ever send input intents. Nothing about that layer was
reinvented here - it's the same host-authoritative model, just with two seats instead of four
stations.

---

## Run it

```bash
npm install
npm start
```

- **Ring (the big screen):** <http://localhost:4321>
- **Controller (phones):** scan the QR code shown on the ring, or type the printed URL

The desktop prints its LAN address on start. A phone on the same WiFi scans the QR, lands on a
join screen, and claims **P1** or **P2**. Whichever seat nobody claims is fought by the bot - so
"P1 vs BOT" is just P1 claiming a seat and starting the match. Port is `4321`; override with
`PORT=8080 npm start`.

### Solo testing without a second device

Open a controller directly in a second browser tab:

```
http://localhost:4321/play?room=<ROOM CODE>&seat=p1&name=ALICE
http://localhost:4321/play?room=<ROOM CODE>&seat=p2&name=BOB
```

`seat` and `name` are optional - without them you just get the normal join screen. Open one tab and
leave the other seat to the bot, or open both and referee a human-vs-human match from one machine.

### Self-tests

```bash
npm test              # runs shared/selftests-node.js headlessly
```

or open the ring with `http://localhost:4321/?test` and read the browser console. Both run the
exact same `runSelfTests()` suite in `shared/selftests.js` - deterministic, no DOM, no sockets.
It covers: the weight → speed/push-resistance curves, knockback weight-ratio scaling, ring-out
detection, the A / B / A+B input resolver (including the grace-window parry upgrade), parry
cancel/punish/mango, weight floor/cap clamping, combo + milestone mango + parry breaking a combo,
round endings and the full tiebreak chain, the best-of-3 round tally and per-round reset, per-match
stats surviving a round reset, mango leaderboard ranking, the ready gate, the winner-stays-on
streak, and a headless bot-vs-bot match that must terminate legally.

Three of those suites exist because the behaviour was once broken and the bug was invisible from
the code: **bots actually land hits and pushes**, **bots never walk themselves out of the ring**,
and **bots engage early in every round** (not just round 1).

---

## How to play

A match is **best of 3 rounds**. Before every match each player gets a rules card on their phone
and taps **READY** - that's separate from claiming a seat, and nobody fights until both are ready.

Controls live at the **bottom** of the phone, where thumbs actually are:

- **Left thumb:** joystick, moves you around the ring. You always face your opponent automatically
  - there's no aiming, so it's pick-up-and-play for a stranger at an event.
- **Right thumb, two big buttons offset on a diagonal, close enough that one thumb can roll across
  both:**
  - **A (lower) = HIT** - fast, short range, chips a little weight and stuns. It's the button you
    press most, so it gets the shorter reach.
  - **B (upper) = PUSH** - slower to throw and to recover from, but a big knockback scaled by
    the weight gap between you and your opponent. This is your ring-out finisher; whiffing it
    leaves you open.
  - **Hold A + B together = PARRY.** The detector treats *holding both* as a brace rather than
    requiring a frame-perfect simultaneous tap - if the second button joins within ~90ms of the
    first, it upgrades to a parry and cancels whatever single-button action was about to fire. The
    first ~250ms of the brace is the active window: a hit or push landing in it is fully cancelled,
    staggers the attacker, and earns you a **mango** (restores weight). Mash it with nothing coming
    in and you're just standing there exposed once the window closes.

**Weight is the whole game.** It's your HP, your mass, and your size all at once: heavier hits
harder and resists knockback, but moves slower and is a bigger sprite. Getting hit shrinks and
speeds you up; a well-timed parry claws weight back. That's the built-in comeback mechanic - a
shrinking underdog is fast and hard to corner, while the bloated leader is slow and easy to slip
past.

**Ring-out wins the round.** If the clock runs out with nobody pushed out, the round goes to the
heavier fighter, then the bigger one, then whoever earned more mangoes, then who landed more hits,
and finally whoever is closest to the centre. (Size is derived from weight in this game, so that
step can never actually separate two fighters the weight step tied — mangoes are the first check
that really breaks a weight tie.) Weight and positions reset between rounds. First to 2 rounds
takes the match.

**The weight bar reads full at 100.** Anything a fighter earns above the starting weight (from
mangoes) rides on top of the full bar as a gold overfill segment, rather than the bar being scaled
across the whole floor-to-cap range and starting life two-thirds empty.

### Bot difficulty

Three tiers, and they differ on every axis rather than being one bot at three speeds — thinking
speed, nerve, defence, aggression, footwork, ring craft and self-preservation all move together:

| Tier | Plays like |
| --- | --- |
| **ROOKIE** | Slow, timid and clumsy near the edge. Hesitates a third of the time, almost never parries. Beatable by anyone. |
| **OZEKI** *(default)* | Solid. Softens you up, then takes the push when it's there. |
| **YOKOZUNA** | Fast, reads your pushes, and walks you onto the edge on purpose. |

Measured head-to-head over 120 matches with seats alternated: YOKOZUNA beats ROOKIE 100%, OZEKI
beats ROOKIE 100%, and YOKOZUNA edges OZEKI 72% — a strictly ordered ladder, asserted by the
self-tests so the tiers can't quietly collapse into each other.

### The Mango Mania leaderboard

Ranked on **mangoes earned across all rounds of a match**, with **total hits landed** breaking
ties. Mangoes are the right currency because you only ever get one by reading a parry or stringing
a combo together — never by luck or by standing in the right place. Both tallies are on the
desktop HUD during the fight, and each player sees their own count on their phone.

A run good enough for the top five **prompts for a name** before it is saved, headlined
`NEW RECORD!` when it beats everything on the board.

**Winner stays on.** The champion holds the ring and their win streak is tracked. After a match you
get a result screen with **PLAY AGAIN** or **LOBBY**.

The loser's seat only opens up when somebody is actually waiting for it - a connected player in
the room who isn't holding a seat. With nobody queued, the loser keeps their seat and can rematch
straight away. That's deliberate: it means a solo player who loses to the bot is never ejected from
their own seat and left watching two bots fight each other.

---

## What's in here

```
server/           Express + Socket.IO relay. Rooms, LAN address detection, QR. Never simulates.
shared/           The game, with no DOM and no sockets - runs in the browser and in node.
  config.js       Every tunable in the project (weight, hit/push/parry timing, combo,
                  round length, ring size, bot tier traits, sprite frame layout, colors...).
  rng.js          Seeded RNG so a seed + input sequence replays identically.
  roles.js        Two-seat lobby: claim/release/resolve P1 and P2, unclaimed -> bot.
  sim.js          The deterministic sumo sim: movement, weight, hit/push/parry resolution
                  (including the grace-window input resolver), combo, mango, body collision,
                  ring-out, best-of-3 rounds, per-match stats, timeout tiebreak.
  bots.js         Bot AI - produces the same {move, a, b} input intents a phone would, through
                  the same setInput() path. Three tiers (reaction time, parry frequency).
  engine.js       sim + bots + the ready gate, headless - what the desktop host and the
                  self-tests both drive.
  streak.js       Winner-stays-on champion streak, pure functions.
  leaderboard.js  Mango Mania ranking: mangoes per match, hits as the tiebreak.
  selftests.js    runSelfTests() - the acceptance suite described above.
client/desktop/   The ring: canvas renderer, sprite-sheet animation state machine, the
                  procedurally drawn dohyo, screen shake / hitstop / dust / sparks, synthesised
                  SFX + chiptune, the lobby, and the best-of-3 match loop.
client/phone/     The controller: bottom-anchored joystick + diagonal A/B, the rules/ready card,
                  the personal HUD, the join/lobby screens. Never renders the fight - immune to
                  render and network jitter.
client/shared/    The shared pixel-arcade CSS skin both clients pull from.
assets/           Curated sprite sheets and arena art (see assets/README.md for the frame layout
                  and where CONFIG points at each file).
```

**Authority:** the desktop is the host. It runs the simulation and the bots, and pushes each phone
only that phone's own HUD slice (weight, combo, parry-ready light). Phones are thin controllers -
they send `{move, a, b}` input intents and render nothing of the fight themselves. The server is a
relay: room membership and message passing, nothing else.

**Tuning:** every number that affects feel - weight start/floor/cap, hit chip and cooldown, push
windup/recovery/knockback, the parry grace/active/recovery/cooldown windows, combo window and
milestone, mango weight gain, round length, ring size, bot tier traits, sprite frame size and the
animation-state → sheet mapping, colors - lives in `shared/config.js` and nowhere else.

---

## Acceptance checklist

- [x] `npm install` then `npm start`; desktop opens at `localhost:4321`; a phone on the same WiFi
      joins via the QR or the printed URL
- [x] Two phones can fight, or one phone vs bot; controls are left joystick + diagonal A/B, A=hit,
      B=push, A+B=parry
- [x] Getting hit shrinks you and makes you easier to push; a landed push scales knockback by the
      weight gap; ring-out wins
- [x] Perfect parry cancels the blow, grants a mango and weight, and punishes the attacker; the
      active window (250ms) plus the 90ms grace window survive real network jitter
- [x] Rounds are capped at 25s by the round clock; a full best-of-3 lands around 40-60s of fighting
- [x] Winner-stays-on with a visible streak, and the loser is never ejected unless somebody is
      queued for the seat
- [x] Pixel-perfect rendering (nearest-neighbor, `image-rendering: pixelated`, no smoothing), the
      provided sprites animate through the state machine, mango pop on earn, and pushes carry
      screen shake, dust and a hitstop freeze
- [x] The dohyo is drawn from the ring radius, so the boundary on screen is exactly where a
      ring-out happens
- [x] Bots engage from the first second of every round, including rounds 2 and 3
- [x] Leaderboard ranks mangoes earned per match, hits break ties, and a qualifying run prompts
      for a name
- [x] Three genuinely different bot tiers, and no bot ever walks itself out of the ring
- [x] Weight bars read full at the starting weight, with mango overfill shown on top
- [x] `runSelfTests()` all-pass (146/146, `npm test` or `?test`)

---

## Deploying

Deployed at <https://sumo-time-mango-mania.vercel.app> (`vercel deploy --prod`, config in
[`vercel.json`](vercel.json)).

**It works, but read this before relying on it at an event.** This is a stateful Socket.IO server:
the room registry lives in memory, and the whole point of the relay is that the desktop host's
socket and the phones' sockets can find each other. Vercel's WebSocket support is a
[public beta on Fluid compute](https://vercel.com/kb/guide/do-vercel-serverless-functions-support-websocket-connections),
and their own docs are explicit that *"future connections are not guaranteed to connect to the same
Function"*, with a default connection cap of 5 minutes (30 on Pro/Enterprise, beta only).

Neither of those is a fit for what this app does. In practice it held up better than the docs
suggest — 12/12 phone joins reached the room, input relayed correctly, and a full match played
through — but the failure mode when it does bite is nasty and silent: a phone lands on a different
instance, finds an empty room registry, and gets `NO SUCH ROOM` for a room that is plainly on the
screen in front of them.

So:

- **For the event, run it on the LAN** (`npm start`). That is what it was built for, it has no
  cloud dependency, and a 90ms parry window is far happier over WiFi than over the internet.
- **The Vercel deploy is good for showing people the game** — a link that works from anywhere,
  bot matches, trying the controls.
- **If you want a reliable hosted version**, put it on anything that runs a persistent Node
  process — Render, Railway, Fly.io — where it deploys unchanged with `npm start` and none of the
  above applies. No code changes needed; the server already honours `PORT`.

The join URL and QR adapt automatically: they use the public hostname when deployed and the
machine's LAN IP when run locally (a desktop opened on `localhost` still gets a LAN-IP QR, because
"localhost" on a phone means the phone). `PUBLIC_URL` overrides both if you are behind a proxy.

The leaderboard is per-browser (`localStorage` on the desktop that hosts), so it is per-screen and
per-session rather than global — no backend needed, which is deliberate for a one-night event.

---

## Assets

See [`assets/README.md`](assets/README.md) for what's in `assets/`, where it came from, and how
`CONFIG.sprites` maps each animation state to a sheet and frame count.
