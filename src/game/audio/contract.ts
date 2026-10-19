/**
 * Audio engine contract. Implemented in ./engine.ts (singleton `audio`).
 * Everything is Web Audio API; no React here.
 *
 * Bus graph:  sources → {voice | ambience | music | sfx} bus → master → limiter → destination
 */

export interface Vec3Like {
  x: number
  y: number
  z: number
}

export type BusName = 'master' | 'voice' | 'ambience' | 'music'

/** Footstep surfaces, plus two small interaction sounds (picking fruit, fruit landing). */
export type Surface = 'stone' | 'gravel' | 'grass' | 'wood' | 'leaves' | 'fruit' | 'drip'

export interface VoiceCueEvent {
  clipId: string
  /** Index of the cue that just became active, or -1 when between cues / ended. */
  cueIndex: number
}

export interface VoicePlayerApi {
  /** Decode and cache clips (by voice-manifest id). Safe to call repeatedly. */
  preload(clipIds: string[]): Promise<void>
  /**
   * Start a clip. `fromCue` starts at that cue's start time (minus a short lead-in).
   * If the clip has no audio file (provider "none"), plays "silently" on a timer so
   * cue/ended events still fire with the manifest timings.
   */
  play(clipId: string, opts?: { fromCue?: number }): void
  /** Fade out quickly (~0.25 s) and hold position. */
  pause(): void
  /** Resume a paused clip from the start of the cue that was active when paused. */
  resume(): void
  /** Fade out and forget the current clip (no ended event). */
  stop(): void
  readonly state: 'idle' | 'playing' | 'paused'
  readonly currentClipId: string | null
  /** Active cue index of the current clip, -1 if none. */
  readonly currentCue: number
  /** Seconds into the current clip. */
  readonly position: number
  /** Per frame: where Seneca's head is (voice emitter). */
  setSourcePosition(p: Vec3Like): void
  /** Subscribe; returns unsubscribe. */
  onCue(cb: (e: VoiceCueEvent) => void): () => void
  onEnded(cb: (clipId: string) => void): () => void
}

export interface AmbienceApi {
  /** World positions of emitters. Call once after the scene layout is known. */
  configure(opts: {
    fountain: Vec3Like
    /** Points along the shoreline below the cliffs (waves). */
    sea: Vec3Like[]
    /** Perches in trees for birds. */
    birdPerches: Vec3Like[]
    /** Centres of olive/cypress groups (leaf rustle, cicadas). */
    foliage: Vec3Like[]
  }): void
  /** 0 = late afternoon (lively birds), 1 = sunset (fewer birds, cicadas/crickets fade in). */
  setTimeOfDay(t: number): void
  /** Optional: overall wind strength 0..1 (defaults to a slow natural variation). */
  setWind(strength: number | null): void
}

export interface MusicApi {
  /** Allow the very quiet ambient music to begin (it fades in by itself, never abruptly). */
  setEnabled(enabled: boolean): void
  /** 0..1 — e.g. lower while Seneca speaks, slightly fuller in silence at the terrace. */
  setIntensity(v: number): void
}

export interface FootstepsApi {
  /** Trigger one footstep (or a small 'leaves' / 'fruit' interaction sound) at a world position. */
  step(p: Vec3Like, surface: Surface, who: 'player' | 'seneca' | 'world', intensity?: number): void
}

/** Ambient-life sounds (src/game/life); see docs/life.md. */
export interface LifeAudioApi {
  /** Beehive positions for the continuous swarm hum. Call once; safe before unlock. */
  configure(opts: { beehives: Vec3Like[] }): void
  /** A soft dove coo at a world position. */
  dove(p: Vec3Like): void
  /** Wing flutter of `n` doves taking off together (default 1). */
  flutter(p: Vec3Like, n?: number): void
  /** A gull cry: distant and very soft, or `near` for a gull passing the terrace. */
  gull(p: Vec3Like, near?: boolean): void
}

export interface AudioEngineApi {
  /** Create/resume the AudioContext. MUST be called from a user gesture. Idempotent. */
  unlock(): Promise<void>
  readonly ready: boolean
  /** 0..1 linear; smoothed. */
  setBusVolume(bus: BusName, v: number): void
  /** Per frame: camera position and orientation. */
  updateListener(position: Vec3Like, forward: Vec3Like, up: Vec3Like): void
  /** Pause menu: soften everything (ambience stays faintly), or restore. */
  setMenuMuffle(on: boolean): void
  /** Stop all scheduled sounds, close the context. */
  dispose(): void
  readonly voice: VoicePlayerApi
  readonly ambience: AmbienceApi
  readonly music: MusicApi
  readonly footsteps: FootstepsApi
  /** Optional (older fakes may omit it): doves, wings, gulls, bees. */
  readonly life?: LifeAudioApi
}
