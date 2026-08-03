# Assets

Sumo sprites and dohyo art from **sdkfz181tiger** (itch.io), the mango icon cropped from a
fruit/vegetable pack by **zeschpix** (itch.io). Curated from the original export into the layout
below; the original bundle (all poses, both preview sheets, and the full fruit/veg pack) is not
committed - only what the game actually loads is.

```
assets/sumo/          One character, one row of equal-size frames per file - see the mapping below.
  idle.png             5 frames - ready stance
  walk.png             4 frames - forward lean / run
  hit.png              5 frames - kick strike (A)
  push.png             5 frames - committed shove (B)
  brace.png            5 frames - guard stance (parry brace)
  stagger.png          3 frames - recoil (hurt/stun)
  fallen.png           3 frames - on all fours (ring-out)

assets/arena/
  ring.png              the dohyo platform
  roof.png              the shrine roof
  crowd.png             the audience strip
  banner.png            the "満員御礼" sign
  cushions.png          zabuton cushion stack

assets/characters/
  referee.png            gyoji
  fan_monk.png, fan_lady.png, fan_girl.png   spectator sprites (not currently drawn in-game;
                                              kept for anyone extending the crowd/win pose)

assets/ui/
  mango.png              the earned-mango icon (pop effect + HUD meter)
```

## Frame size and the state → sheet mapping

Every sumo sheet here is `50px` tall frames in a single row. Nothing about slicing is hardcoded in
the renderer - it all comes from `CONFIG.sprites` in `shared/config.js`:

```js
sprites: {
  frameWidth: 50,
  frameHeight: 50,
  states: {
    idle:      { file: '/assets/sumo/idle.png',    frames: 5, fps: 6,  loop: true  },
    walk:      { file: '/assets/sumo/walk.png',    frames: 4, fps: 10, loop: true  },
    hit:       { file: '/assets/sumo/hit.png',     frames: 5, fps: 16, loop: false },
    push:      { file: '/assets/sumo/push.png',    frames: 5, fps: 12, loop: false },
    brace:     { file: '/assets/sumo/brace.png',   frames: 5, fps: 10, loop: true  },
    hurt:      { file: '/assets/sumo/stagger.png', frames: 3, fps: 12, loop: false },
    ringout:   { file: '/assets/sumo/fallen.png',  frames: 3, fps: 8,  loop: false },
    celebrate: { file: '/assets/sumo/idle.png',     frames: 5, fps: 5,  loop: true  },
  },
},
```

`client/desktop/sprites.js`'s `Animator` falls back to `idle` if a state's sheet fails to load, per
the acceptance spec. There's no dedicated "shrink/grow" sheet - the weight-driven size change is a
continuous scale applied to whichever frame is already showing (`bodyRadiusFromWeight()` in
`shared/config.js`), not a separate animation.

## Dropping in your own sheets

To swap art: replace the files in `assets/sumo/` (or point `CONFIG.sprites.states[...].file`
somewhere else), keep frames the same height in a single row, and update `frames`/`frameWidth` to
match. Two on-screen fighters read as distinct without needing two palettes - P2 is drawn with a
canvas hue-rotate filter (`client/desktop/render.js`) rather than a second sheet, since the source
pack only ships one sumo palette. If you do get a second palette, remove that filter and load it
for `p2` instead.
