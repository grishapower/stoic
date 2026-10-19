import { CanvasTexture, DoubleSide, MeshStandardMaterial, SRGBColorSpace, Vector4 } from 'three'
import type { WingRig } from './geometry'

/**
 * Lit material for the creatures: MeshStandardMaterial (vertex colours ×
 * instance colour) with a vertex-shader patch that animates, per instance:
 *   - wings: flap about a hinge parallel to the body (with an elbow lag),
 *     a dihedral bias and a fold that sweeps them back along the body;
 *   - the head: yaw and pitch (look around, peck, coo bow);
 *   - the spine: a travelling lateral wave (lizard run).
 * Normals are rotated with the geometry, so lighting stays correct.
 */

const LIFE_PARS = /* glsl */ `
attribute vec4 aPart;
attribute vec4 aAnim;
attribute vec4 aAnim2;
uniform vec4 uWing;
uniform vec4 uHead;
uniform float uSpineK;
#ifdef LIFE_ATLAS
attribute float aAtlas;
#endif

vec2 lifeRot(vec2 v, float a) {
  float c = cos(a);
  float s = sin(a);
  return vec2(v.x * c - v.y * s, v.x * s + v.y * c);
}

void lifeDeform(inout vec3 p, inout vec3 n) {
  float w = aPart.x;
  if (w != 0.0) {
    float sd = sign(w);
    float span = abs(w);
    float fold = aAnim.w;
    vec3 sh = vec3(sd * uWing.x, uWing.y, 0.0);
    vec3 q = p - sh;
    // Folded wings are tucked in (shorter span).
    q.x *= 1.0 - 0.35 * fold;
    // Elbow: the outer wing bends with a lag behind the stroke.
    if (span > uWing.w + 0.001) {
      vec2 e = vec2(sd * (uWing.z - uWing.x) * (1.0 - 0.35 * fold), 0.0);
      float ang = sd * aAnim.y * 0.45 * sin(aAnim.x - 1.1);
      q.xy = lifeRot(q.xy - e, ang) + e;
      n.xy = lifeRot(n.xy, ang);
    }
    // Shoulder flap around the body axis (+ dihedral bias).
    float th = sd * (aAnim.z + aAnim.y * sin(aAnim.x));
    q.xy = lifeRot(q.xy, th);
    n.xy = lifeRot(n.xy, th);
    // Fold: sweep the wing back along the flank (rotation about Y).
    float fa = sd * fold * 1.3;
    float fc = cos(fa);
    float fs = sin(fa);
    q.xz = vec2(q.x * fc + q.z * fs, -q.x * fs + q.z * fc);
    n.xz = vec2(n.x * fc + n.z * fs, -n.x * fs + n.z * fc);
    p = q + sh;
  }
  float hw = aPart.y;
  if (hw > 0.0) {
    vec3 pv = vec3(0.0, uHead.x, uHead.y);
    vec3 q = p - pv;
    float a = aAnim2.y * hw; // pitch: positive nods down
    float c = cos(a);
    float s = sin(a);
    q.yz = vec2(q.y * c - q.z * s, q.y * s + q.z * c);
    n.yz = vec2(n.y * c - n.z * s, n.y * s + n.z * c);
    float b = aAnim2.x * hw; // yaw
    c = cos(b);
    s = sin(b);
    q.xz = vec2(q.x * c + q.z * s, -q.x * s + q.z * c);
    n.xz = vec2(n.x * c + n.z * s, -n.x * s + n.z * c);
    p = q + pv;
  }
  float sp = aPart.z;
  if (sp > 0.0) p.x += aAnim2.w * sin(aAnim2.z - sp * uSpineK) * (0.3 + sp);
}
`

export interface LifeMaterialOptions {
  rig: WingRig
  /** Spine wave number (lizard). */
  spineK?: number
  /** Texture atlas (butterflies): cells along U, selected by the instance's aAtlas. */
  atlas?: { texture: CanvasTexture; cells: number }
  roughness?: number
}

export function createLifeMaterial(o: LifeMaterialOptions): MeshStandardMaterial {
  const m = new MeshStandardMaterial({
    vertexColors: true,
    roughness: o.roughness ?? 0.85,
    metalness: 0,
    side: DoubleSide,
  })
  if (o.atlas) {
    m.map = o.atlas.texture
    m.alphaTest = 0.5
    m.alphaToCoverage = true
    m.defines = { ...(m.defines ?? {}), LIFE_ATLAS: '', LIFE_CELLS: o.atlas.cells.toFixed(1) }
  }
  const uWing = { value: new Vector4(o.rig.hingeX, o.rig.hingeY, o.rig.elbowX, o.rig.elbowSpan) }
  const uHead = { value: new Vector4(o.rig.headY, o.rig.headZ, 0, 0) }
  const uSpineK = { value: o.spineK ?? 6 }
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uWing = uWing
    shader.uniforms.uHead = uHead
    shader.uniforms.uSpineK = uSpineK
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${LIFE_PARS}`)
      .replace('#include <beginnormal_vertex>', '#include <beginnormal_vertex>\nvec3 lifeP = position;\nlifeDeform(lifeP, objectNormal);')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\ntransformed = lifeP;')
      .replace(
        '#include <uv_vertex>',
        `#include <uv_vertex>
#if defined(LIFE_ATLAS) && defined(USE_MAP)
  vMapUv.x = (vMapUv.x + aAtlas) / LIFE_CELLS;
#endif`,
      )
  }
  m.customProgramCacheKey = () => `life-v1${o.atlas ? '-atlas' : ''}`
  return m
}

