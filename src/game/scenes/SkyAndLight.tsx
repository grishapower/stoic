import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import {
  CircleGeometry,
  DirectionalLight,
  HemisphereLight,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  PMREMGenerator,
  Scene,
  ShaderMaterial,
  type WebGLRenderTarget,
} from 'three'
import { Sky } from 'three/addons/objects/Sky.js'
import { runtime } from '../runtime'
import { game, useGame } from '../store'
import { elevationForProgress, sky, updateSkyState } from './atmosphere'
import { QUALITY } from './quality'

function configureSkyUniforms(mat: ShaderMaterial, forEnv: boolean) {
  const u = mat.uniforms
  u.turbidity.value = 9.5
  u.rayleigh.value = 2.6
  u.mieCoefficient.value = 0.0036
  u.mieDirectionalG.value = 0.88
  u.cloudCoverage.value = 0.32
  u.cloudDensity.value = 0.5
  u.cloudElevation.value = 0.55
  u.cloudScale.value = 0.00018
  u.cloudSpeed.value = 0.000012
  u.showSunDisc.value = forEnv ? 0 : 1
}

export function SkyAndLight() {
  const gl = useThree((s) => s.gl)
  const scene = useThree((s) => s.scene)
  const quality = useGame((s) => s.settings.quality)

  const skyMesh = useMemo(() => {
    const s = new Sky()
    s.scale.setScalar(5000)
    s.frustumCulled = false
    // Drawn after every opaque object (it sits at the far plane), so the depth
    // test rejects its costly fragments wherever land or trees cover the sky.
    s.renderOrder = 10
    configureSkyUniforms(s.material as ShaderMaterial, false)
    return s
  }, [])

  // Environment scene: sky without the sun disc + a warm dark ground disc.
  const env = useMemo(() => {
    const envScene = new Scene()
    const s = new Sky()
    s.scale.setScalar(900)
    configureSkyUniforms(s.material as ShaderMaterial, true)
    envScene.add(s)
    const ground = new Mesh(new CircleGeometry(400, 32), new MeshBasicMaterial({ color: '#3a2e22' }))
    ground.rotation.x = -Math.PI / 2
    ground.position.y = -6
    envScene.add(ground)
    return { envScene, envSky: s, ground }
  }, [])

  const sun = useMemo(() => {
    const l = new DirectionalLight('#ffd2a0', 3.0)
    l.castShadow = true
    l.shadow.bias = -0.00035
    l.shadow.normalBias = 0.045
    l.shadow.camera.near = 1
    l.shadow.camera.far = 360
    return l
  }, [])
  const target = useMemo(() => new Object3D(), [])
  const hemi = useMemo(() => new HemisphereLight('#a9bad6', '#7a5c3e', 0.5), [])
  // Bounce/fill light from the side opposite the sun (sky + warm ground bounce):
  // keeps back-lit faces readable when looking toward the sun. No shadows.
  const fill = useMemo(() => new DirectionalLight('#d9c7b4', 0.4), [])

  useEffect(() => {
    sun.target = target
    const half = QUALITY[quality].shadowHalf
    const cam = sun.shadow.camera
    cam.left = -half
    cam.right = half
    cam.top = half
    cam.bottom = -half
    cam.updateProjectionMatrix()
    const size = QUALITY[quality].shadowMap
    if (sun.shadow.mapSize.x !== size) {
      sun.shadow.mapSize.set(size, size)
      sun.shadow.map?.dispose()
      sun.shadow.map = null
    }
    // Low quality re-renders the shadow map every other frame (see useFrame).
    sun.shadow.autoUpdate = QUALITY[quality].shadowEvery <= 1
    sun.shadow.needsUpdate = true
  }, [sun, target, quality])

  const pmrem = useMemo(() => new PMREMGenerator(gl), [gl])
  const envRT = useRef<WebGLRenderTarget | null>(null)
  const lastEnvElevation = useRef(-99)
  const lastSkyElevation = useRef(-99)
  const elevation = useRef(sky.elevation)
  const frame = useRef(0)

  const regenerateEnv = () => {
    const prev = envRT.current
    ;(env.envSky.material as ShaderMaterial).uniforms.sunPosition.value.copy(sky.sunDir)
    envRT.current = pmrem.fromScene(env.envScene, 0, 0.1, 2000)
    scene.environment = envRT.current.texture
    prev?.dispose()
    lastEnvElevation.current = sky.elevation
  }

  useEffect(() => {
    scene.environmentIntensity = 1.0
    regenerateEnv()
    return () => {
      envRT.current?.dispose()
      envRT.current = null
      pmrem.dispose()
      scene.environment = null
      skyMesh.geometry.dispose()
      ;(skyMesh.material as ShaderMaterial).dispose()
      env.envSky.geometry.dispose()
      ;(env.envSky.material as ShaderMaterial).dispose()
      env.ground.geometry.dispose()
      ;(env.ground.material as MeshBasicMaterial).dispose()
      sun.dispose()
      hemi.dispose()
      fill.dispose()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useFrame((state, dt) => {
    const s = game()
    const targetEl = elevationForProgress(s.progress)
    elevation.current += (targetEl - elevation.current) * Math.min(1, dt * 0.25)
    if (Math.abs(elevation.current - lastSkyElevation.current) > 0.02) {
      updateSkyState(elevation.current)
      const u = (skyMesh.material as ShaderMaterial).uniforms
      u.sunPosition.value.copy(sky.sunDir)
      sun.color.copy(sky.sunColor)
      const t = Math.min(1, Math.max(0, (sky.elevation - 1.5) / 11))
      sun.intensity = 2.2 + 1.4 * t
      hemi.intensity = 0.42 + 0.18 * t
      fill.intensity = 0.32 + 0.12 * t
      state.gl.toneMappingExposure = 0.56 + (1 - t) * 0.1
      lastSkyElevation.current = elevation.current
    }
    const q = QUALITY[s.settings.quality]
    // The IBL bake is a visible hitch on a headset: rarer on lower quality.
    if (Math.abs(sky.elevation - lastEnvElevation.current) > q.envStepDeg) regenerateEnv()
    ;(skyMesh.material as ShaderMaterial).uniforms.time.value = state.clock.elapsedTime
    skyMesh.position.copy(state.camera.position)

    // Shadow frustum follows the camera, snapped to texels to limit shimmering.
    const half = q.shadowHalf
    const texel = (half * 2) / sun.shadow.mapSize.x
    const fx = runtime.player.pos.x + Math.sin(-runtime.player.yaw) * half * 0.35
    const fz = runtime.player.pos.z - Math.cos(runtime.player.yaw) * half * 0.35
    const cx = Math.round(fx / texel) * texel
    const cz = Math.round(fz / texel) * texel
    const cy = Math.round(runtime.player.pos.y / texel) * texel
    target.position.set(cx, cy, cz)
    sun.position.set(cx + sky.sunDir.x * 160, cy + sky.sunDir.y * 160, cz + sky.sunDir.z * 160)
    target.updateMatrixWorld()
    fill.position.set(cx - sky.sunDir.x * 100, cy + 35, cz - sky.sunDir.z * 100)
    fill.target = target
    if (!sun.shadow.autoUpdate && ++frame.current % q.shadowEvery === 0) sun.shadow.needsUpdate = true
  })

  return (
    <>
      <primitive object={skyMesh} />
      <primitive object={sun} />
      <primitive object={target} />
      <primitive object={hemi} />
      <primitive object={fill} />
    </>
  )
}
