import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import {
  CylinderGeometry,
  Matrix4,
  LatheGeometry,
  MeshStandardMaterial,
  RingGeometry,
  SphereGeometry,
  Vector2,
  Vector3,
  type Mesh,
} from 'three'
import { audio } from '../audio/engine'
import { useArchMaterials } from '../materials/library'
import { runtime } from '../runtime'
import { useGame } from '../store'
import { evening } from '../world/evening'
import { terrainHeight } from '../world/terrain'
import { PERGOLA } from '../world/layout'
import { rng } from '../world/noise'
import { studyPlaced, type StudyItem } from '../world/props'
import { Flame } from './Flame'
import { CullGroup } from './CullGroup'
import { GlbProp, hasModel, modelInfo } from './Props'

/**
 * Seneca's open-air study under the pergola (concept c05, "time is visible"):
 * an oil lamp that is lit as the evening comes, an outflow water clock
 * dripping into its bowl, a portrait bust on a column, a basket of scrolls.
 */

const TABLE_TOP = hasModel('writing-table') ? 0.72 : 0.77

function at(item: StudyItem, y = 0): { p: [number, number, number]; rot: number } {
  const s = studyPlaced(item)
  return { p: [s.x, terrainHeight(s.x, s.z) + y, s.z], rot: s.rotY }
}

const lampLevel = () => evening(useGame.getState().progress).lamps

/** The desk clutter is small: drawn only from nearby (the lamp's light stays, so shaders never change). */
const STUDY_FAR = { high: 80, medium: 50, low: 24 }
const STUDY_CENTER = [PERGOLA.table.x, terrainHeight(PERGOLA.table.x, PERGOLA.table.z) + 0.8, PERGOLA.table.z] as const

/* ------------------------------------------------------------ Lamp */

function Lamp() {
  const { p, rot } = at('lamp', TABLE_TOP)
  // A point light adds a per-pixel cost to every lit surface: none on the light (VR) preset.
  const light = useGame((s) => (s.settings.quality === 'low' ? 0 : 2.2))
  const res = useMemo(() => {
    const body = new SphereGeometry(0.06, 14, 8)
    body.scale(1, 0.42, 1.45)
    const nozzle = new CylinderGeometry(0.018, 0.022, 0.06, 8)
    nozzle.rotateX(Math.PI / 2)
    const bronze = new MeshStandardMaterial({ color: '#8a6235', roughness: 0.4, metalness: 0.8 })
    return { body, nozzle, bronze }
  }, [])
  useEffect(
    () => () => {
      res.body.dispose()
      res.nozzle.dispose()
      res.bronze.dispose()
    },
    [res],
  )
  const c = Math.cos(rot)
  const s = Math.sin(rot)
  // Flame at the nozzle (+Z local): the model's recorded point, or 0.1 m ahead of the procedural lamp.
  const [fx, fy, fz] = (hasModel('oil-lamp') && modelInfo('oil-lamp')?.flamePoint) || [0, 0.03, 0.1]
  const flame: [number, number, number] = [p[0] + fx * c + fz * s, p[1] + fy, p[2] - fx * s + fz * c]
  return (
    <group>
      {hasModel('oil-lamp') ? (
        <GlbProp id="oil-lamp" position={p} rotationY={rot} />
      ) : (
        <group position={p} rotation={[0, rot, 0]}>
          <mesh geometry={res.body} material={res.bronze} position={[0, 0.026, 0]} castShadow />
          <mesh geometry={res.nozzle} material={res.bronze} position={[0, 0.026, 0.085]} castShadow />
        </group>
      )}
      <Flame position={flame} size={0.05} level={lampLevel} light={light} lightDistance={6} seed={7} />
    </group>
  )
}

/* ------------------------------------------------------------ Clepsydra */

/** Spout tip and the catch-bowl water surface, in the clepsydra's local frame. */
const SPOUT: [number, number, number] = (hasModel('clepsydra') && modelInfo('clepsydra')?.spoutTip) || [0, 0.555, 0.245]
const BOWL_Y = 0.075
/** The bowl sits a little beyond the spout so it clears the vessel. */
const BOWL_Z = SPOUT[2] + (hasModel('clepsydra') ? 0.12 : 0)
const DRIP_PERIOD = 1.15

