// Retro arcade SFX, synthesised with the Web Audio API - no files, no
// attribution, nothing to download. A light chiptune loop runs under the
// fight; cues layer on top for hits, pushes, parries and ring-outs.

export function createAudio() {
  let ctx = null
  let master = null
  let loopGain = null
  let loopTimer = null
  const api = { enabled: true, started: false }

  function noiseBuffer(seconds = 1) {
    const len = Math.floor(ctx.sampleRate * seconds)
    const buf = ctx.createBuffer(1, len, ctx.sampleRate)
    const d = buf.getChannelData(0)
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1
    return buf
  }

  api.start = () => {
    if (api.started) return
    const AC = window.AudioContext || window.webkitAudioContext
    if (!AC) return
    ctx = new AC()
    master = ctx.createGain()
    master.gain.value = api.enabled ? 0.6 : 0
    master.connect(ctx.destination)
    loopGain = ctx.createGain()
    loopGain.gain.value = 0.16
    loopGain.connect(master)
    api.started = true
  }

  api.resume = () => {
    api.start()
    if (ctx?.state === 'suspended') ctx.resume()
  }

  api.setEnabled = (on) => {
    api.enabled = on
    if (master) master.gain.setTargetAtTime(on ? 0.6 : 0, ctx.currentTime, 0.05)
  }

  function env(node, peak, attack, decay) {
    const now = ctx.currentTime
    node.gain.cancelScheduledValues(now)
    node.gain.setValueAtTime(0.0001, now)
    node.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), now + attack)
    node.gain.exponentialRampToValueAtTime(0.0001, now + attack + decay)
  }

  function tone({ type = 'sine', from, to, peak = 0.2, attack = 0.01, decay = 0.5, filter, dest }) {
    if (!api.started || !ctx) return
    const osc = ctx.createOscillator()
    const g = ctx.createGain()
    osc.type = type
    osc.frequency.setValueAtTime(from, ctx.currentTime)
    if (to != null) osc.frequency.exponentialRampToValueAtTime(Math.max(1, to), ctx.currentTime + attack + decay)
    let tail = g
    if (filter) {
      const f = ctx.createBiquadFilter()
      f.type = filter.type || 'lowpass'
      f.frequency.value = filter.freq || 800
      g.connect(f)
      tail = f
    }
    osc.connect(g)
    tail.connect(dest || master)
    env(g, peak, attack, decay)
    osc.start()
    osc.stop(ctx.currentTime + attack + decay + 0.05)
    return osc
  }

  function burst({ peak = 0.2, decay = 0.6, freq = 500, type = 'bandpass', q = 1 }) {
    if (!api.started || !ctx) return
    const src = ctx.createBufferSource()
    src.buffer = noiseBuffer(Math.max(0.4, decay + 0.2))
    const f = ctx.createBiquadFilter()
    f.type = type
    f.frequency.value = freq
    f.Q.value = q
    const g = ctx.createGain()
    src.connect(f)
    f.connect(g)
    g.connect(master)
    env(g, peak, 0.01, decay)
    src.start()
    src.stop(ctx.currentTime + decay + 0.2)
  }

  // ---------------------------------------------------------- chiptune ----
  const SCALE = [0, 3, 5, 7, 10, 12, 15, 19] // minor pentatonic-ish, arcade flavour
  const ROOT = 196 // G3
  let loopStep = 0

  function loopTick() {
    if (!api.started) return
    const deg = SCALE[loopStep % SCALE.length]
    const freq = ROOT * Math.pow(2, deg / 12)
    tone({ type: 'square', from: freq, peak: 0.05, attack: 0.002, decay: 0.14, dest: loopGain })
    if (loopStep % 4 === 0) {
      tone({ type: 'triangle', from: ROOT / 2, peak: 0.05, attack: 0.002, decay: 0.1, dest: loopGain })
    }
    loopStep++
  }

  api.startLoop = () => {
    api.start()
    if (loopTimer) return
    loopTimer = setInterval(loopTick, 165)
  }
  api.stopLoop = () => {
    clearInterval(loopTimer)
    loopTimer = null
  }

  api.cue = {
    bell: () => {
      tone({ type: 'sine', from: 880, peak: 0.28, attack: 0.005, decay: 0.9 })
      tone({ type: 'sine', from: 1320, peak: 0.14, attack: 0.005, decay: 0.7 })
    },
    hit: () => {
      tone({ type: 'sine', from: 220, to: 90, peak: 0.3, attack: 0.004, decay: 0.16 })
      burst({ peak: 0.22, decay: 0.12, freq: 1800, type: 'highpass' })
    },
    push: () => {
      tone({ type: 'sawtooth', from: 140, to: 45, peak: 0.3, attack: 0.02, decay: 0.4, filter: { freq: 500 } })
      burst({ peak: 0.2, decay: 0.35, freq: 300, type: 'lowpass' })
    },
    parry: () => {
      tone({ type: 'triangle', from: 1600, peak: 0.22, attack: 0.002, decay: 0.35 })
      tone({ type: 'sine', from: 2400, peak: 0.12, attack: 0.002, decay: 0.25 })
    },
    mango: () => {
      tone({ type: 'square', from: 660, to: 990, peak: 0.16, attack: 0.005, decay: 0.22 })
    },
    ringout: () => {
      burst({ peak: 0.35, decay: 0.5, freq: 200, type: 'lowpass' })
      tone({ type: 'sawtooth', from: 160, to: 30, peak: 0.32, attack: 0.02, decay: 1.1, filter: { freq: 300 } })
    },
    cheer: () => {
      burst({ peak: 0.18, decay: 1.4, freq: 2200, type: 'bandpass', q: 0.6 })
      burst({ peak: 0.14, decay: 1.6, freq: 1200, type: 'bandpass', q: 0.5 })
    },
    countdown: () => tone({ type: 'square', from: 500, peak: 0.16, attack: 0.004, decay: 0.12 }),
  }

  return api
}
