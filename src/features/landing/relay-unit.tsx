import { useEffect, useRef } from 'react'
import {
  BoxGeometry,
  CanvasTexture,
  CircleGeometry,
  Color,
  DirectionalLight,
  Group,
  HemisphereLight,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  Scene,
  SRGBColorSpace,
  Vector3,
  WebGLRenderer,
  type BufferGeometry,
  type Material,
} from 'three'
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js'
import { PACKET_TRAVEL_MS, UNIT_CHANNELS, UNIT_COLS, UNIT_ROWS, type Launch } from './demo-feed'

/**
 * The landing page's one 3D scene: a small matte diorama. A shop on the left, a cable across the base, and the
 * relay unit on the right. Orders leave the shop as flat packets, travel the cable, and light a lamp on the unit.
 * Matte on purpose: rough materials, flat lamps and packets, no glow, so it reads as a manufactured object.
 * Rendering stops when the scene is off screen or the tab is hidden, and is on-demand with reduced motion.
 */

// Unit (a standing panel)
const BODY_W = 5.6
const BODY_H = 3.15
const BODY_D = 0.42
const PITCH = 0.61
const CELL = 0.4
const UNIT_X = 1.45
const UNIT_Z = -0.7

// Base, shop and cable
const SLAB_W = 10.4
const SLAB_D = 5.2
const SLAB_H = 0.3
const SHOP_X = -3.7
const SHOP_Z = 0.5
const CABLE_Z = 1.15
const CABLE_Y = 0.02

const HOUSING = new Color('#2b2f2c')
const SLAB = new Color('#343935')
const SHOP_BODY = new Color('#3b403c')
const SHOP_ROOF = new Color('#2f3430')
const RECESS = new Color('#101211')
const LAMP_OFF = new Color('#2c312e')
const LAMP_ON = new Color('#4fd18b')
const CABLE = new Color('#5a625b')

const FONT = '500 36px "Geist Mono Variable", ui-monospace, monospace'
const BASE_FONT = '500 46px "Geist Mono Variable", ui-monospace, monospace'

/** Engraved legends on the unit's face. */
function paintUnitLegends(canvas: HTMLCanvasElement) {
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  const w = canvas.width
  const h = canvas.height
  const px = w / BODY_W // canvas pixels per world unit
  ctx.clearRect(0, 0, w, h)
  ctx.fillStyle = '#a3aba2'
  ctx.textBaseline = 'middle'
  ctx.font = FONT
  ctx.textAlign = 'left'
  ctx.fillText('RELAY UNIT 01', 0.3 * px, 0.28 * px)
  ctx.textAlign = 'right'
  ctx.fillText('SAMPLE FEED', w - 0.3 * px, h - 0.24 * px)
}

/** Flat legends printed on the base: what the shop is and what travels the cable. */
function paintBaseLegends(canvas: HTMLCanvasElement) {
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  const w = canvas.width
  const h = canvas.height
  ctx.clearRect(0, 0, w, h)
  ctx.fillStyle = '#a3aba2'
  ctx.textBaseline = 'middle'
  ctx.font = BASE_FONT
  ctx.textAlign = 'center'
  const at = (x: number, z: number): [number, number] => [((x + SLAB_W / 2) / SLAB_W) * w, ((z + SLAB_D / 2) / SLAB_D) * h]
  ctx.fillText('YOUR SHOP', ...at(SHOP_X, SHOP_Z + 1.75))
  ctx.fillText('ONE WEBHOOK PER ORDER', ...at(-0.6, CABLE_Z + 0.5))
}

function makeTexture(width: number, height: number, paint: (c: HTMLCanvasElement) => void): CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  paint(canvas)
  const texture = new CanvasTexture(canvas)
  texture.colorSpace = SRGBColorSpace
  texture.anisotropy = 4
  return texture
}

// The cable's path, shared by the strip geometry and the packets.
const PATH = [new Vector3(SHOP_X + 1.05, CABLE_Y, CABLE_Z), new Vector3(UNIT_X, CABLE_Y, CABLE_Z), new Vector3(UNIT_X, CABLE_Y, UNIT_Z + BODY_D / 2 + 0.1)]
const SEGMENTS = PATH.slice(1).map((p, i) => ({ from: PATH[i], to: p, length: PATH[i].distanceTo(p) }))
const PATH_LENGTH = SEGMENTS.reduce((sum, s) => sum + s.length, 0)
const FIRST_LEG = SEGMENTS[0].length / PATH_LENGTH