/**
 * Butterfly wing atlas: one cell per species (see BUTTERFLY_SPECIES), drawn as
 * the right wing pair with u = 0 at the body and v = 1 at the front edge. The
 * bottom-left corner of every cell is opaque dark brown for the body.
 */
export function createButterflyAtlas(cells = 4): CanvasTexture {
  const S = 128
  const c = document.createElement('canvas')
  c.width = S * cells
  c.height = S
  const g = c.getContext('2d')!
  g.clearRect(0, 0, c.width, c.height)
  for (let k = 0; k < cells; k++) {
    const ox = k * S
    // Cell coordinates: u (0 body → 1 tip), v (0 rear → 1 front) → canvas px.
    const X = (u: number) => ox + u * S
    const Y = (v: number) => (1 - v) * S
    const fore = () => {
      g.beginPath()
      g.moveTo(X(0.02), Y(0.55))
      g.bezierCurveTo(X(0.2), Y(0.98), X(0.7), Y(1.0), X(0.97), Y(0.94))
      g.bezierCurveTo(X(1.0), Y(0.75), X(0.9), Y(0.55), X(0.72), Y(0.46))
      g.bezierCurveTo(X(0.5), Y(0.42), X(0.2), Y(0.45), X(0.02), Y(0.5))
      g.closePath()
    }
    const hind = (tail: boolean) => {
      g.beginPath()
      g.moveTo(X(0.02), Y(0.5))
      g.bezierCurveTo(X(0.3), Y(0.52), X(0.68), Y(0.45), X(0.66), Y(0.25))
      if (tail) {
        g.lineTo(X(0.6), Y(0.14))
        g.lineTo(X(0.52), Y(0.02))
        g.lineTo(X(0.46), Y(0.12))
      }
      g.bezierCurveTo(X(0.4), Y(0.05), X(0.15), Y(0.1), X(0.02), Y(0.35))
      g.closePath()
    }
    const dot = (u: number, v: number, r: number, col: string) => {
      g.fillStyle = col
      g.beginPath()
      g.arc(X(u), Y(v), r, 0, Math.PI * 2)
      g.fill()
    }
    g.save()
    switch (k) {
      case 0: {
        // Cabbage white: cream wings, grey-black apex, one black spot.
        g.fillStyle = '#f3efe2'
        fore()
        g.fill()
        hind(false)
        g.fillStyle = '#ece5c8'
        g.fill()
        g.save()
        fore()
        g.clip()
        g.fillStyle = '#3a3836'
        g.beginPath()
        g.ellipse(X(0.95), Y(0.95), 0.28 * S, 0.14 * S, 0.3, 0, Math.PI * 2)
        g.fill()
        g.restore()
        dot(0.58, 0.68, 0.045 * S, '#2c2a28')
        break
      }
      case 1: {
        // Swallowtail: pale yellow, black bands and margins, blue and red spots, tails.
        g.fillStyle = '#f0d872'
        fore()
        g.fill()
        hind(true)
        g.fill()
        g.save()
        fore()
        g.clip()
        g.fillStyle = '#1d1a16'
        for (const u of [0.08, 0.22, 0.38]) g.fillRect(X(u), 0, 0.06 * S, S)
        g.lineWidth = 0.1 * S
        g.strokeStyle = '#1d1a16'
        fore()
        g.stroke()
        g.restore()
        g.save()
        hind(true)
        g.clip()
        g.lineWidth = 0.14 * S
        g.strokeStyle = '#1d1a16'
        hind(true)
        g.stroke()
        g.restore()
        for (const [u, v] of [[0.3, 0.13], [0.45, 0.18], [0.55, 0.27]]) dot(u, v, 0.03 * S, '#5577c8')
        dot(0.12, 0.22, 0.04 * S, '#d2502a')
        break
      }
      case 2: {
        // Red admiral: black with an orange-red band and white apical spots.
        g.fillStyle = '#1f1a17'
        fore()
        g.fill()
        hind(false)
        g.fill()
        g.save()
        fore()
        g.clip()
        g.strokeStyle = '#d8471d'
        g.lineWidth = 0.14 * S
        g.beginPath()
        g.moveTo(X(0.3), Y(0.97))
        g.lineTo(X(0.7), Y(0.48))
        g.stroke()
        g.restore()
        for (const [u, v] of [[0.82, 0.88], [0.9, 0.8], [0.72, 0.9]]) dot(u, v, 0.03 * S, '#f1ece2')
        g.save()
        hind(false)
        g.clip()
        g.strokeStyle = '#d8471d'
        g.lineWidth = 0.1 * S
        g.beginPath()
        g.moveTo(X(0.66), Y(0.35))
        g.bezierCurveTo(X(0.6), Y(0.12), X(0.3), Y(0.06), X(0.1), Y(0.2))
        g.stroke()
        g.restore()
        break
      }
      default: {
        // Common blue: violet-blue with a dark rim and white fringe.
        g.fillStyle = '#7290e0'
        fore()
        g.fill()
        hind(false)
        g.fill()
        g.lineWidth = 0.035 * S
        g.strokeStyle = '#f4f2ec'
        fore()
        g.stroke()
        hind(false)
        g.stroke()
        g.lineWidth = 0.02 * S
        g.strokeStyle = '#2b2e4a'
        fore()
        g.stroke()
        hind(false)
        g.stroke()
        break
      }
    }
    g.restore()
    // Opaque body swatch in the corner.
    g.fillStyle = '#2a211b'
    g.fillRect(ox, S - 0.07 * S, 0.07 * S, 0.07 * S)
  }
  const tex = new CanvasTexture(c)
  tex.colorSpace = SRGBColorSpace
  tex.anisotropy = 4
  return tex
}
