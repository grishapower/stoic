import { getClip, getLine, letterLines, voiceManifest } from '../../data/narration'
import { audio } from '../audio/engine'
import { resetSeneca, seneca, setSenecaMode, triggerGesture } from '../characters/senecaController'
import { input } from '../input/input'
import { hand, resetHand } from '../interaction/hand'
import { resetFruits } from '../interaction/fruits'
import { unlockPointer } from '../input/pointerLock'
import { playerNearBench, resetPlayer, sitOnBench } from '../player/player'
import { runtime } from '../runtime'
import { openOverlay } from '../session'
import { game, type Phase } from '../store'
import { PERGOLA, STATIONS } from '../world/layout'
import { PATH_LENGTH, ROUTE_POINT_S } from '../world/path'
import { SEQUENCE, type Step } from './sequence'

/**
 * Narrative director — sequences Seneca's lines independently of animation.
 * Keeps in sync: current line & subtitle cue, audio, Seneca's route allowance
 * and walking speed, gestures/look, and the player's position (waits, pauses).
 */

const START_DIST = 8.5 // a new line starts only if the player is this close
const AUTO_PAUSE_DIST = 17 // mid-line: hold the reading if the player wanders off
const RESUME_DIST = 9
const GREET_DIST = 4.6

type LineState = 'none' | 'playing' | 'post'

const d = {
  runId: -1,
  active: false,
  index: 0,
  stepTime: 0,
  lineState: 'none' as LineState,
  line: null as string | null,
  post: 0,
  // pauses
  menuPaused: false,
  userPausedVoice: false,
  autoPaused: false,
  autoPauseTime: 0,
  nearTime: 0,
  // interjections (waiting lines, "so…" resumes)
  interjecting: null as string | null,
  resumeAfter: null as null | { id: string; cue: number },
  waitLinesPlayed: 0,
  // misc
  lookAtSenecaTime: 0,
  freeTime: 0,
  farewellDone: false,
  fruitLineDone: false,
  prevPhase: 'title' as Phase,
  musicOn: false,
  installed: false,
}

function install() {
  if (d.installed) return
  d.installed = true
  game().setVoicePlaceholder(voiceManifest.placeholder || voiceManifest.provider !== 'elevenlabs')
  audio.voice.onCue(({ clipId, cueIndex }) => {
    const clip = getClip(clipId)
    const cue = cueIndex >= 0 ? clip.cues[cueIndex] : null
    game().setNarration({ lineId: clipId, cueIndex, cueText: cue ? cue.text : null })
    if (cue && cueIndex > 0 && clipId === d.line) {
      // Small gesture accents on new phrases.
      const line = getLine(clipId)
      if (line.gesture !== 'none' && Math.random() < 0.55) triggerGesture(line.gesture, 0.6 + Math.random() * 0.3)
    }
  })
  audio.voice.onEnded((clipId) => {
    game().setNarration({ cueText: null, cueIndex: -1 })
    if (d.interjecting === clipId) {
      d.interjecting = null
      seneca.talking = false
      if (d.resumeAfter) {
        const r = d.resumeAfter
        d.resumeAfter = null
        seneca.talking = true
        audio.voice.play(r.id, { fromCue: r.cue })
      }
      return
    }
    if (clipId === d.line && d.lineState === 'playing') {
      const line = getLine(clipId)
      if (line.kind === 'letter') game().markHeard(clipId)
      d.lineState = 'post'
      d.post = line.postPause
      seneca.talking = false
    }
  })
}

function reset() {
  audio.voice.stop()
  resetSeneca()
  resetPlayer()
  d.active = false
  d.index = 0
  d.stepTime = 0
  d.lineState = 'none'
  d.line = null
  d.menuPaused = d.userPausedVoice = d.autoPaused = false
  d.interjecting = null
  d.resumeAfter = null
  d.waitLinesPlayed = 0
  d.lookAtSenecaTime = 0
  d.freeTime = 0
  d.farewellDone = false
  d.fruitLineDone = false
  d.musicOn = false
  audio.music.setEnabled(false)
  resetFruits()
  resetHand()
  input.clear()
}

