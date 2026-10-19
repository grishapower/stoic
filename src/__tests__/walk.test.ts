import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Headless simulation of the whole walk: the real director, Seneca controller
 * and world, with a fake voice player that advances on simulated time and fires
 * cue/ended events from the voice manifest.
 */

const fake = vi.hoisted(() => {
  type CueCb = (e: { clipId: string; cueIndex: number }) => void
  type EndCb = (id: string) => void
  const state = {
    t: 0,
    clip: null as string | null,
    start: 0,
    paused: false,
    pausedPos: 0,
    cue: -1,
    cueCbs: [] as CueCb[],
    endCbs: [] as EndCb[],
    played: [] as string[],
    getClip: null as null | ((id: string) => { duration: number; cues: { start: number; end: number }[] }),
  }
  const pos = () => (state.clip ? (state.paused ? state.pausedPos : state.t - state.start) : 0)
  const voice = {
    get state() {
      return state.clip ? (state.paused ? 'paused' : 'playing') : 'idle'
    },
    get currentClipId() {
      return state.clip
    },
    get currentCue() {
      return state.cue
    },
    get position() {
      return pos()
    },
    preload: async () => {},
    play(id: string, opts?: { fromCue?: number }) {
      const clip = state.getClip!(id)
      state.clip = id
      state.paused = false
      state.cue = -1
      state.start = state.t - (opts?.fromCue != null ? Math.max(0, clip.cues[opts.fromCue].start - 0.15) : 0)
      state.played.push(id)
    },
    pause() {
      if (!state.clip || state.paused) return
      state.pausedPos = pos()
      state.paused = true
    },
    resume() {
      if (!state.clip || !state.paused) return
      const clip = state.getClip!(state.clip)
      const c = state.cue >= 0 ? clip.cues[state.cue].start : state.pausedPos
      state.start = state.t - Math.max(0, c - 0.15)
      state.paused = false
    },
    stop() {
      state.clip = null
      state.paused = false
      if (state.cue !== -1) state.cue = -1
    },
    setSourcePosition() {},
    onCue(cb: CueCb) {
      state.cueCbs.push(cb)
      return () => {}
    },
    onEnded(cb: EndCb) {
      state.endCbs.push(cb)
      return () => {}
    },
  }
  const advance = (dt: number) => {
    state.t += dt
    if (!state.clip || state.paused) return
    const id = state.clip
    const clip = state.getClip!(id)
    const p = pos()
    let cue = -1
    clip.cues.forEach((c, i) => {
      if (p >= c.start && p < c.end) cue = i
    })
    if (cue !== state.cue) {
      state.cue = cue
      state.cueCbs.forEach((cb) => cb({ clipId: id, cueIndex: cue }))
    }
    if (p >= clip.duration) {
      state.clip = null
      state.cue = -1
      state.endCbs.forEach((cb) => cb(id))
    }
  }
  const audio = {
    ready: true,
    unlock: async () => {},
    setBusVolume() {},
    updateListener() {},
    setMenuMuffle() {},
    dispose() {},
    voice,
    ambience: { configure() {}, setTimeOfDay() {}, setWind() {} },
    music: { setEnabled() {}, setIntensity() {} },
    footsteps: { step() {} },
  }
  return { state, audio, advance }
})

vi.mock('../game/audio/engine', () => ({ audio: fake.audio }))
vi.mock('../game/input/pointerLock', () => ({ lockPointer() {}, unlockPointer() {}, installPointerLockListeners() {} }))

import { getClip, letterLines } from '../data/narration'
import { seneca, updateSeneca } from '../game/characters/senecaController'
import { updateDirector } from '../game/narrative/director'
import { runtime } from '../game/runtime'
import { game } from '../game/store'
import { hand } from '../game/interaction/hand'
import { fruits } from '../game/interaction/fruits'
import { STATIONS } from '../game/world/layout'
import { ROUTE_POINT_S } from '../game/world/path'

fake.state.getClip = getClip

const DT = 1 / 20

function placePlayer(x: number, z: number) {
  runtime.player.pos.set(x, 0, z)
  runtime.player.eye.set(x, 1.6, z)
}

/** Keep the player ~2.2 m behind and beside Seneca. */
function follow() {
  const fx = -Math.sin(seneca.yaw)
  const fz = -Math.cos(seneca.yaw)
  placePlayer(seneca.pos.x - fx * 2.2 - fz * 0.9, seneca.pos.z - fz * 2.2 + fx * 0.9)
}

function step(policy: () => void) {
  policy()
  updateDirector(DT)
  updateSeneca(DT)
  fake.advance(DT)
}

