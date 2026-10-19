import { Suspense, useEffect } from 'react'
import { Seneca } from '../characters/Seneca'
import { AmbientLife } from '../life/AmbientLife'
import { game } from '../store'
import { Distant } from './Distant'
import { Bay } from './Bay'
import { Garden } from './Garden'
import { Grass } from './Grass'
import { Flowers } from './Flowers'
import { Fruits } from './Fruits'
import { HeldItem } from '../player/HeldItem'
import { Grounds } from './Grounds'
import { LodDriver } from './lod'
import { StaticBatch } from './staticBatch'
import { OpenScatter } from './OpenScatter'
import { Peristyle } from './Peristyle'
import { StudyDecor } from './StudyDecor'
import { WalkDecor } from './WalkDecor'
import { TerraceDecor } from './TerraceDecor'
import { Props } from './Props'
import { Sea } from './Sea'
import { Shore } from './Shore'
import { SkyAndLight } from './SkyAndLight'
import { Terrain } from './Terrain'
import { Vegetation } from './Vegetation'
import { Villa } from './Villa'
import { XRHud } from '../xr/XRHud'
import { XRSupport } from '../xr/XRSupport'

/** Marks the scene as loaded once everything above it has resolved. */
function Ready() {
  useEffect(() => {
    game().setLoading({ done: true, label: '' })
  }, [])
  return null
}

export function World() {
  return (
    <>
      <SkyAndLight />
      <LodDriver />
      <XRSupport />
      <XRHud />
      <Suspense fallback={null}>
        <Terrain />
        <Sea />
        <Shore />
        <Distant />
        <Bay />
        <Villa />
        <StaticBatch />
        <Garden />
        <Grounds />
        <TerraceDecor />
        <Peristyle />
        <WalkDecor />
        <StudyDecor />
        <Flowers />
        <OpenScatter />
        <Vegetation />
        <AmbientLife />
        <Grass />
        <Props />
        <Fruits />
        <Ready />
      </Suspense>
      <Seneca />
      <HeldItem />
    </>
  )
}