function playerDist() {
  const p = runtime.player.pos
  return Math.hypot(p.x - seneca.pos.x, p.z - seneca.pos.z)
}

function stationS(id: keyof typeof STATIONS) {
  return ROUTE_POINT_S[STATIONS[id]]
}

function startLine(id: string) {
  const line = getLine(id)
  d.line = id
  d.lineState = 'playing'
  seneca.talking = true
  seneca.look = line.look
  seneca.holdingScroll = line.kind === 'letter' || line.gesture.startsWith('scroll')
  triggerGesture(line.gesture, 1)
  audio.voice.play(id)
  game().setNarration({ lineId: id })
  if (line.kind === 'letter' && !game().seenHints['narration-pause']) {
    game().showHint('narration-pause', 'Пробел — пауза чтения · T — субтитры')
  }
}

function playInterjection(id: string, resume?: { id: string; cue: number }) {
  d.interjecting = id
  d.resumeAfter = resume ?? null
  seneca.talking = true
  const line = getLine(id)
  triggerGesture(line.gesture, 0.7)
  audio.voice.play(id)
}

/** Remaining speech time until the next movement step (for walking-speed sync). */
function remainingSpeech(): number {
  let t = 0
  if (d.lineState === 'playing' && d.line) t += Math.max(0, getClip(d.line).duration - audio.voice.position) + getLine(d.line).postPause
  else if (d.lineState === 'post') t += Math.max(0, d.post)
  for (let i = d.index + (d.lineState === 'none' ? 0 : 1); i < SEQUENCE.length; i++) {
    const s = SEQUENCE[i]
    if (s.t === 'allow' || s.t === 'arrive') break
    if (s.t === 'line') t += getClip(s.id).duration + getLine(s.id).postPause
    if (s.t === 'pause') t += s.seconds
  }
  return t
}

function executeSteps(dt: number, canProgress: boolean) {
  let guard = 0
  while (d.index < SEQUENCE.length && guard++ < 20) {
    const step: Step = SEQUENCE[d.index]
    if (d.interjecting) return
    switch (step.t) {
      case 'phase':
        enterPhase(step.phase)
        d.index++
        continue
      case 'mode':
        setSenecaMode(step.mode)
        seneca.facePlayer = step.mode === 'greeting'
        d.index++
        continue
      case 'music':
        d.musicOn = step.on
        audio.music.setEnabled(step.on && game().settings.musicEnabled)
        d.index++
        continue
      case 'allow':
        seneca.allowance = stationS(step.station)
        d.index++
        continue
      case 'arrive':
        if (seneca.s >= stationS(step.station) - 0.3) {
          d.index++
          continue
        }
        return
      case 'pause':
        if (canProgress) d.stepTime += dt
        if (d.stepTime >= step.seconds) {
          d.stepTime = 0
          d.index++
          continue
        }
        return
      case 'line': {
        if (d.lineState === 'none') {
          const greeting = step.id.startsWith('A-greet')
          if (canProgress && playerDist() < (greeting ? 7 : START_DIST)) startLine(step.id)
          return
        }
        if (d.lineState === 'playing') return
        if (d.lineState === 'post') {
          if (canProgress) d.post -= dt
          if (d.post <= 0) {
            d.lineState = 'none'
            d.line = null
            d.index++
            continue
          }
          return
        }
        return
      }
    }
  }
}

function enterPhase(phase: Phase) {
  const s = game()
  s.setPhase(phase)
  if (phase === 'walk') seneca.facePlayer = false
  if (phase === 'reflection') {
    s.setReflectionPromptVisible(true)
    unlockPointer()
  }
}

