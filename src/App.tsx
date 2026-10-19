import { Canvas } from '@react-three/fiber'
import { useEffect, useState } from 'react'
import { ACESFilmicToneMapping, SRGBColorSpace, type WebGLRenderer } from 'three'
import { UiRoot } from './components/ui/UiRoot'
import { GameLoop } from './game/GameLoop'
import { disposeArchMaterials } from './game/materials/library'
import { World } from './game/scenes/World'
import { game, useGame } from './game/store'

const DPR: Record<string, [number, number]> = { low: [0.7, 1], medium: [1, 1.25], high: [1, 1.6] }

export default function App() {
  const quality = useGame((s) => s.settings.quality)
  const fov = useGame((s) => s.settings.fov)
  const [canvasKey, setCanvasKey] = useState(0)

  useEffect(() => () => disposeArchMaterials(), [])

  const onCreated = ({ gl }: { gl: WebGLRenderer }) => {
    gl.toneMapping = ACESFilmicToneMapping
    gl.toneMappingExposure = 0.55
    gl.outputColorSpace = SRGBColorSpace
    const canvas = gl.domElement
    canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault()
      game().setContextLost(true)
    })
    canvas.addEventListener('webglcontextrestored', () => {
      game().setContextLost(false)
      // Rebuild every GPU resource from scratch.
      disposeArchMaterials()
      setCanvasKey((k) => k + 1)
    })
  }

  return (
    <div className="app-root">
      <Canvas
        key={canvasKey}
        className="scene-canvas"
        shadows="percentage"
        dpr={DPR[quality]}
        // No multiview here: in three r186 only WebGPURenderer ({ multiview: true, forceWebGL: true }) uses
        // OVR_multiview2; WebGLRenderer's XR path renders each eye separately, and every scene material is a
        // GLSL onBeforeCompile patch that WebGPURenderer cannot run. Per-eye cost is cut by the 'low' preset.
        gl={{ antialias: true, powerPreference: 'high-performance', stencil: false }}
        camera={{ fov, near: 0.1, far: 9500, position: [0, 1.7, 14] }}
        onCreated={onCreated}
      >
        <World />
        <GameLoop />
      </Canvas>
      <UiRoot />
    </div>
  )
}
