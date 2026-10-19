import {
  Color,
  DynamicDrawUsage,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  MeshBasicMaterial,
  PlaneGeometry,
  type Sphere,
  type Texture,
} from 'three'

/**
 * Camera-facing smoke puffs in ONE draw call (instead of one Sprite each):
 * an instanced quad turned to the view in the vertex shader, with a
 * per-instance opacity. Puffs are not sorted among themselves — they are
 * soft, similar in colour and depth-write free, so the order does not show.
 */
export class Puffs {
  readonly mesh: InstancedMesh
  readonly material: MeshBasicMaterial
  private readonly alpha: InstancedBufferAttribute
  private readonly m = new Matrix4()

  constructor(count: number, map: Texture, color: string, bounds: Sphere) {
    const geo = new PlaneGeometry(1, 1)
    this.alpha = new InstancedBufferAttribute(new Float32Array(count), 1)
    this.alpha.setUsage(DynamicDrawUsage)
    geo.setAttribute('aAlpha', this.alpha)
    const mat = new MeshBasicMaterial({ map, color: new Color(color), transparent: true, depthWrite: false })
    mat.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nattribute float aAlpha;\nvarying float vAlpha;')
        .replace(
          '#include <project_vertex>',
          `vAlpha = aAlpha;
vec4 mvPosition = modelViewMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
mvPosition.xy += transformed.xy * length(instanceMatrix[0].xyz);
gl_Position = projectionMatrix * mvPosition;`,
        )
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying float vAlpha;')
        .replace('#include <map_fragment>', '#include <map_fragment>\ndiffuseColor.a *= vAlpha;')
    }
    mat.customProgramCacheKey = () => 'puffs'
    this.material = mat
    this.mesh = new InstancedMesh(geo, mat, count)
    this.mesh.instanceMatrix.setUsage(DynamicDrawUsage)
    // Fixed bounds covering every puff's path (no per-frame recompute).
    this.mesh.boundingSphere = bounds
  }

  /** Place puff i (centre, size in metres, opacity). */
  set(i: number, x: number, y: number, z: number, size: number, opacity: number) {
    this.m.makeScale(size, size, size).setPosition(x, y, z)
    this.mesh.setMatrixAt(i, this.m)
    this.alpha.setX(i, opacity)
  }

  /** Call once per frame after the `set`s. */
  commit() {
    this.mesh.instanceMatrix.needsUpdate = true
    this.alpha.needsUpdate = true
  }

  dispose() {
    this.mesh.geometry.dispose()
    this.material.dispose()
    this.mesh.dispose()
  }
}