/** Per-frame update. */
export function updateDirector(dt: number) {
  install()
  const s = game()

  if (s.runId !== d.runId) {
    d.runId = s.runId
    reset()
  }
  if (s.phase === 'title') {
    if (d.prevPhase !== 'title') reset()
    d.prevPhase = 'title'
    return
  }

  // Phase transitions triggered from the UI.
  if (s.phase !== d.prevPhase) {
    if (s.phase === 'ending' && !d.farewellDone && playerDist() < 22 && !d.interjecting) {
      d.farewellDone = true
      audio.voice.stop()
      playInterjection('A-farewell')
    }
    if (s.phase === 'free' || s.phase === 'ending') {
      setSenecaMode('contemplating')
      s.setProgress(Math.max(1, s.progress))
    }
    d.prevPhase = s.phase
  }

  /* ---------------- Menus freeze the walk */
  const menuOpen = s.overlay === 'pause' || s.overlay === 'letter' || s.overlay === 'journal'
  if (menuOpen) {
    if (audio.voice.state === 'playing') {
      audio.voice.pause()
      d.menuPaused = true
    }
    seneca.frozen = true
    return
  }
  seneca.frozen = false
  if (d.menuPaused) {
    d.menuPaused = false
    if (!s.narration.userPaused && !d.autoPaused && audio.voice.state === 'paused') audio.voice.resume()
  }

  /* ---------------- Player-initiated pause (Space) */
  if (s.narration.userPaused) {
    if (audio.voice.state === 'playing') {
      audio.voice.pause()
      d.userPausedVoice = true
    }
    seneca.facePlayer = true
    seneca.talking = false
  } else if (d.userPausedVoice) {
    d.userPausedVoice = false
    seneca.facePlayer = s.phase === 'greeting'
    if (audio.voice.state === 'paused' && !d.autoPaused) {
      seneca.talking = true
      audio.voice.resume()
    }
  } else if (s.phase !== 'greeting' && s.phase !== 'arrival') {
    seneca.facePlayer = false
  }

  const dist = playerDist()

  /* ---------------- Arrival: wait for the player to approach */
  if (s.phase === 'arrival') {
    if (!s.seenHints.move) s.showHint('move', 'WASD — идти · мышь — осмотреться')
    if (runtime.player.speed > 0.3) s.clearHint('move')
    // Looking at Seneca from mid distance also counts as approaching.
    const p = runtime.player
    const toS = Math.atan2(-(seneca.pos.x - p.pos.x), -(seneca.pos.z - p.pos.z))
    const facing = Math.abs(Math.atan2(Math.sin(toS - p.yaw), Math.cos(toS - p.yaw))) < 0.35
    d.lookAtSenecaTime = facing && dist < 8 ? d.lookAtSenecaTime + dt : 0
    if (dist < GREET_DIST || d.lookAtSenecaTime > 2.2) {
      d.active = true
      d.index = 0
    } else {
      updateCommon(dt, dist)
      return
    }
  }

  /* ---------------- Auto-pause when the player wanders far away */
  if (audio.voice.state === 'playing' && !d.interjecting && dist > AUTO_PAUSE_DIST) {
    audio.voice.pause()
    d.autoPaused = true
    d.autoPauseTime = 0
    seneca.talking = false
  }
  if (d.autoPaused) {
    d.autoPauseTime += dt
    d.nearTime = dist < RESUME_DIST ? d.nearTime + dt : 0
    s.setNarration({ waitingForPlayer: true })
    if (d.nearTime > 1.1 && !s.narration.userPaused) {
      d.autoPaused = false
      s.setNarration({ waitingForPlayer: false })
      if (d.autoPauseTime > 6 && d.line) {
        // "So…" — then pick up from the cue that was interrupted.
        const cue = Math.max(0, audio.voice.currentCue)
        const id = d.line
        audio.voice.stop()
        playInterjection(Math.random() < 0.5 ? 'A-resume-1' : 'A-resume-2', { id, cue })
      } else {
        seneca.talking = true
        audio.voice.resume()
      }
    }
  } else if (s.narration.waitingForPlayer !== seneca.waitingForPlayer) {
    s.setNarration({ waitingForPlayer: seneca.waitingForPlayer })
  }

  /* ---------------- Gentle "take your time" lines while waiting */
  const walkingPhase = s.phase === 'walk' || s.phase === 'terrace'
  if (
    walkingPhase &&
    seneca.waitTime > 14 &&
    d.lineState !== 'playing' &&
    !d.interjecting &&
    !d.autoPaused &&
    audio.voice.state === 'idle' &&
    d.waitLinesPlayed < 2 &&
    dist < 22
  ) {
    playInterjection(d.waitLinesPlayed === 0 ? 'A-wait-1' : 'A-wait-2')
    d.waitLinesPlayed++
    seneca.waitTime = -30
  }

  /* ---------------- A remark when the player brings him a fruit */
  if (
    !d.fruitLineDone &&
    hand.held &&
    hand.heldTime > 2 &&
    dist < 4.5 &&
    s.phase !== 'arrival' &&
    s.phase !== 'greeting' &&
    d.lineState !== 'playing' &&
    !d.interjecting &&
    !d.autoPaused &&
    audio.voice.state === 'idle'
  ) {
    d.fruitLineDone = true
    playInterjection('A-fruit')
  }

  /* ---------------- Run the sequence */
  const canProgress = !s.narration.userPaused && !d.autoPaused && dist < 14
  if (d.active) executeSteps(dt, canProgress)

  // Walking speed in sync with the remaining text of this section.
  const remainDist = seneca.allowance - seneca.s
  if (remainDist > 0.2) {
    const t = remainingSpeech()
    seneca.desiredSpeed = t > 1 ? Math.min(0.92, Math.max(0.42, remainDist / t)) : 0.78
  }

  updateCommon(dt, dist)
}

