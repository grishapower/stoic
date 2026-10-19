import { audio } from '../audio/engine'
import { game } from '../store'
import { xr } from './xrState'

/**
 * Entering/leaving the headset. `enterVR` must be called straight from a
 * click handler: the session request has to happen inside the user gesture.
 */

const SESSION_INIT: XRSessionInit = {
  optionalFeatures: ['local-floor', 'bounded-floor', 'hand-tracking', 'layers'],
}

/** Probe support once at startup (shows the «В VR» buttons). */
export async function detectXR() {
  xr.standalone = /OculusBrowser|Quest|Pico|Wolvic/i.test(navigator.userAgent)
  try {
    const ok = !!navigator.xr && (await navigator.xr.isSessionSupported('immersive-vr'))
    xr.supported = ok
    game().setXR({ xrSupported: ok })
  } catch {
    xr.supported = false
  }
}

export async function enterVR(): Promise<boolean> {
  const gl = xr.gl
  if (!gl || !navigator.xr || xr.presenting) return false
  let session: XRSession
  try {
    session = await navigator.xr.requestSession('immersive-vr', SESSION_INIT)
  } catch (err) {
    console.warn('[xr] immersive session refused', err)
    return false
  }
  // Floor-level origin when available; otherwise the head starts at the origin.
  const floor = !session.enabledFeatures || session.enabledFeatures.includes('local-floor')
  xr.floorOffset = floor ? 0 : 1.62
  gl.xr.setReferenceSpaceType(floor ? 'local-floor' : 'local')
  // Quest 3 standalone: a little under native resolution on the light preset; the
  // edges are rendered coarser anyway (fixed foveation, three's default = maximum).
  const light = xr.standalone || game().settings.quality === 'low'
  gl.xr.setFramebufferScaleFactor(light ? 0.9 : 1)
  gl.xr.setFoveation(1)
  try {
    await gl.xr.setSession(session)
  } catch (err) {
    console.warn('[xr] could not start the session', err)
    await session.end().catch(() => {})
    return false
  }
  // Steady 72 Hz on standalone headsets leaves the most headroom per frame.
  const rates = session.supportedFrameRates
  if (light && rates && rates.includes(72) && session.updateTargetFrameRate) {
    await session.updateTargetFrameRate(72).catch(() => {})
  }
  return true
}

export function exitVR() {
  void xr.gl?.xr.getSession()?.end().catch(() => {})
}

/** Title screen → straight into the headset (user gesture required). */
export function beginWalkVR() {
  const entering = enterVR()
  const s = game()
  s.resetRun()
  s.setOverlay(null)
  s.setPhase('arrival')
  audio
    .unlock()
    .then(() => game().setAudioReady(true))
    .catch(() => game().setAudioReady(false))
  return entering
}

/** From the pause menu mid-walk: put the headset on and carry on. */
export function resumeInVR() {
  const entering = enterVR()
  game().setOverlay(null)
  audio.setMenuMuffle(false)
  return entering
}