function Clepsydra() {
  const { p, rot } = at('clepsydra', -0.02)
  const drop = useRef<Mesh>(null)
  const lastDrip = useRef(-1)
  const ripple = useRef<Mesh>(null)
  const res = useMemo(() => {
    const vessel = new LatheGeometry(
      (
        [
          [0.001, 0.5],
          [0.1, 0.5],
          [0.15, 0.56],
          [0.17, 0.68],
          [0.165, 0.86],
          [0.18, 0.9],
          [0.18, 0.92],
          [0.15, 0.92],
          [0.15, 0.62],
          [0.001, 0.6],
        ] as [number, number][]
      ).map(([r, y]) => new Vector2(r, y)),
      28,
    )
    vessel.computeVertexNormals()
    const bowl = new LatheGeometry(
      (
        [
          [0.001, 0],
          [0.09, 0],
          [0.15, 0.06],
          [0.16, 0.095],
          [0.145, 0.095],
          [0.13, 0.065],
          [0.001, 0.05],
        ] as [number, number][]
      ).map(([r, y]) => new Vector2(r, y)),
      24,
    )
    bowl.computeVertexNormals()
    const leg = new CylinderGeometry(0.012, 0.012, 0.52, 6)
    const spout = new CylinderGeometry(0.01, 0.013, 0.1, 8)
    spout.rotateX(Math.PI / 2)
    const water = new CylinderGeometry(0.15, 0.15, 0.005, 24)
    const dropGeo = new SphereGeometry(0.007, 8, 6)
    dropGeo.scale(1, 1.6, 1)
    const rippleGeo = new RingGeometry(0.8, 1, 24)
    rippleGeo.rotateX(-Math.PI / 2)
    const bronze = new MeshStandardMaterial({ color: '#7a5631', roughness: 0.38, metalness: 0.8 })
    const clay = new MeshStandardMaterial({ color: '#a45c38', roughness: 0.85 })
    const waterMat = new MeshStandardMaterial({ color: '#3c5560', roughness: 0.05, metalness: 0.1 })
    const dropMat = new MeshStandardMaterial({ color: '#cfe3ea', roughness: 0.05, transparent: true, opacity: 0.85 })
    const rippleMat = new MeshStandardMaterial({ color: '#dfeff2', roughness: 0.1, transparent: true, opacity: 0.5, depthWrite: false })
    return { vessel, bowl, leg, spout, water, dropGeo, rippleGeo, bronze, clay, waterMat, dropMat, rippleMat }
  }, [])
  useEffect(
    () => () => {
      for (const v of Object.values(res)) v.dispose()
    },
    [res],
  )
  useFrame(({ clock }) => {
    const t = clock.elapsedTime % DRIP_PERIOD
    const fall = Math.sqrt((2 * (SPOUT[1] - BOWL_Y)) / 9.81)
    if (drop.current) {
      const grow = 0.55 // the drop swells at the spout before it falls
      if (t < grow) {
        drop.current.position.set(SPOUT[0], SPOUT[1] - 0.006, SPOUT[2])
        drop.current.scale.setScalar(0.4 + (t / grow) * 0.6)
        drop.current.visible = true
      } else if (t < grow + fall) {
        const tf = t - grow
        drop.current.position.set(SPOUT[0], SPOUT[1] - 0.006 - 0.5 * 9.81 * tf * tf, SPOUT[2])
        drop.current.scale.setScalar(1)
        drop.current.visible = true
      } else drop.current.visible = false
    }
    // The drop lands: a soft plink when the player is close enough to hear it.
    const cycle = Math.floor((clock.elapsedTime - 0.55 - fall) / DRIP_PERIOD)
    if (cycle !== lastDrip.current) {
      lastDrip.current = cycle
      const pp = runtime.player.pos
      if (Math.hypot(pp.x - p[0], pp.z - p[2]) < 7) audio.footsteps.step({ x: p[0], y: p[1] + BOWL_Y, z: p[2] }, 'drip', 'world')
    }
    if (ripple.current) {
      const tr = t - 0.55 - fall
      const on = tr > 0 && tr < 0.5
      ripple.current.visible = on
      if (on) {
        ripple.current.scale.setScalar(0.01 + tr * 0.22)
        res.rippleMat.opacity = 0.55 * (1 - tr / 0.5)
      }
    }
  })
  const glb = hasModel('clepsydra')
  return (
    <group position={p} rotation={[0, rot, 0]}>
      {glb ? (
        <GlbProp id="clepsydra" position={[0, 0, 0]} />
      ) : (
        <>
          <mesh geometry={res.vessel} material={res.bronze} castShadow receiveShadow />
          {[0, 1, 2].map((k) => {
            const a = (k / 3) * Math.PI * 2 + 0.5
            return <mesh key={k} geometry={res.leg} material={res.bronze} position={[Math.sin(a) * 0.11, 0.25, Math.cos(a) * 0.11]} rotation={[Math.cos(a) * 0.12, 0, -Math.sin(a) * 0.12]} castShadow />
          })}
          <mesh geometry={res.spout} material={res.bronze} position={[0, SPOUT[1] + 0.004, SPOUT[2] - 0.05]} castShadow />
          <mesh geometry={res.water} material={res.waterMat} position={[0, 0.9, 0]} />
        </>
      )}
      {/* Catch bowl under the spout. */}
      <group position={[SPOUT[0], 0, BOWL_Z]}>
        <mesh geometry={res.bowl} material={res.clay} castShadow receiveShadow />
        <mesh geometry={res.water} material={res.waterMat} position={[0, BOWL_Y, 0]} scale={[0.9, 1, 0.9]} />
        <mesh ref={ripple} geometry={res.rippleGeo} material={res.rippleMat} position={[0, BOWL_Y + 0.004, SPOUT[2] - BOWL_Z]} visible={false} />
      </group>
      <mesh ref={drop} geometry={res.dropGeo} material={res.dropMat} visible={false} />
    </group>
  )
}