function pointOnPath(t: number, out: Vector3): Vector3 {
  let d = Math.min(Math.max(t, 0), 1) * PATH_LENGTH
  for (const seg of SEGMENTS) {
    if (d <= seg.length) return out.lerpVectors(seg.from, seg.to, d / seg.length)
    d -= seg.length
  }
  return out.copy(PATH[PATH.length - 1])
}

interface Props {
  lit: ReadonlySet<number>
  /** The packet the shop has just sent; each new value launches one packet. */
  launch: Launch | null
  reducedMotion: boolean
  /** Called when WebGL cannot start, so the page can show the flat version of the same scene. */
  onUnavailable: () => void
}

export default function RelayScene({ lit, launch, reducedMotion, onUnavailable }: Props) {
  const hostRef = useRef<HTMLDivElement>(null)
  const litRef = useRef(lit)
  const launchesRef = useRef<number[]>([])
  const redrawRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    litRef.current = lit
    // With reduced motion there is no frame loop, so a new lamp state asks for one frame.
    redrawRef.current?.()
  }, [lit])

  useEffect(() => {
    if (launch && !reducedMotion) launchesRef.current.push(performance.now())
  }, [launch, reducedMotion])

  useEffect(() => {
    const host = hostRef.current
    if (!host) return

    let renderer: WebGLRenderer
    try {
      renderer = new WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'low-power' })
    } catch {
      onUnavailable()
      return
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, window.matchMedia('(pointer: coarse)').matches ? 1.5 : 2))
    renderer.shadowMap.enabled = true
    // Nothing that casts a shadow moves (the camera orbits instead of the scene turning), so the map is built once.
    renderer.shadowMap.autoUpdate = false
    renderer.shadowMap.needsUpdate = true
    renderer.domElement.setAttribute('aria-hidden', 'true')
    renderer.domElement.style.display = 'block'
    host.appendChild(renderer.domElement)

    const disposables: { dispose: () => void }[] = []
    const track = <T extends BufferGeometry | Material | CanvasTexture>(item: T): T => {
      disposables.push(item)
      return item
    }
    const solid = (color: Color) => track(new MeshStandardMaterial({ color, roughness: 0.94, metalness: 0 }))
    const add = (parent: Group, geometry: BufferGeometry, material: Material, x: number, y: number, z: number, cast = true) => {
      const mesh = new Mesh(geometry, material)
      mesh.position.set(x, y, z)
      mesh.castShadow = cast
      mesh.receiveShadow = true
      parent.add(mesh)
      return mesh
    }

    const scene = new Scene()
    const camera = new PerspectiveCamera(26, 1, 0.1, 80)
    scene.add(new HemisphereLight(0xffffff, 0x1a221c, 1.0))
    const key = new DirectionalLight(0xffffff, 2.0)
    key.position.set(-5, 8, 6)
    key.castShadow = true
    key.shadow.mapSize.set(1024, 1024)
    key.shadow.camera.left = -8
    key.shadow.camera.right = 8
    key.shadow.camera.top = 6
    key.shadow.camera.bottom = -6
    key.shadow.bias = -0.0006
    key.shadow.radius = 5
    scene.add(key)
    const rim = new DirectionalLight(0xffffff, 0.9)
    rim.position.set(4, 5, -6)
    scene.add(rim)

    const world = new Group()
    scene.add(world)

    // Base
    add(world, track(new RoundedBoxGeometry(SLAB_W, SLAB_H, SLAB_D, 4, 0.1)), solid(SLAB), 0, -SLAB_H / 2, 0, false)
    const baseLegends = track(makeTexture(1368, 624, paintBaseLegends))
    const legendPlane = new Mesh(track(new PlaneGeometry(SLAB_W, SLAB_D)), track(new MeshBasicMaterial({ map: baseLegends, transparent: true })))
    legendPlane.rotation.x = -Math.PI / 2
    legendPlane.position.y = 0.003
    world.add(legendPlane)

    // Cable: flat strips along the path
    const cableMaterial = solid(CABLE)
    for (const seg of SEGMENTS) {
      const alongX = Math.abs(seg.to.x - seg.from.x) > 1e-6
      const geometry = track(new BoxGeometry(alongX ? seg.length + 0.1 : 0.1, 0.035, alongX ? 0.1 : seg.length + 0.1))
      add(world, geometry, cableMaterial, (seg.from.x + seg.to.x) / 2, CABLE_Y - 0.002, (seg.from.z + seg.to.z) / 2, false)
    }

    // Shop: a plain storefront with an awning, door, window and one "connected" lamp
    const shop = new Group()
    shop.position.set(SHOP_X, 0, SHOP_Z)
    world.add(shop)
    add(shop, track(new RoundedBoxGeometry(2.0, 1.15, 1.4, 3, 0.05)), solid(SHOP_BODY), 0, 0.575, 0)
    add(shop, track(new RoundedBoxGeometry(2.2, 0.12, 1.6, 2, 0.04)), solid(SHOP_ROOF), 0, 1.21, 0)
    const awning = add(shop, track(new BoxGeometry(2.0, 0.07, 0.5)), solid(new Color('#4a514b')), 0, 0.98, 0.82)
    awning.rotation.x = 0.4
    const recess = solid(RECESS)
    add(shop, track(new BoxGeometry(0.42, 0.78, 0.04)), recess, 0.5, 0.39, 0.71, false)
    add(shop, track(new BoxGeometry(0.72, 0.4, 0.04)), recess, -0.45, 0.62, 0.71, false)
    const online = new Mesh(track(new CircleGeometry(0.055, 24)), track(new MeshBasicMaterial({ color: LAMP_ON })))
    online.position.set(0.5, 0.62, 0.737)
    shop.add(online)

    // Unit: a standing panel with a grid of channel lamps
    const unit = new Group()
    unit.position.set(UNIT_X, BODY_H / 2, UNIT_Z)
    world.add(unit)
    add(unit, track(new RoundedBoxGeometry(BODY_W, BODY_H, BODY_D, 5, 0.13)), solid(HOUSING), 0, 0, 0)
    const front = BODY_D / 2
    const unitLegends = track(makeTexture(1120, 630, paintUnitLegends))
    const unitPlane = new Mesh(track(new PlaneGeometry(BODY_W, BODY_H)), track(new MeshBasicMaterial({ map: unitLegends, transparent: true })))
    unitPlane.position.z = front + 0.002
    unit.add(unitPlane)
    const recessGeometry = track(new RoundedBoxGeometry(CELL, CELL, 0.05, 3, 0.05))
    const lampGeometry = track(new CircleGeometry(0.095, 32))
    const lamps: { material: MeshBasicMaterial; level: number }[] = []
    for (let i = 0; i < UNIT_CHANNELS; i += 1) {
      const col = i % UNIT_COLS
      const row = Math.floor(i / UNIT_COLS)
      const x = (col - (UNIT_COLS - 1) / 2) * PITCH
      const y = ((UNIT_ROWS - 1) / 2 - row) * PITCH - 0.08
      add(unit, recessGeometry, recess, x, y, front + 0.008, false)
      const material = track(new MeshBasicMaterial({ color: LAMP_OFF }))
      const lamp = new Mesh(lampGeometry, material)
      lamp.position.set(x, y, front + 0.036)
      unit.add(lamp)
      lamps.push({ material, level: 0 })
    }

    // Packets: flat parcels that ride the cable and are taken in at the unit's base
    const packetGeometry = track(new RoundedBoxGeometry(0.3, 0.13, 0.18, 2, 0.04))
    const packetMaterial = track(new MeshBasicMaterial({ color: LAMP_ON }))
    const packets: { mesh: Mesh; start: number }[] = []
    const spot = new Vector3()

    const REST_YAW = -0.1
    const REST_PITCH = 0
    const target = { yaw: REST_YAW, pitch: REST_PITCH }
    const current = { yaw: REST_YAW, pitch: REST_PITCH }
    const LOOK = new Vector3(0, 1.0, 0)
    const BASE_PITCH = 0.4
    let camDist = 20
    const placeCamera = () => {
      const az = -current.yaw
      const el = BASE_PITCH + current.pitch
      camera.position.set(LOOK.x + camDist * Math.cos(el) * Math.sin(az), LOOK.y + camDist * Math.sin(el), LOOK.z + camDist * Math.cos(el) * Math.cos(az))
      camera.lookAt(LOOK)
    }

    const size = () => {
      const w = Math.max(host.clientWidth, 1)
      const h = Math.max(host.clientHeight, 1)
      renderer.setSize(w, h, false)
      renderer.domElement.style.width = '100%'
      renderer.domElement.style.height = '100%'
      camera.aspect = w / h
      const vertical = Math.tan((camera.fov * Math.PI) / 360)
      const fitW = (SLAB_W * 0.62) / (vertical * camera.aspect)
      const fitH = 3.0 / vertical
      camDist = Math.max(fitW, fitH)
      placeCamera()
      camera.updateProjectionMatrix()
    }

    const lampColor = new Color()
    const draw = (animate: boolean, now: number) => {
      const wanted = litRef.current
      for (let i = 0; i < lamps.length; i += 1) {
        const lamp = lamps[i]
        const goal = wanted.has(i) ? 1 : 0
        if (!animate) lamp.level = goal
        else lamp.level += (goal - lamp.level) * (goal > lamp.level ? 0.45 : 0.045)
        lamp.material.color.copy(lampColor.copy(LAMP_OFF).lerp(LAMP_ON, lamp.level))
      }

      if (animate) {
        while (launchesRef.current.length) {
          const mesh = new Mesh(packetGeometry, packetMaterial)
          world.add(mesh)
          packets.push({ mesh, start: launchesRef.current.shift() as number })
        }
        for (let i = packets.length - 1; i >= 0; i -= 1) {
          const p = packets[i]
          const t = (now - p.start) / PACKET_TRAVEL_MS
          if (t >= 1) {
            world.remove(p.mesh)
            packets.splice(i, 1)
            continue
          }
          pointOnPath(t, spot)
          p.mesh.position.set(spot.x, spot.y + 0.09, spot.z)
          // On the last leg the packet turns to face the unit, and shrinks as it is taken in.
          p.mesh.rotation.y = t > FIRST_LEG ? Math.PI / 2 : 0
          p.mesh.scale.setScalar(t > 0.94 ? Math.max((1 - t) / 0.06, 0.01) : 1)
        }
      }

      if (animate) {
        if (pointer) {
          const rect = host.getBoundingClientRect()
          const px = (pointer.x - rect.left) / rect.width - 0.5
          const py = (pointer.y - rect.top) / rect.height - 0.5
          target.yaw = REST_YAW + Math.max(-1, Math.min(1, px * 2)) * 0.16
          target.pitch = REST_PITCH + Math.max(-1, Math.min(1, py * 2)) * 0.05
        } else {
          target.yaw = REST_YAW
          target.pitch = REST_PITCH
        }
      }
      current.yaw += (target.yaw - current.yaw) * 0.07
      current.pitch += (target.pitch - current.pitch) * 0.07
      placeCamera()
      renderer.render(scene, camera)
    }

    let frame = 0
    let visible = true
    let pageVisible = document.visibilityState === 'visible'
    const loop = () => {
      draw(true, performance.now())
      frame = requestAnimationFrame(loop)
    }
    const syncLoop = () => {
      cancelAnimationFrame(frame)
      frame = 0
      if (!reducedMotion && visible && pageVisible) frame = requestAnimationFrame(loop)
    }

    // The pointer only records where it is; the frame loop reads the layout once per frame instead of once per event.
    let pointer: { x: number; y: number } | null = null
    const onPointer = (e: PointerEvent) => {
      pointer = { x: e.clientX, y: e.clientY }
    }
    const onLeave = () => {
      pointer = null
    }
    const onContextLost = (e: Event) => {
      e.preventDefault()
      onUnavailable()
    }
    renderer.domElement.addEventListener('webglcontextlost', onContextLost)
    const onVisibility = () => {
      pageVisible = document.visibilityState === 'visible'
      syncLoop()
    }

    size()
    const resize = new ResizeObserver(() => {
      size()
      if (reducedMotion) draw(false, 0)
    })
    resize.observe(host)
    const io = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting
      syncLoop()
    })
    io.observe(host)
    document.addEventListener('visibilitychange', onVisibility)

    if (!reducedMotion) {
      window.addEventListener('pointermove', onPointer, { passive: true })
      host.addEventListener('pointerleave', onLeave)
    }
    redrawRef.current = reducedMotion ? () => draw(false, 0) : null

    draw(!reducedMotion, performance.now())
    syncLoop()

    // The legends use the mono face; repaint them once it has loaded so they are not drawn in a fallback font.
    let cancelled = false
    void document.fonts?.load(FONT).then(() => {
      if (cancelled) return
      paintUnitLegends(unitLegends.image as HTMLCanvasElement)
      paintBaseLegends(baseLegends.image as HTMLCanvasElement)
      unitLegends.needsUpdate = true
      baseLegends.needsUpdate = true
      if (reducedMotion) draw(false, 0)
    })

    return () => {
      cancelled = true
      cancelAnimationFrame(frame)
      resize.disconnect()
      io.disconnect()
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('pointermove', onPointer)
      host.removeEventListener('pointerleave', onLeave)
      renderer.domElement.removeEventListener('webglcontextlost', onContextLost)
      redrawRef.current = null
      disposables.forEach((d) => d.dispose())
      renderer.dispose()
      renderer.domElement.remove()
    }
  }, [reducedMotion, onUnavailable])

  return <div ref={hostRef} className="aspect-[16/9] w-full" />
}
