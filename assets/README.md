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
  referee.png            gyoji - officiates from the far-left of the clay during the fight
  fan_monk.png, fan_lady.png, fan_girl.png   front-row patrons, seated ringside on zabuton
                                              during the fight

assets/ui/
  mango.png              the earned-mango icon (pop effect + HUD meter)

assets/sumo/skins/<id>/  one directory per playable skin, same seven state sheets as
                         assets/sumo (50px frames, single row): idle(5) walk(4) brace(5)
                         fallen(3) push(5) stagger(3) hit(5). Registered in CONFIG.skins.
                         firemonk/, dragon/, oni/ and panda/ were cut from the source art in
                         the repo root - see "Cutting a skin from a contact sheet" below.
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

## Cutting a skin from a contact sheet

The character packs ship as one magenta-keyed contact sheet per character, laid out identically
every time: eight labelled pose groups, `SUMO_A` (01-04) on the left and `SUMO_B` (05-08) on the
right. `firemonk/` was cut from `firemonk sumo.png` with throwaway tooling, and three decisions in
that process are worth writing down because getting any of them wrong is visible in play:

- **Do not eyeball which pose group is which state.** The sheets already in `assets/sumo/` were cut
  from the same layout, so they are an answer key: normalise both to silhouettes and score group
  against group. For firemonk that gave one unambiguous winner per state (IoU 0.78-0.91), and it
  left group 08 - which is other characters entirely, not the wrestler - unused.
- **One scale for the whole skin, not one per frame.** Scaling each frame to fill its cell makes
  the wrestler pulse in size mid-swing. Every frame is bottom-aligned to the floor of the matching
  base frame and centred on that frame's own centre, so a kick that leans left still leans left and
  the feet never leave the clay.
- **Downsample by mode, not by mean.** The source is pixel art blown up ~3x and saved lossily.
  Averaging a footprint that straddles two source blocks invents colours that were never there and
  the result reads as a blurry photo of pixel art. Taking the most common colour (after rounding
  channels to merge compression noise) keeps the hard edges. Background pixels never vote on
  colour - only on coverage - or every sprite ends up with a magenta fringe.

`dragon/` came from `dragonsumo.jfif`, and it is the harder case worth recording because the source
was much weaker: a 137x1024 **JPEG** with the transparency checkerboard baked into the pixels, whose
sprites are already near their final size, so there is no downscaling headroom to average the
compression noise away. Three extra things were needed:

- **Key on neutrality, not on a colour.** There is no magenta here; "transparent" is a bright grey
  checkerboard. Bright plus `max-min < 34` separates it from a green dragon cleanly.
- **Quantise the whole skin to one shared palette.** A lossy source gives each frame slightly
  different greens, so an animation built from it *sizzles* - the noise changes frame to frame where
  the art does not. A 20-colour median-cut palette shared across all seven sheets makes the body
  colour in frame 1 literally the same colour as in frame 5.
- **Pick poses for legibility, not for fidelity.** This pack has its own vocabulary, so the base
  sheets are no use as an answer key and the mapping is by hand. The obvious idle - the low shikiri
  crouch - was wrong: head down and arms folded into the belly, it is the densest pose in the pack
  and at this scale it collapses into a featureless green blob. The upright poses read; the crouch
  moved to `brace`, which is what a sumo guard actually is anyway.

`oni/` came from `oniSumo.png`, which ships in the same pack and layout as the dragon - 31 sprites
in rows of 3,3,2,1,3,2,3,2,3,2,2,1,2,2 - so the dragon's hand mapping transferred verbatim once a
labelled dump confirmed the poses sit at the same indices. A matching row count alone would not have
been enough to assume that.

The oni did force two improvements to the quantiser, and both now apply to every lossy-source skin:

- **Median cut alone loses small bright features.** It splits at the median pixel, so a few dozen
  glowing-eye pixels share a box with thousands of mid-tones and the box average comes out dark -
  the oni arrived as a brown blob with no face. A dozen Lloyd iterations after the split let those
  centroids migrate onto the cluster they belong to, and the eyes, horns and skull pendant come
  back. The palette also went from 20 colours to 32.
- **Mode downsampling erases highlights too.** A glowing eye is two source pixels; at this scale the
  surrounding face always outvotes it. So a footprint containing something far brighter than its
  mode keeps that highlight instead - but only if the highlight is *saturated*. Without that
  proviso, edge pixels bleeding toward the neutral checkerboard win on brightness and every sprite
  grows a grey halo.

`panda/` came from `pandaskin.png` and is the warning against treating these packs as
interchangeable. It looks like the oni sheet - same pack, same 137x1024, same broad layout - and two
things about it are different in ways that would have shipped silently broken:

- **It has a real alpha channel, and the character is white.** The oni's key ("bright and neutral is
  background") would have erased most of a panda. Background here is simply `alpha < 110`, cut at
  half rather than at zero so the anti-aliased fringe does not survive as a halo.
- **The indices do not line up.** The title text survives as its own component (nothing is painted
  over it), and the pack ships one fewer pose group - 29 sprites, not 31. Reusing the oni's index
  map would have put a walk frame where the ring-out belongs. A matching row count is not evidence;
  every index was re-read off a labelled dump.

It also came out the sharpest of the low-resolution skins, which is not luck: high-contrast
black-and-white art survives a downscale that muddy mid-tones do not.

Nothing may exceed the 50px cell in either direction. A frame that spills does not merely look
wrong - the renderer slices the sheet on a fixed grid, so the overflow appears inside the *next*
frame.

## Dropping in your own sheets

To swap art: replace the files in `assets/sumo/` (or point `CONFIG.sprites.states[...].file`
somewhere else), keep frames the same height in a single row, and update `frames`/`frameWidth` to
match. Two on-screen fighters read as distinct without needing two palettes - P2 is drawn with a
canvas hue-rotate filter (`client/desktop/render.js`) rather than a second sheet, since the source
pack only ships one sumo palette. If you do get a second palette, remove that filter and load it
for `p2` instead.
