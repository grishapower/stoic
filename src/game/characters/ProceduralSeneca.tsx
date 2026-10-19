import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  ConeGeometry,
  CylinderGeometry,
  Group,
  LatheGeometry,
  MeshStandardMaterial,
  SphereGeometry,
  Vector2,
} from 'three'
import type { Gesture } from '../../data/narration/types'
import { seneca } from './senecaController'

/**
 * Procedural stand-in for Seneca (used until/unless the Meshy character is
 * available). A simple robed figure with hand-authored procedural animation:
 * gait, breathing, head look, talk nods and a small gesture vocabulary.
 * Built facing +Z; the root is rotated by yaw + π.
 */

interface Pose {
  // Right arm
  rsx: number
  rsz: number
  re: number
  // Left arm
  lsx: number
  lsz: number
  le: number
  shrug: number
}

const REST: Pose = { rsx: 0.05, rsz: 0.08, re: -0.25, lsx: -0.35, lsz: -0.12, le: -1.05, shrug: 0 }

const GESTURES: Record<Gesture, Partial<Pose>> = {
  none: {},
  'open-hand': { rsx: -0.75, rsz: 0.32, re: -0.85 },
  count: { rsx: -0.75, rsz: -0.15, re: -1.55, lsx: -0.7, lsz: 0.1, le: -1.5 },
  chest: { rsx: -0.35, rsz: -0.45, re: -2.0 },
  grasp: { rsx: -0.95, rsz: 0.05, re: -1.2 },
  shrug: { rsx: -0.35, rsz: 0.45, re: -1.35, lsx: -0.35, lsz: -0.45, le: -1.35, shrug: 1 },
  'point-back': { rsx: 0.55, rsz: 0.45, re: -0.25 },
  'toward-sea': { rsx: -1.25, rsz: 0.25, re: -0.2 },
  'toward-table': { rsx: -0.7, rsz: 0.45, re: -0.35 },
  welcome: { rsx: -0.45, rsz: 0.5, re: -0.6, lsx: -0.45, lsz: -0.5, le: -0.6 },
  'scroll-read': { rsx: -0.8, rsz: -0.1, re: -1.65, lsx: -0.8, lsz: 0.1, le: -1.65 },
  'scroll-show': { rsx: -1.05, rsz: 0.2, re: -0.95 },
  'scroll-close': { rsx: -0.6, rsz: -0.1, re: -1.5, lsx: -0.6, lsz: 0.1, le: -1.5 },
}

const lathe = (pts: [number, number][], seg = 24) => new LatheGeometry(pts.map(([r, y]) => new Vector2(r, y)), seg)

/** Diagonal draped cloth around the torso (pallium): a partial cylinder cut by a slanted top edge. */
function palliumGeometry(): BufferGeometry {
  const SEG = 28
  const ROWS = 12
  const pos: number[] = []
  const idx: number[] = []
  const th0 = -0.35 * Math.PI
  const th1 = 1.15 * Math.PI
  for (let j = 0; j <= ROWS; j++) {
    const v = j / ROWS
    for (let i = 0; i <= SEG; i++) {
      const u = i / SEG
      const th = th0 + (th1 - th0) * u
      // Top edge rises from the right hip (front) to the left shoulder (back/left).
      const bottom = -0.62 + 0.08 * Math.sin(th * 2)
      const top = 0.05 + 0.48 * Math.max(0, Math.min(1, (Math.sin(th) + 0.2) / 1.2))
      const y = bottom + (top - bottom) * v
      const r = (y < 0 ? 0.25 - 0.06 * (1 + y / 0.62) * 0.3 + 0.03 * (y / -0.62) : 0.215 - 0.03 * (y / 0.5)) + 0.012 * Math.sin(th * 7 + y * 9)
      pos.push(Math.cos(th) * r, y, Math.sin(th) * r * 0.78)
    }
  }
  for (let j = 0; j < ROWS; j++) {
    for (let i = 0; i < SEG; i++) {
      const a = j * (SEG + 1) + i
      const b = a + SEG + 1
      idx.push(a, a + 1, b, b, a + 1, b + 1)
    }
  }
  const g = new BufferGeometry()
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3))
  g.setIndex(idx)
  g.computeVertexNormals()
  return g
}