/* ------------------------------------------------------------ Bust, basket, jug */

function BustColumn() {
  const mats = useArchMaterials()
  const { p } = at('bustColumn', -0.03)
  const marble = useMemo(() => {
    const m = mats.marble.clone()
    m.vertexColors = false
    return m
  }, [mats])
  const res = useMemo(() => {
    const shaft = new CylinderGeometry(0.15, 0.17, 1.02, 20)
    shaft.translate(0, 0.14 + 0.51, 0)
    const base = new CylinderGeometry(0.24, 0.26, 0.14, 20)
    base.translate(0, 0.07, 0)
    const cap = new CylinderGeometry(0.22, 0.17, 0.1, 20)
    cap.translate(0, 1.21, 0)
    // One mesh (one draw call) for the whole column.
    const column = mergeGeometries([base, shaft, cap], false)!
    for (const g of [base, shaft, cap]) g.dispose()
    return { column }
  }, [])
  useEffect(
    () => () => {
      res.column.dispose()
      marble.dispose()
    },
    [res, marble],
  )
  // The portrait looks toward the writer's seat.
  const seat = studyPlaced('chair')
  const look = Math.atan2(seat.x - p[0], seat.z - p[2])
  return (
    <group position={p}>
      <mesh geometry={res.column} material={marble} castShadow receiveShadow />
      <GlbProp id="marble-bust" position={[0, 1.26, 0]} rotationY={look} />
    </group>
  )
}

function ScrollBasket() {
  const { p, rot } = at('basket', 0)
  const res = useMemo(() => {
    const scroll = new CylinderGeometry(0.026, 0.026, 0.27, 10)
    scroll.rotateZ(Math.PI / 2)
    const mat = new MeshStandardMaterial({ color: '#dccaa0', roughness: 0.85 })
    const rand = rng(31)
    // The seven scrolls merged into one mesh (one draw call).
    const m = new Matrix4()
    const parts = Array.from({ length: 7 }, (_, i) => {
      const p = new Vector3((rand() - 0.5) * 0.05, 0.05 + (i > 3 ? 0.045 : 0), -0.1 + (i % 4) * 0.055)
      m.makeRotationY((rand() - 0.5) * 0.3).setPosition(p)
      return scroll.clone().applyMatrix4(m)
    })
    const scrolls = mergeGeometries(parts, false)!
    parts.forEach((g) => g.dispose())
    scroll.dispose()
    return { scrolls, mat }
  }, [])
  useEffect(
    () => () => {
      res.scrolls.dispose()
      res.mat.dispose()
    },
    [res],
  )
  if (!hasModel('wicker-basket')) return null
  return (
    <group position={p} rotation={[0, rot, 0]}>
      <GlbProp id="wicker-basket" position={[0, 0, 0]} />
      <mesh geometry={res.scrolls} material={res.mat} castShadow />
    </group>
  )
}

export function StudyDecor() {
  const chair = at('chair', -0.02)
  const jug = at('jug', -0.01)
  const bowl = at('lamp', TABLE_TOP)
  // A bowl of pomegranates at the far corner of the table.
  const c = Math.cos(PERGOLA.rotY)
  const s = Math.sin(PERGOLA.rotY)
  const t = PERGOLA.table
  const bx = t.x + -0.42 * c + -0.22 * s
  const bz = t.z - -0.42 * s + -0.22 * c
  return (
    <group>
      <Lamp />
      <CullGroup center={STUDY_CENTER} radius={3} far={STUDY_FAR}>
      <Clepsydra />
      <BustColumn />
      <ScrollBasket />
      <GlbProp id="wicker-chair" position={chair.p} rotationY={chair.rot} />
      <GlbProp id="jug-cup" position={jug.p} rotationY={jug.rot} />
      {hasModel('wooden-bowl') && (
        <group position={[bx, bowl.p[1], bz]}>
          <GlbProp id="wooden-bowl" position={[0, 0, 0]} />
          <GlbProp id="pomegranate" position={[0.01, 0.035, 0]} scale={0.8} />
          <GlbProp id="pomegranate" position={[-0.035, 0.05, 0.02]} rotation={[0.4, 1, 0]} scale={0.75} />
        </group>
      )}
      {/* Water for the clock. */}
      {(() => {
        const q = studyPlaced('clepsydra')
        const ox = q.x + Math.cos(q.rotY) * 0.45
        const oz = q.z - Math.sin(q.rotY) * 0.45
        return <GlbProp id="wooden-bucket" position={[ox, terrainHeight(ox, oz) - 0.01, oz]} rotationY={1.2} />
      })()}
      </CullGroup>
    </group>
  )
}
