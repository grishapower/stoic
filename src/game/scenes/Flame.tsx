import { useFrame } from '@react-three/fiber'
import { useMemo, useRef } from 'react'
import { AdditiveBlending, CanvasTexture, SRGBColorSpace, SpriteMaterial, type PointLight, type Sprite } from 'three'

/**
 * Small oil-lamp flame: a teardrop sprite plus a faint glow, flickering.
 * `level` (0..1, read every frame) fades it in — e.g. lamps lit at dusk.
 * An optional warm point light follows the same flicker.
 */

let flameTex: CanvasTexture | null = null
let glowTex: CanvasTexture | null = null

function flameTexture() {
  if (flameTex) return flameTex
  const c = document.createElement('canvas')
  c.width = 64
  c.height = 128
  const g = c.getContext('2d')!
  // Teardrop: a round base with a pointed top.
  const grad = g.createRadialGradient(32, 92, 2, 32, 84, 40)
  grad.addColorStop(0, 'rgba(255,250,225,1)')
  grad.addColorStop(0.25, 'rgba(255,214,120,0.95)')
  grad.addColorStop(0.6, 'rgba(255,128,40,0.55)')
  grad.addColorStop(1, 'rgba(255,90,20,0)')
  g.fillStyle = grad
  g.beginPath()
  g.moveTo(32, 6)
  g.bezierCurveTo(44, 46, 56, 70, 52, 96)
  g.bezierCurveTo(48, 122, 16, 122, 12, 96)
  g.bezierCurveTo(8, 70, 20, 46, 32, 6)
  g.fill()
  flameTex = new CanvasTexture(c)
  flameTex.colorSpace = SRGBColorSpace
  return flameTex
}

function glowTexture() {
  if (glowTex) return glowTex
  const c = document.createElement('canvas')
  c.width = c.height = 64
  const g = c.getContext('2d')!
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32)
  grad.addColorStop(0, 'rgba(255,190,110,0.55)')
  grad.addColorStop(0.35, 'rgba(255,150,70,0.18)')
  grad.addColorStop(1, 'rgba(255,120,40,0)')
  g.fillStyle = grad
  g.fillRect(0, 0, 64, 64)
  glowTex = new CanvasTexture(c)
  glowTex.colorSpace = SRGBColorSpace
  return glowTex
}

interface FlameProps {
  position: [number, number, number]
  /** Flame height in metres. */
  size?: number
  /** 0..1 each frame; default always lit. */
  level?: () => number
  /** Peak intensity of an attached point light (0 = none). */
  light?: number
  lightDistance?: number
  seed?: number
}

export function Flame({ position, size = 0.045, level, light = 0, lightDistance = 5, seed = 0 }: FlameProps) {
  const flame = useRef<Sprite>(null)
  const glow = useRef<Sprite>(null)
  const lamp = useRef<PointLight>(null)
  const mats = useMemo(
    () => ({
      flame: new SpriteMaterial({ map: flameTexture(), blending: AdditiveBlending, depthWrite: false, transparent: true, fog: false }),
      glow: new SpriteMaterial({ map: glowTexture(), blending: AdditiveBlending, depthWrite: false, transparent: true, fog: false }),
    }),
    [],
  )

  useFrame(({ clock }) => {
    const t = clock.elapsedTime + seed * 7.3
    const lv = level ? level() : 1
    const flick = 0.86 + 0.08 * Math.sin(t * 11.3) + 0.06 * Math.sin(t * 23.7 + 1.3) + 0.04 * Math.sin(t * 5.1)
    const on = lv > 0.01
    if (flame.current) {
      flame.current.visible = on
      flame.current.scale.set(size * 0.5 * (0.9 + 0.1 * flick), size * flick * (0.4 + 0.6 * lv), 1)
      mats.flame.opacity = Math.min(1, lv * 1.4)
    }
    if (glow.current) {
      glow.current.visible = on
      const gs = size * 7 * (0.92 + 0.08 * flick)
      glow.current.scale.set(gs, gs, 1)
      mats.glow.opacity = lv * 0.85
    }
    if (lamp.current) lamp.current.intensity = light * lv * flick
  })

  return (
    <group position={position}>
      <sprite ref={flame} material={mats.flame} position={[0, size * 0.42, 0]} renderOrder={5} />
      <sprite ref={glow} material={mats.glow} position={[0, size * 0.35, 0]} renderOrder={4} />
      {light > 0 && <pointLight ref={lamp} color="#ffb36b" intensity={0} distance={lightDistance} decay={2} position={[0, size * 0.8, 0]} />}
    </group>
  )
}
