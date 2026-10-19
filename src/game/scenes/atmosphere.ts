import { Color, Vector3, type Material, type WebGLProgramParametersWithUniforms } from 'three'
import { SUN_ELEVATION_END, SUN_ELEVATION_START, sunDirection } from '../world/layout'

/**
 * Shared sky/sun state + a "directional fog" patch for distant materials:
 * fog colour shifts toward a warm tone when looking toward the sun, so the sea
 * horizon blends with the sky in every direction.
 */

export const sky = {
  elevation: SUN_ELEVATION_START,
  sunDir: new Vector3(...sunDirection(SUN_ELEVATION_START)),
  sunColor: new Color('#ffd2a0'),
}

export const fogUniforms = {
  uFogDensity: { value: 0.0003 },
  uFogSunColor: { value: new Color('#f2c08e') },
  uFogAwayColor: { value: new Color('#b3b3bf') },
  uFogSunDir: { value: new Vector3(-0.55, 0, -0.84) },
  uFogNearFade: { value: 60 },
}

/** Elevation for a narrative progress value 0..1 (and beyond, for free roam). */
export function elevationForProgress(p: number) {
  if (p <= 1) return SUN_ELEVATION_START + (SUN_ELEVATION_END - SUN_ELEVATION_START) * p
  // After the letter the sun keeps sinking until its disc touches the sea.
  return Math.max(0.35, SUN_ELEVATION_END - (p - 1) * 1.6)
}

/** The setting sun drifts slightly north-west (toward the island) as it goes down. */
export function azimuthForElevation(elevationDeg: number) {
  return 233 + Math.max(0, SUN_ELEVATION_START - elevationDeg) * 0.9
}

const tmpA = new Color()
const tmpB = new Color()

export function updateSkyState(elevationDeg: number) {
  sky.elevation = elevationDeg
  const d = sunDirection(elevationDeg, azimuthForElevation(elevationDeg))
  sky.sunDir.set(d[0], d[1], d[2])
  // Warmer and dimmer as the sun gets low.
  const t = Math.min(1, Math.max(0, (elevationDeg - 1.5) / 11))
  sky.sunColor.copy(tmpA.set('#ff8a3c')).lerp(tmpB.set('#ffc98a'), t)
  fogUniforms.uFogSunDir.value.set(d[0], 0, d[2]).normalize()
  fogUniforms.uFogSunColor.value.copy(tmpA.set('#f09a62')).lerp(tmpB.set('#f2cf9e'), t)
  fogUniforms.uFogAwayColor.value.copy(tmpA.set('#9f98a8')).lerp(tmpB.set('#b4b8c4'), t)
}
updateSkyState(SUN_ELEVATION_START)

const FOG_PARS = /* glsl */ `
uniform float uFogDensity;
uniform vec3 uFogSunColor;
uniform vec3 uFogAwayColor;
uniform vec3 uFogSunDir;
uniform float uFogNearFade;
uniform float uFogMul;
uniform float uFogSunTint;
varying vec3 vFogWorldPos;
`

const FOG_APPLY = /* glsl */ `
{
  vec3 fv = vFogWorldPos - cameraPosition;
  float fd = length(fv);
  vec3 fdir = fv / max(fd, 1e-4);
  float sunAmt = pow(max(dot(normalize(vec3(fdir.x, 0.0, fdir.z)), uFogSunDir), 0.0), 3.0);
  vec3 fcol = mix(uFogAwayColor, uFogSunColor, sunAmt * uFogSunTint);
  float fdist = max(fd - uFogNearFade, 0.0);
  float fdens = uFogDensity * uFogMul;
  float ff = 1.0 - exp(-fdens * fdens * fdist * fdist);
  // Thicker haze close to the horizon line.
  ff = clamp(ff * (1.0 + 0.3 * (1.0 - abs(fdir.y))), 0.0, 1.0);
  // Toward the low sun, keep distant land as a darker silhouette.
  ff *= mix(1.0, 0.6, sunAmt);
  gl_FragColor.rgb = mix(gl_FragColor.rgb, fcol, ff);
}
`

/**
 * Patch a built-in material with directional fog (replaces the standard fog
 * chunk). The material must have `fog = false` so three's own fog is skipped.
 */
export function applyDirectionalFog(
  material: Material,
  extra?: (shader: WebGLProgramParametersWithUniforms) => void,
  /** Per-material haze multiplier (e.g. 0.55 keeps distant landmarks readable). */
  fogMul = 1,
  /** How much the haze takes the warm sun colour toward the sun (back-lit silhouettes stay cool). */
  sunTint = 1,
) {
  ;(material as Material & { fog: boolean }).fog = false
  const prev = material.onBeforeCompile
  material.onBeforeCompile = (shader, renderer) => {
    prev.call(material, shader, renderer)
    extra?.(shader)
    Object.assign(shader.uniforms, fogUniforms, { uFogMul: { value: fogMul }, uFogSunTint: { value: sunTint } })
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vFogWorldPos;')
      .replace(
        '#include <fog_vertex>',
        '#include <fog_vertex>\nvFogWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;',
      )
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\n' + FOG_PARS)
      .replace('#include <fog_fragment>', FOG_APPLY)
  }
  const prevKey = material.customProgramCacheKey.bind(material)
  material.customProgramCacheKey = () => prevKey() + '|dirfog' + fogMul + '/' + sunTint
}
