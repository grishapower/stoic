import { CanvasTexture, LinearFilter, NoColorSpace } from 'three'
import { FOUNTAIN_BASIN, FOUNTAIN_PATH, GARDEN_PATH_HALF, GARDEN_RECT } from '../world/architecture'
import { PATH_HALF_WIDTH } from '../world/layout'
import { pathSamples } from '../world/path'
import { CYPRESSES, OLIVES, PINES } from '../world/vegetation'

/**
 * Top-down splat mask for the terrain shader, painted on a canvas.
 *   R — gravel path, G — garden soil/turf, B — darkening under trees (fake AO).
 */
export const MASK_MIN_X = -70
export const MASK_MIN_Z = -84
export const MASK_SIZE = 144
const RES = 1024

export function createGroundMask(): CanvasTexture {
  const c = document.createElement('canvas')
  c.width = RES
  c.height = RES
  const g = c.getContext('2d')!
  g.fillStyle = '#000'
  g.fillRect(0, 0, RES, RES)
  const k = RES / MASK_SIZE
  const X = (x: number) => (x - MASK_MIN_X) * k
  const Z = (z: number) => (z - MASK_MIN_Z) * k
  g.globalCompositeOperation = 'lighter'

  // Path (R). Slightly irregular width, soft edges.
  const { x, z, count } = pathSamples()
  g.save()
  g.filter = 'blur(2px)'
  g.strokeStyle = 'rgb(255,0,0)'
  g.lineCap = 'round'
  g.lineJoin = 'round'
  g.lineWidth = PATH_HALF_WIDTH * 2 * k
  g.beginPath()
  g.moveTo(X(x[0]), Z(z[0]))
  for (let i = 1; i < count; i++) g.lineTo(X(x[i]), Z(z[i]))
  g.stroke()
  // Worn shoulder.
  g.globalAlpha = 0.35
  g.lineWidth = (PATH_HALF_WIDTH * 2 + 1.2) * k
  g.stroke()
  g.restore()

  // Garden beds (G) inside the peristyle, and gravel cross paths (R).
  g.save()
  g.fillStyle = 'rgb(0,255,0)'
  g.fillRect(X(GARDEN_RECT.minX), Z(GARDEN_RECT.minZ), (GARDEN_RECT.maxX - GARDEN_RECT.minX) * k, (GARDEN_RECT.maxZ - GARDEN_RECT.minZ) * k)
  g.restore()
  g.save()
  g.filter = 'blur(1px)'
  g.fillStyle = 'rgb(255,0,0)'
  const hw = GARDEN_PATH_HALF
  g.fillRect(X(-hw), Z(GARDEN_RECT.minZ), 2 * hw * k, (GARDEN_RECT.maxZ - GARDEN_RECT.minZ) * k)
  g.fillRect(X(GARDEN_RECT.minX), Z(FOUNTAIN_BASIN.z - hw), (GARDEN_RECT.maxX - GARDEN_RECT.minX) * k, 2 * hw * k)
  g.beginPath()
  g.arc(X(FOUNTAIN_BASIN.x), Z(FOUNTAIN_BASIN.z), FOUNTAIN_PATH.outer * k, 0, Math.PI * 2)
  g.fill()
  g.restore()

  // Tree shade (B).
  g.save()
  g.filter = 'blur(6px)'
  const blob = (tx: number, tz: number, r: number, a: number) => {
    g.fillStyle = `rgba(0,0,255,${a})`
    g.beginPath()
    g.arc(X(tx), Z(tz), r * k, 0, Math.PI * 2)
    g.fill()
  }
  for (const t of OLIVES) blob(t.x, t.z, 2.6 * t.scale, 0.55)
  for (const t of PINES) blob(t.x, t.z, 3.2 * t.scale, 0.45)
  for (const t of CYPRESSES) blob(t.x, t.z, 1.0 * t.scale, 0.5)
  g.restore()

  const tex = new CanvasTexture(c)
  tex.colorSpace = NoColorSpace
  tex.minFilter = LinearFilter
  tex.generateMipmaps = false
  tex.flipY = false
  return tex
}
