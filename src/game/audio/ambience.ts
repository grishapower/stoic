/**
 * Ambience facade (AmbienceApi) + runtime orchestrator.
 *
 * The facade exists from module load and remembers configuration; the runtime
 * is created on unlock and builds its subsystems in stages (so unlock never
 * hitches): birds first, then the wind bed, fountain, trees, sea, insects —
 * the first seconds are birds, wind in the trees and the fountain.
 *
 * Everything is driven by a 10 Hz control tick from the engine (`update`).
 */
import type { SoundBank } from './bank'
import { Birds } from './birds'
import type { AmbienceApi, Vec3Like } from './contract'
import { Foliage } from './foliage'
import { Fountain } from './fountain'
import { Sea } from './sea'
import { copyVec, type ListenerState } from './spatial'
import { clamp } from './synth'
import { WindBed, WindModel } from './wind'

export interface AmbienceConfig {
  fountain: Vec3Like
  sea: Vec3Like[]
  birdPerches: Vec3Like[]
  foliage: Vec3Like[]
}

/** Live subsystems for one AudioContext. */
class AmbienceRuntime {
  readonly wind: WindModel
  private readonly ctx: BaseAudioContext
  private readonly bank: SoundBank
  private readonly out: AudioNode
  private readonly listener: ListenerState
  private bed: WindBed | null = null
  private birds: Birds | null = null
  private fountain: Fountain | null = null
  private foliage: Foliage | null = null
  private sea: Sea | null = null
  private config: AmbienceConfig | null = null
  private tod = 0
  /** Set when the fountain/sea init step has run (their buffers are warm). */
  private fountainStage = false
  private seaStage = false

  constructor(ctx: BaseAudioContext, bank: SoundBank, out: AudioNode, listener: ListenerState) {
    this.ctx = ctx
    this.bank = bank
    this.out = out
    this.listener = listener
    this.wind = new WindModel(ctx.currentTime)
  }

  /** Init steps, cheapest and most important first; each buffer renders in its own step. */
  stages(): (() => void)[] {
    const bank = this.bank
    return [
      () => {
        this.birds = new Birds(this.ctx, this.out, this.listener)
        this.birds.setTimeOfDay(this.tod)
        if (this.config) this.birds.setPerches(this.config.birdPerches, this.listener)
      },
      ...bank.warm(['brownA', 'brownB', 'pinkA', 'pinkB']),
      () => {
        this.bed = new WindBed(this.ctx, this.bank, this.out)
      },
      ...bank.warm(['white', 'flutter', 'waterA', 'waterB']),
      () => {
        this.fountainStage = true
        if (this.config && !this.fountain) this.fountain = new Fountain(this.ctx, this.bank, this.out, this.config.fountain)
      },
      ...bank.warm(['rustleA', 'rustleB']),
      () => {
        this.foliage = new Foliage(this.ctx, this.bank, this.out)
        this.foliage.setTimeOfDay(this.tod)
        if (this.config) this.foliage.setPoints(this.config.foliage)
      },
      () => {
        this.seaStage = true
        if (this.config && this.config.sea.length > 0 && !this.sea) this.sea = new Sea(this.ctx, this.bank, this.out, this.config.sea)
      },
      ...bank.warm(['cricket', 'cicada']),
      () => {
        this.foliage?.enableInsects()
      },
    ]
  }

  applyConfig(cfg: AmbienceConfig): void {
    this.config = cfg
    this.birds?.setPerches(cfg.birdPerches, this.listener)
    this.foliage?.setPoints(cfg.foliage)
    // Before their init step runs, the stage itself picks up the config.
    if (this.fountain) this.fountain.setPosition(cfg.fountain)
    else if (this.fountainStage) this.fountain = new Fountain(this.ctx, this.bank, this.out, cfg.fountain)
    if (this.sea) this.sea.setPoints(cfg.sea)
    else if (this.seaStage && cfg.sea.length > 0) this.sea = new Sea(this.ctx, this.bank, this.out, cfg.sea)
  }

  setTimeOfDay(t: number): void {
    this.tod = t
    this.wind.setTimeOfDay(t)
    this.birds?.setTimeOfDay(t)
    this.foliage?.setTimeOfDay(t)
  }

  update(now: number): void {
    const w = this.wind.update(now)
    this.bed?.update(w, now)
    this.birds?.update(now, this.listener)
    this.fountain?.update(now, this.listener)
    this.foliage?.update(now, w, this.listener)
    this.sea?.update(now, this.listener)
  }

  dispose(): void {
    this.bed?.dispose()
    this.birds?.dispose()
    this.fountain?.dispose()
    this.foliage?.dispose()
    this.sea?.dispose()
    this.bed = null
    this.birds = null
    this.fountain = null
    this.foliage = null
    this.sea = null
  }
}

export class Ambience implements AmbienceApi {
  private config: AmbienceConfig | null = null
  private tod = 0
  private windOverride: number | null = null
  private rt: AmbienceRuntime | null = null

  configure(opts: AmbienceConfig): void {
    try {
      const cfg: AmbienceConfig = {
        fountain: copyVec(opts.fountain),
        sea: (opts.sea ?? []).map(copyVec),
        birdPerches: (opts.birdPerches ?? []).map(copyVec),
        foliage: (opts.foliage ?? []).map(copyVec),
      }
      this.config = cfg
      this.rt?.applyConfig(cfg)
    } catch {
      /* malformed input: keep previous config */
    }
  }

  setTimeOfDay(t: number): void {
    if (!Number.isFinite(t)) return
    this.tod = clamp(t, 0, 1)
    this.rt?.setTimeOfDay(this.tod)
  }

  setWind(strength: number | null): void {
    this.windOverride = strength === null || !Number.isFinite(strength) ? null : clamp(strength, 0, 1)
    this.rt?.wind.setOverride(this.windOverride)
  }

  /* ------------------------------------------------ engine wiring */

  /** Build the runtime; returns staged init steps for the engine to run over a few ticks. */
  attach(ctx: BaseAudioContext, bank: SoundBank, out: AudioNode, listener: ListenerState): (() => void)[] {
    this.detach()
    const rt = new AmbienceRuntime(ctx, bank, out, listener)
    this.rt = rt
    rt.wind.setOverride(this.windOverride)
    rt.setTimeOfDay(this.tod)
    if (this.config) rt.applyConfig(this.config)
    return rt.stages()
  }

  detach(): void {
    this.rt?.dispose()
    this.rt = null
  }

  update(now: number): void {
    this.rt?.update(now)
  }
}