function begin() {
  const s = game()
  s.resetRun()
  s.setOverlay(null)
  s.setPhase('arrival')
  fake.state.played = []
  updateDirector(DT) // reset systems for the new run
  placePlayer(2.9, 30.6) // next to Seneca by the fountain
}

describe('the walk with Seneca', () => {
  beforeEach(() => begin())

  it('runs from greeting to the reflection prompt when the player walks along', () => {
    let t = 0
    while (game().phase !== 'reflection' && t < 900) {
      step(follow)
      t += DT
    }
    const s = game()
    expect(s.phase).toBe('reflection')
    expect(s.reflectionPromptVisible).toBe(true)
    expect(s.narration.heard).toEqual(letterLines.map((l) => l.id))
    expect(seneca.s).toBeGreaterThan(ROUTE_POINT_S[STATIONS.terrace] - 0.5)
    // The letter is read in full, in order, with the authored lines around it.
    const letterPlayed = fake.state.played.filter((id) => id.startsWith('L'))
    expect(letterPlayed).toEqual(letterLines.map((l) => l.id))
    expect(fake.state.played[0]).toBe('A-greet-1')
    expect(fake.state.played).toContain('A-sea')
    expect(fake.state.played).toContain('A-table')
    // A calm pace: several minutes, not a sprint.
    expect(t).toBeGreaterThan(240)
    expect(t).toBeLessThan(600)
  })

  it('waits for a lagging player, pauses the reading when far, and resumes on return', () => {
    // Walk along until the first letter line starts.
    let t = 0
    while (!fake.state.played.includes('L02') && t < 200) {
      step(follow)
      t += DT
    }
    expect(fake.state.clip).toBe('L02')
    // The player wanders 25 m away and stays there.
    const fx = -Math.sin(seneca.yaw)
    const fz = -Math.cos(seneca.yaw)
    const far: [number, number] = [seneca.pos.x - fx * 25, seneca.pos.z - fz * 25]
    for (let i = 0; i < 20 * 20; i++) step(() => placePlayer(far[0], far[1]))
    expect(seneca.speed).toBeLessThan(0.01) // Seneca waits instead of walking away
    expect(fake.audio.voice.state).toBe('paused') // the reading is held, not lost
    expect(game().narration.waitingForPlayer).toBe(true)
    // The player comes back: the reading resumes and the walk completes.
    t = 0
    while (game().phase !== 'reflection' && t < 900) {
      step(follow)
      t += DT
    }
    expect(game().phase).toBe('reflection')
    expect(game().narration.heard).toHaveLength(letterLines.length)
    expect(fake.state.played.some((id) => id.startsWith('A-resume'))).toBe(true)
  })

  it('lets the player pause and continue the reading (Space)', () => {
    let t = 0
    while (!(fake.state.clip === 'L03' && fake.audio.voice.position > 2) && t < 300) {
      step(follow)
      t += DT
    }
    game().toggleNarrationPause()
    for (let i = 0; i < 100; i++) step(follow)
    expect(fake.audio.voice.state).toBe('paused')
    expect(seneca.speed).toBeLessThan(0.05)
    const heldAt = fake.audio.voice.position
    game().toggleNarrationPause()
    for (let i = 0; i < 40; i++) step(follow)
    expect(fake.audio.voice.state).toBe('playing')
    expect(fake.audio.voice.position).toBeGreaterThan(Math.max(0, heldAt - 6))
  })

  it('freezes everything while the pause menu is open', () => {
    let t = 0
    while (!fake.state.played.includes('L01') && t < 200) {
      step(follow)
      t += DT
    }
    const s0 = seneca.s
    game().setOverlay('pause')
    for (let i = 0; i < 200; i++) step(follow)
    expect(fake.audio.voice.state).toBe('paused')
    expect(seneca.s).toBeCloseTo(s0, 3)
    game().setOverlay(null)
    for (let i = 0; i < 20; i++) step(follow)
    expect(fake.audio.voice.state).toBe('playing')
  })

  it('lets Seneca remark on a fruit the player brings him (once)', () => {
    let t = 0
    while (!fake.state.played.includes('L01') && t < 200) {
      step(follow)
      t += DT
    }
    hand.held = fruits[0]
    hand.heldTime = 3
    t = 0
    while (!fake.state.played.includes('A-fruit') && t < 120) {
      step(follow)
      t += DT
    }
    expect(fake.state.played).toContain('A-fruit')
    // The letter is not lost: the walk still completes with every line.
    hand.held = null
    t = 0
    while (game().phase !== 'reflection' && t < 900) {
      step(follow)
      t += DT
    }
    expect(game().narration.heard).toHaveLength(letterLines.length)
    expect(fake.state.played.filter((id) => id === 'A-fruit')).toHaveLength(1)
  })
})