export function ProceduralSeneca() {
  const root = useRef<Group>(null)
  const pelvis = useRef<Group>(null)
  const torso = useRef<Group>(null)
  const head = useRef<Group>(null)
  const rShoulder = useRef<Group>(null)
  const rElbow = useRef<Group>(null)
  const lShoulder = useRef<Group>(null)
  const lElbow = useRef<Group>(null)
  const rHip = useRef<Group>(null)
  const lHip = useRef<Group>(null)
  const rKnee = useRef<Group>(null)
  const lKnee = useRef<Group>(null)
  const scrollHand = useRef<Group>(null)
  const scrollBoth = useRef<Group>(null)
  const pose = useRef<Pose>({ ...REST })

  const res = useMemo(() => {
    const tunic = new MeshStandardMaterial({ color: '#e7dcc6', roughness: 0.95 })
    const pall = new MeshStandardMaterial({ color: '#8c6f53', roughness: 0.95, side: 2 })
    const skin = new MeshStandardMaterial({ color: '#c79a7c', roughness: 0.75 })
    const hair = new MeshStandardMaterial({ color: '#bdb6ad', roughness: 0.95 })
    const dark = new MeshStandardMaterial({ color: '#2b211b', roughness: 0.8 })
    const leather = new MeshStandardMaterial({ color: '#5b3d27', roughness: 0.85 })
    const parchment = new MeshStandardMaterial({ color: '#e8d9b5', roughness: 0.85 })
    const geo = {
      skirt: lathe([
        [0.0001, 0.02],
        [0.17, 0.0],
        [0.2, -0.2],
        [0.235, -0.45],
        [0.255, -0.62],
        [0.24, -0.64],
      ]),
      chest: lathe([
        [0.17, 0.0],
        [0.19, 0.18],
        [0.205, 0.32],
        [0.19, 0.44],
        [0.12, 0.52],
        [0.06, 0.55],
      ]),
      pallium: palliumGeometry(),
      belt: new CylinderGeometry(0.178, 0.178, 0.035, 24, 1, true),
      neck: new CylinderGeometry(0.05, 0.058, 0.12, 12),
      skull: new SphereGeometry(0.104, 24, 18),
      hair: new SphereGeometry(0.11, 24, 12, 0, Math.PI * 2, 0, Math.PI * 0.62),
      beard: new SphereGeometry(0.084, 18, 12, 0, Math.PI * 2, Math.PI * 0.35, Math.PI * 0.65),
      nose: new ConeGeometry(0.018, 0.05, 8),
      eye: new SphereGeometry(0.011, 8, 6),
      brow: new BoxGeometry(0.045, 0.01, 0.012),
      ear: new SphereGeometry(0.022, 8, 6),
      sleeve: new CylinderGeometry(0.066, 0.06, 0.17, 12),
      upperArm: new CylinderGeometry(0.048, 0.044, 0.15, 10),
      forearm: new CylinderGeometry(0.043, 0.034, 0.25, 10),
      hand: new BoxGeometry(0.075, 0.1, 0.032),
      shin: new CylinderGeometry(0.048, 0.04, 0.42, 10),
      sandal: new BoxGeometry(0.095, 0.035, 0.26),
      scroll: new CylinderGeometry(0.03, 0.03, 0.27, 12),
    }
    geo.skirt.scale(1, 1, 0.78)
    geo.chest.scale(1, 1, 0.68)
    geo.belt.scale(1, 1, 0.68)
    geo.skull.scale(0.92, 1.12, 1.02)
    geo.hair.scale(0.98, 1.06, 1.06)
    geo.beard.scale(1.0, 0.95, 0.85)
    geo.nose.rotateX(Math.PI / 2)
    return { mats: { tunic, pall, skin, hair, dark, leather, parchment }, geo }
  }, [])

  useEffect(
    () => () => {
      Object.values(res.mats).forEach((m) => m.dispose())
      Object.values(res.geo).forEach((g) => g.dispose())
    },
    [res],
  )

  useFrame((state, dt) => {
    const t = state.clock.elapsedTime
    if (!root.current) return
    root.current.position.copy(seneca.pos)
    root.current.rotation.y = seneca.yaw + Math.PI

    const walk = Math.min(1, seneca.speed / 0.6)
    const ph = seneca.stride
    const breathe = Math.sin(t * 1.5) * 0.5 + 0.5

    // Pelvis bob & sway.
    if (pelvis.current) {
      pelvis.current.position.y = 0.93 + Math.abs(Math.sin(ph)) * 0.022 * walk - 0.008 * walk + Math.sin(t * 0.45) * 0.003 * (1 - walk)
      pelvis.current.position.x = Math.sin(ph) * 0.012 * walk + Math.sin(t * 0.37) * 0.008 * (1 - walk)
      pelvis.current.rotation.y = Math.sin(ph) * 0.06 * walk
    }
    if (torso.current) {
      torso.current.rotation.y = -Math.sin(ph) * 0.09 * walk
      torso.current.rotation.x = 0.04 * walk + 0.02 + Math.sin(t * 1.5) * 0.006
      torso.current.scale.set(1 + breathe * 0.008, 1 + breathe * 0.006, 1 + breathe * 0.012)
    }
    // Legs.
    const swing = 0.42 * walk
    if (rHip.current && lHip.current && rKnee.current && lKnee.current) {
      rHip.current.rotation.x = Math.sin(ph) * swing
      lHip.current.rotation.x = -Math.sin(ph) * swing
      rKnee.current.rotation.x = Math.max(0, Math.sin(ph + 1.4)) * 0.55 * walk
      lKnee.current.rotation.x = Math.max(0, -Math.sin(ph + 1.4)) * 0.55 * walk
    }
    // Head: look target + talk nods.
    if (head.current) {
      const nod = seneca.talkEnergy * (Math.sin(t * 3.3) * 0.025 + Math.sin(t * 1.7 + 1) * 0.02)
      head.current.rotation.order = 'YXZ'
      head.current.rotation.y = seneca.headYaw * 0.85
      head.current.rotation.x = -seneca.headPitch * 0.8 + nod
      head.current.rotation.z = Math.sin(t * 0.6) * 0.015 + seneca.talkEnergy * Math.sin(t * 2.1) * 0.012
    }
    // Arms: rest pose + walk swing, blended toward the gesture pose.
    const g = GESTURES[seneca.gesture] ?? {}
    const target: Pose = { ...REST }
    const reading = seneca.talking && seneca.look === 'scroll'
    const w = Math.max(seneca.gestureWeight, reading ? 0.85 : 0)
    const gp: Pose = { ...REST, ...(reading && seneca.gestureWeight < 0.3 ? GESTURES['scroll-read'] : g) }
    for (const k of Object.keys(target) as (keyof Pose)[]) target[k] = REST[k] + (gp[k] - REST[k]) * w
    const armSwing = Math.sin(ph) * 0.28 * walk * (1 - w)
    target.rsx += -armSwing
    // Subtle hand life while talking.
    target.re += seneca.talkEnergy * Math.sin(t * 2.6) * 0.06 * w
    const k = Math.min(1, dt * 7)
    const P = pose.current
    for (const key of Object.keys(P) as (keyof Pose)[]) P[key] += (target[key] - P[key]) * k
    if (rShoulder.current && rElbow.current && lShoulder.current && lElbow.current) {
      rShoulder.current.rotation.set(P.rsx, 0, P.rsz)
      lShoulder.current.rotation.set(P.lsx, 0, -P.lsz)
      rElbow.current.rotation.x = P.re
      lElbow.current.rotation.x = P.le
      rShoulder.current.position.y = 0.46 + P.shrug * 0.035
      lShoulder.current.position.y = 0.46 + P.shrug * 0.035
    }
    // Scroll: held in the left hand at rest; across both hands when reading.
    const both = reading || seneca.gesture === 'scroll-read' || seneca.gesture === 'scroll-close'
    if (scrollHand.current) scrollHand.current.visible = seneca.holdingScroll && !both
    if (scrollBoth.current) scrollBoth.current.visible = seneca.holdingScroll && both && w > 0.5
  })

  const { mats, geo } = res
  const arm = (side: 1 | -1, shoulderRef: React.RefObject<Group | null>, elbowRef: React.RefObject<Group | null>, extra?: React.ReactNode) => (
    <group ref={shoulderRef} position={[side * 0.2, 0.46, 0]}>
      <mesh geometry={geo.sleeve} material={mats.tunic} position={[0, -0.07, 0]} castShadow />
      <mesh geometry={geo.upperArm} material={mats.skin} position={[0, -0.2, 0]} castShadow />
      <group ref={elbowRef} position={[0, -0.28, 0]}>
        <mesh geometry={geo.forearm} material={mats.skin} position={[0, -0.125, 0]} castShadow />
        <group position={[0, -0.29, 0.005]}>
          <mesh geometry={geo.hand} material={mats.skin} castShadow />
          {extra}
        </group>
      </group>
    </group>
  )
  const leg = (side: 1 | -1, hipRef: React.RefObject<Group | null>, kneeRef: React.RefObject<Group | null>) => (
    <group ref={hipRef} position={[side * 0.09, 0, 0]}>
      <group ref={kneeRef} position={[0, -0.45, 0]}>
        <mesh geometry={geo.shin} material={mats.skin} position={[0, -0.21, 0]} castShadow />
        <mesh geometry={geo.sandal} material={mats.leather} position={[0, -0.455, 0.05]} castShadow />
      </group>
    </group>
  )

  return (
    <group ref={root}>
      <group ref={pelvis} position={[0, 0.93, 0]}>
        {leg(1, rHip, rKnee)}
        {leg(-1, lHip, lKnee)}
        <mesh geometry={geo.skirt} material={mats.tunic} castShadow receiveShadow />
        <group ref={torso}>
          <mesh geometry={geo.chest} material={mats.tunic} castShadow receiveShadow />
          <mesh geometry={geo.belt} material={mats.leather} position={[0, 0.02, 0]} />
          <mesh geometry={geo.pallium} material={mats.pall} castShadow receiveShadow />
          <mesh geometry={geo.neck} material={mats.skin} position={[0, 0.58, 0]} castShadow />
          <group ref={head} position={[0, 0.7, 0.01]}>
            <mesh geometry={geo.skull} material={mats.skin} castShadow />
            <mesh geometry={geo.hair} material={mats.hair} position={[0, 0.012, -0.012]} rotation={[-0.55, 0, 0]} castShadow />
            <mesh geometry={geo.beard} material={mats.hair} position={[0, -0.045, 0.028]} castShadow />
            <mesh geometry={geo.nose} material={mats.skin} position={[0, 0.0, 0.105]} />
            <mesh geometry={geo.eye} material={mats.dark} position={[0.033, 0.025, 0.088]} />
            <mesh geometry={geo.eye} material={mats.dark} position={[-0.033, 0.025, 0.088]} />
            <mesh geometry={geo.brow} material={mats.hair} position={[0.034, 0.045, 0.092]} rotation={[0, 0, -0.12]} />
            <mesh geometry={geo.brow} material={mats.hair} position={[-0.034, 0.045, 0.092]} rotation={[0, 0, 0.12]} />
            <mesh geometry={geo.ear} material={mats.skin} position={[0.098, 0.005, 0]} scale={[0.5, 1, 0.8]} />
            <mesh geometry={geo.ear} material={mats.skin} position={[-0.098, 0.005, 0]} scale={[0.5, 1, 0.8]} />
          </group>
          {arm(1, rShoulder, rElbow)}
          {arm(
            -1,
            lShoulder,
            lElbow,
            <group ref={scrollHand} position={[0, -0.02, 0.03]}>
              <mesh geometry={geo.scroll} material={mats.parchment} castShadow />
            </group>,
          )}
          <group ref={scrollBoth} position={[0, 0.2, 0.3]} rotation={[0.35, 0, Math.PI / 2]}>
            <mesh geometry={geo.scroll} material={mats.parchment} scale={[1, 1.3, 1]} castShadow />
          </group>
        </group>
      </group>
    </group>
  )
}
