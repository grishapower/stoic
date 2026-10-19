/**
 * Lazily rendered, shared procedural buffers. Each getter renders on first use
 * (a few ms each), so the engine can spread the work over several ticks.
 * Loop lengths are deliberately non-commensurate so layered loops never line up.
 */
import { cicadaBuffer, cricketBuffer, grainBuffer, noiseBuffer, smoothRandomBuffer, waterBuffer, type BufferTarget } from './synth'

/**
 * Procedural textures are rendered at this rate (all their content is below
 * 12 kHz) — half the work, and the browser resamples on playback.
 */
const BANK_RATE = 24000

export type BankKey =
  | 'white'
  | 'pinkA'
  | 'pinkB'
  | 'brownA'
  | 'brownB'
  | 'flutter'
  | 'waterA'
  | 'waterB'
  | 'rustleA'
  | 'rustleB'
  | 'crunch'
  | 'cricket'
  | 'cicada'

export class SoundBank {
  private readonly ctx: BufferTarget
  private readonly cache = new Map<string, AudioBuffer>()

  constructor(ctx: BaseAudioContext) {
    const rate = Math.min(ctx.sampleRate, BANK_RATE)
    this.ctx = {
      sampleRate: rate,
      createBuffer: (n, len, sr) => ctx.createBuffer(n, len, sr),
    }
  }

  /** One init step per buffer, so the engine can spread rendering over several ticks. */
  warm(keys: readonly BankKey[]): (() => void)[] {
    return keys.map((k) => () => void this[k])
  }

  private get(key: string, make: () => AudioBuffer): AudioBuffer {
    let b = this.cache.get(key)
    if (!b) {
      b = make()
      this.cache.set(key, b)
    }
    return b
  }

  get white(): AudioBuffer {
    return this.get('white', () => noiseBuffer(this.ctx, 'white', 3.1, 101))
  }
  get pinkA(): AudioBuffer {
    return this.get('pinkA', () => noiseBuffer(this.ctx, 'pink', 7.3, 202))
  }
  get pinkB(): AudioBuffer {
    return this.get('pinkB', () => noiseBuffer(this.ctx, 'pink', 6.1, 303))
  }
  get brownA(): AudioBuffer {
    return this.get('brownA', () => noiseBuffer(this.ctx, 'brown', 9.7, 404))
  }
  get brownB(): AudioBuffer {
    return this.get('brownB', () => noiseBuffer(this.ctx, 'brown', 8.3, 505))
  }
  /** Smooth random −1..1 at ~14 Hz: fast flutter for water. */
  get flutter(): AudioBuffer {
    return this.get('flutter', () => smoothRandomBuffer(this.ctx, 5.3, 14, 606))
  }
  get waterA(): AudioBuffer {
    return this.get('waterA', () => waterBuffer(this.ctx, { seconds: 7.1, rate: 70, fMin: 450, fMax: 2600, seed: 707 }))
  }
  get waterB(): AudioBuffer {
    return this.get('waterB', () => waterBuffer(this.ctx, { seconds: 5.3, rate: 45, fMin: 700, fMax: 3400, seed: 808 }))
  }
  /** Leaf rustle: fine crackle grains with gusty clustering. */
  get rustleA(): AudioBuffer {
    return this.get('rustleA', () => grainBuffer(this.ctx, rustleOpts(6.7, 909)))
  }
  get rustleB(): AudioBuffer {
    return this.get('rustleB', () => grainBuffer(this.ctx, rustleOpts(5.3, 1010)))
  }
  /** Gravel crunch: dense coarse grains and pebble clicks (footsteps slice it). */
  get crunch(): AudioBuffer {
    return this.get('crunch', () =>
      grainBuffer(this.ctx, {
        seconds: 1.7,
        rate: 2600,
        minLen: 0.0004,
        maxLen: 0.004,
        ampPower: 2,
        clusterMin: 0.02,
        clusterMax: 0.08,
        clickChance: 0.25,
        clickFMin: 1500,
        clickFMax: 5200,
        hiss: 0.2,
        seed: 1111,
      }),
    )
  }
  get cricket(): AudioBuffer {
    return this.get('cricket', () => cricketBuffer(this.ctx, 1212))
  }
  get cicada(): AudioBuffer {
    return this.get('cicada', () => cicadaBuffer(this.ctx, 1313))
  }
}

function rustleOpts(seconds: number, seed: number) {
  return {
    seconds,
    rate: 900,
    minLen: 0.0004,
    maxLen: 0.0025,
    ampPower: 3,
    clusterMin: 0.04,
    clusterMax: 0.22,
    clickChance: 0.08,
    clickFMin: 2500,
    clickFMax: 6000,
    hiss: 0.6,
    seed,
  }
}
