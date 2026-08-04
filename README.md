# SUMO TIME

A fast, pixel-art 1v1 sumo arcade game for events: the match plays on a desktop screen (laptop or
TV), and each player's phone browser is their controller. Push your opponent out of the ring to
win. Matches are short on purpose - the ring shrinks over time, so a match reliably ends inside
about 45 seconds. Play 2 players, or 1 player vs a bot.

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
round endings (with the weight-then-center tiebreak), the best-of-3 round tally and per-round
reset, the ready gate, the winner-stays-on streak, a headless bot-vs-bot match that must terminate
legally, and — after a bug where it wasn't true — that **bots actually land hits and pushes**.

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

**Ring-out wins the round.** If the clock runs out with nobody pushed out, the heavier fighter
takes the round; if weight is tied, whoever's closer to the center. Weight and positions reset
between rounds. First to 2 rounds takes the match.

**Winner stays on.** The champion holds the ring and their win streak is tracked (shown on-screen
and kept in the browser's `localStorage`). After a match you get a result screen with **PLAY
AGAIN** or **LOBBY**.

The loser's seat only opens up when somebody is actually waiting for it - a connected player in
the room who isn't holding a seat. With nobody queued, the loser keeps their seat and can rematch
straight away. That's deliberate: it means a solo player who loses to the bot is never ejected from
their own seat and left watching two bots fight each other.

---

## What's in here

```
server/           Express + Socket.IO relay. Rooms, LAN address detection, QR. Never simulates.
shared/           The game, with no DOM and no sockets - runs in the browser and in node.
  config.js       Every tunable in the project (weight, hit/push/parry timing, combo, ring
                  shrink, match length, bot tiers, sprite frame layout, colors...).
  rng.js          Seeded RNG so a seed + input sequence replays identically.
  roles.js        Two-seat lobby: claim/release/resolve P1 and P2, unclaimed -> bot.
  sim.js          The deterministic sumo sim: movement, weight, hit/push/parry resolution
                  (including the grace-window input resolver), combo, mango, body collision,
                  ring-out, ring shrink, best-of-3 rounds, timeout tiebreak.
  bots.js         Bot AI - produces the same {move, a, b} input intents a phone would, through
                  the same setInput() path. Three tiers (reaction time, parry frequency).
  engine.js       sim + bots + the ready gate, headless - what the desktop host and the
                  self-tests both drive.
  streak.js       Winner-stays-on champion streak, pure functions.
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
milestone, mango weight gain, match length, ring shrink curve, bot reaction times, sprite frame
size and the animation-state → sheet mapping, colors - lives in `shared/config.js` and nowhere
else.

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
- [x] Rounds reliably end inside 30s thanks to the shrinking ring; a full best-of-3 lands around
      20-40s of fighting
- [x] Winner-stays-on with a visible streak, and the loser is never ejected unless somebody is
      queued for the seat
- [x] Pixel-perfect rendering (nearest-neighbor, `image-rendering: pixelated`, no smoothing), the
      provided sprites animate through the state machine, mango pop on earn, and pushes carry
      screen shake, dust and a hitstop freeze
- [x] The dohyo is drawn from the live ring radius, so the boundary is exactly where a ring-out
      happens and the shrink is visible
- [x] `runSelfTests()` all-pass (79/79, `npm test` or `?test`)

---

## Assets

See [`assets/README.md`](assets/README.md) for what's in `assets/`, where it came from, and how
`CONFIG.sprites` maps each animation state to a sheet and frame count.