function updateCommon(dt: number, dist: number) {
  const s = game()
  // Sun progress: letter lines heard + distance walked.
  const heard = s.narration.heard.length / letterLines.length
  let progress = Math.max(heard, (seneca.s / PATH_LENGTH) * 0.95)
  if (s.phase === 'silence' || s.phase === 'reflection' || s.phase === 'ending' || s.phase === 'free') {
    d.freeTime += dt
    progress = 1 + d.freeTime / 140
  }
  s.setProgress(Math.max(s.progress, progress))
  audio.ambience.setTimeOfDay(Math.min(1, s.progress))

  // Music: quieter under speech, a little fuller in silence.
  audio.music.setIntensity(seneca.talking ? 0.3 : s.phase === 'reflection' || s.phase === 'free' ? 0.85 : 0.6)
  if (d.musicOn) audio.music.setEnabled(s.settings.musicEnabled)

  // Interactions (E).
  const p = runtime.player.pos
  const nearTable = Math.hypot(p.x - PERGOLA.table.x, p.z - PERGOLA.table.z) < 2.3
  const nearBench = playerNearBench()
  let prompt: string | null = null
  if (s.playerSeated) prompt = null
  else if (nearTable) prompt = 'E — перечитать письмо'
  else if (nearBench) prompt = 'E — присесть'
  // The hand (fruit) prompt wins over places (table/bench).
  s.setInteractPrompt(s.overlay ? null : (hand.prompt ?? prompt))
  if (input.consumeInteract() && !s.overlay) {
    if (nearTable) openOverlay('letter')
    else if (nearBench && !s.playerSeated) sitOnBench()
  }
  if (s.playerSeated && !s.seenHints.sit) s.showHint('sit', 'Чтобы встать — просто начните идти')
  void dist
}

/**
 * Dev helper: jump to a step of the sequence (state reconstructed from the
 * steps before it). Used for testing later scenes without walking there.
 */
export function debugJump(stepIndex: number) {
  const s = game()
  audio.voice.stop()
  d.active = true
  d.lineState = 'none'
  d.line = null
  d.interjecting = null
  d.resumeAfter = null
  d.stepTime = 0
  let allowance = 0
  let prevAllowance = 0
  let lastArrive = 0
  let phase: Phase = 'arrival'
  for (let i = 0; i < stepIndex && i < SEQUENCE.length; i++) {
    const st = SEQUENCE[i]
    if (st.t === 'allow') {
      prevAllowance = allowance
      allowance = stationS(st.station)
    }
    if (st.t === 'arrive') lastArrive = stationS(st.station)
    if (st.t === 'phase') phase = st.phase
    if (st.t === 'mode') setSenecaMode(st.mode)
    if (st.t === 'line' && getLine(st.id).kind === 'letter') s.markHeard(st.id)
    if (st.t === 'music') d.musicOn = st.on
  }
  seneca.allowance = allowance
  seneca.s = Math.max(lastArrive, prevAllowance)
  s.setPhase(phase)
  d.prevPhase = phase
  d.index = stepIndex
}
