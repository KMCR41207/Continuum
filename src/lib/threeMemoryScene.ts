import type * as THREE_TYPES from "three";
import type { CoreNode, SceneState } from "../components/immersive/demoData";

/** Loads a GLB from a URL using Three.js GLTFLoader. */
async function loadGlb(
  THREE: typeof THREE_TYPES,
  url: string,
): Promise<THREE_TYPES.Group> {
  // @ts-ignore — three/addons is a valid package export path at runtime
  const { GLTFLoader } = await import("three/addons/loaders/GLTFLoader.js");
  return new Promise((resolve, reject) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    new (GLTFLoader as any)().load(url, (gltf: any) => resolve(gltf.scene), undefined, reject);
  });
}

/** Demand-rendered scene: scroll, resize and pointer changes invalidate; idle/offscreen does not render. */
export function createMemoryScene(
  host: HTMLElement,
  nodes: CoreNode[],
  initial: SceneState,
  select: (id: string) => void,
  hover: (label: string) => void,
  failed: () => void,
) {
  // All Three.js work is deferred into an async IIFE so the module itself
  // does NOT statically import three — keeping it out of the main bundle.
  let disposed = false;
  const api = {
    update(_next: SceneState) { pendingState = _next; resolved?.update(_next); },
    progress(_value: number) { pendingProgress = _value; resolved?.progress(_value); },
    dispose() {
      disposed = true;
      resolved?.dispose();
    },
  };

  let resolved: ReturnType<typeof buildScene> | null = null;
  let pendingState = initial;
  let pendingProgress = 0;

  (async () => {
    const THREE = await import("three");
    if (disposed) return;
    resolved = buildScene(THREE, host, nodes, pendingState, select, hover, failed);
    resolved.progress(pendingProgress);
  })().catch(() => failed());

  return api;
}

type THREEModule = typeof THREE_TYPES;

function buildScene(
  THREE: THREEModule,
  host: HTMLElement,
  nodes: CoreNode[],
  initial: SceneState,
  select: (id: string) => void,
  hover: (label: string) => void,
  failed: () => void,
) {
  const renderer = new THREE.WebGLRenderer({
    alpha: true,
    antialias: true,
    powerPreference: "high-performance",
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2.5));
  renderer.setClearColor(0x10141d, 0);
  host.appendChild(renderer.domElement);
  renderer.domElement.setAttribute("aria-hidden", "true");
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 50);
  const world = new THREE.Group();
  scene.add(world);
  scene.add(new THREE.AmbientLight(0xffffff, 2.2));
  const light = new THREE.DirectionalLight(0xdbe5ff, 3);
  light.position.set(3, 5, 5);
  scene.add(light);
  const fillLight = new THREE.PointLight(0x4070ff, 1.2, 12);
  fillLight.position.set(-3, 2, -2);
  scene.add(fillLight);

  const core = new THREE.Group();
  world.add(core);
  const geometries: THREE_TYPES.BufferGeometry[] = [];
  const materials: THREE_TYPES.Material[] = [];
  const textures: THREE_TYPES.Texture[] = [];

  // --- Procedural fallback core (stacked plates) — hidden once GLB loads ---
  const box = new THREE.BoxGeometry(1.18, 0.16, 1.18, 2, 1, 2);
  geometries.push(box);
  const coreFallback = new THREE.Group();
  for (let i = 0; i < 5; i++) {
    const material = new THREE.MeshStandardMaterial({
      color: i === 2 ? 0x3158c9 : 0xd2dfef,
      roughness: 0.45,
      metalness: 0.18,
    });
    materials.push(material);
    const plate = new THREE.Mesh(box, material);
    plate.position.y = (i - 2) * 0.24;
    coreFallback.add(plate);
  }
  core.add(coreFallback);
  core.rotation.set(0.22, 0.65, 0);

  // --- Async: load core.glb ---
  let coreGlb: THREE_TYPES.Group | null = null;
  loadGlb(THREE, "/models/core.glb")
    .then((glb) => {
      const box3 = new THREE.Box3().setFromObject(glb);
      const size = new THREE.Vector3();
      box3.getSize(size);
      const scale = 1.1 / Math.max(size.x, size.y, size.z);
      glb.scale.setScalar(scale);
      glb.position.y = -0.1;
      coreGlb = glb;
      core.add(glb);
      coreFallback.visible = false;
      invalidate();
    })
    .catch(() => { /* keep fallback visible */ });

  const ring = new THREE.Group();
  world.add(ring);

  // Shared procedural geometries for non-GLB nodes
  const sphere = new THREE.IcosahedronGeometry(0.18, 3);
  geometries.push(sphere);
  const projectShape = new THREE.OctahedronGeometry(0.22, 2);
  geometries.push(projectShape);
  const card = new THREE.BoxGeometry(0.34, 0.25, 0.05, 2, 2, 1);
  geometries.push(card);

  const pickables: THREE_TYPES.Mesh[] = [];
  const entries: {
    node: CoreNode;
    mesh: THREE_TYPES.Mesh;
    glbRoot: THREE_TYPES.Group | null;
    label: THREE_TYPES.Sprite;
    angle: number;
    line: THREE_TYPES.Line;
    dot: THREE_TYPES.Mesh;
  }[] = [];

  // Agent GLB paths — only chatgpt and claude get real models
  const agentGlbPaths: Record<string, string> = {
    chatgpt: "/models/chatgpt.glb",
    claude: "/models/claude.glb",
  };

  nodes.forEach((node, index) => {
    const angle = (index / nodes.length) * Math.PI * 2;
    const mat = new THREE.MeshStandardMaterial({
      color:
        node.kind === "agent"
          ? 0xaec4e8
          : node.kind === "memory"
            ? 0xdce2bc
            : 0xf5f5f1,
      roughness: 0.7,
    });
    materials.push(mat);
    const mesh = new THREE.Mesh(
      node.kind === "agent"
        ? sphere
        : node.kind === "project"
          ? projectShape
          : card,
      mat,
    );
    mesh.userData.id = node.id;
    ring.add(mesh);
    pickables.push(mesh);

    // Sprite label
    const canvas = document.createElement("canvas");
    canvas.width = 384;
    canvas.height = 72;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#eef1f7";
    ctx.textAlign = "center";
    ctx.font = "32px Arial";
    ctx.fillText(node.label, 192, 44);
    const texture = new THREE.CanvasTexture(canvas);
    textures.push(texture);
    const labelMat = new THREE.SpriteMaterial({ map: texture, depthTest: false });
    materials.push(labelMat);
    const label = new THREE.Sprite(labelMat);
    label.scale.set(1.7, 0.4, 1);
    ring.add(label);

    // Connection line
    const geometry = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(),
      new THREE.Vector3(),
    ]);
    geometries.push(geometry);
    const lineMat = new THREE.LineBasicMaterial({
      color: 0x627b9b,
      transparent: true,
      opacity: 0.7,
    });
    materials.push(lineMat);
    const line = new THREE.Line(geometry, lineMat);
    ring.add(line);

    // Animated dot
    const dotMat = new THREE.MeshBasicMaterial({ color: 0xafc5ef });
    materials.push(dotMat);
    const dot = new THREE.Mesh(sphere, dotMat);
    dot.scale.setScalar(0.23);
    ring.add(dot);

    let glbRoot: THREE_TYPES.Group | null = null;

    // Load GLB for agents that have one
    if (node.kind === "agent" && agentGlbPaths[node.id]) {
      const capturedIndex = index;
      loadGlb(THREE, agentGlbPaths[node.id])
        .then((glb) => {
          const b = new THREE.Box3().setFromObject(glb);
          const s = new THREE.Vector3();
          b.getSize(s);
          const sc = 0.36 / Math.max(s.x, s.y, s.z);
          glb.scale.setScalar(sc);
          (glb as THREE_TYPES.Group & { _baseScale?: number })._baseScale = 1;
          entries[capturedIndex].glbRoot = glb;
          ring.add(glb);
          entries[capturedIndex].mesh.visible = false;
          invalidate();
        })
        .catch(() => { /* keep procedural mesh */ });
    }

    entries.push({ node, mesh, glbRoot, label, angle, line, dot });
  });

  let state = initial,
    progress = 0,
    visible = true,
    disposed = false,
    frame = 0,
    yaw = 0,
    pitch = 0,
    clock = 0,
    lastTime = performance.now();

  const draw = () => {
    frame = 0;
    if (!visible || disposed) return;
    const now = performance.now();
    const dt = Math.min((now - lastTime) / 1000, 0.05);
    lastTime = now;
    clock += dt;

    world.rotation.set(pitch, yaw, 0);
    ring.rotation.y = (progress - 0.5) * 0.9;
    const zoomArc = Math.sin(Math.PI * progress) * 2.3;
    camera.position.set(0, 1.2, Math.max(3.1, 7.2 - state.zoom - zoomArc));
    camera.lookAt(0, 0, 0);

    // Core model gentle idle rotation
    if (coreGlb) {
      coreGlb.rotation.y = clock * 0.4;
    } else {
      core.rotation.y = 0.65 + progress * 0.45;
    }

    entries.forEach(({ node, mesh, glbRoot, label, angle, line, dot }, index) => {
      const radius = 2.3 - Math.sin(progress * Math.PI) * 0.65;
      const px = Math.cos(angle) * radius;
      const py = Math.sin(angle) * 1.1;
      const pz = Math.sin(angle) * radius * 0.6;

      mesh.position.set(px, py, pz);
      const scaleFactor = node.id === state.selected ? 1.5 : 1;
      mesh.scale.setScalar(scaleFactor);

      const shown =
        node.kind !== "memory" ||
        node.detail.includes(state.project) ||
        node.detail.includes("Global");

      mesh.visible = shown && !glbRoot;
      label.visible = line.visible = dot.visible = shown;

      // Position GLB at same spot, with gentle bob
      if (glbRoot) {
        glbRoot.position.set(px, py + Math.sin(clock * 1.2 + angle) * 0.05, pz);
        glbRoot.rotation.y = clock * 0.6 + angle;
        if (!(glbRoot as THREE_TYPES.Group & { _baseScale?: number })._baseScale) {
          const b = new THREE.Box3().setFromObject(glbRoot);
          const s = new THREE.Vector3(); b.getSize(s);
          (glbRoot as THREE_TYPES.Group & { _baseScale?: number })._baseScale = 0.36 / Math.max(s.x, s.y, s.z);
        }
        const bs = (glbRoot as THREE_TYPES.Group & { _baseScale?: number })._baseScale!;
        glbRoot.scale.setScalar(bs * scaleFactor);
        glbRoot.visible = shown;
      }

      label.position.set(px, py + 0.32, pz);

      const attribute = line.geometry.getAttribute("position") as THREE_TYPES.BufferAttribute;
      attribute.setXYZ(1, px, py, pz);
      attribute.needsUpdate = true;
      line.geometry.computeBoundingSphere();

      const fraction = state.mode === "retrieve" ? progress : 1 - progress;
      dot.position
        .copy(mesh.position)
        .multiplyScalar((fraction + index * 0.12) % 1);
      dot.visible = shown && state.mode !== "store";
    });

    renderer.render(scene, camera);
    host.dataset.sceneReady = "true";

    // If GLB models loaded, keep ticking for smooth animations
    if (coreGlb || entries.some((e) => e.glbRoot)) {
      frame = requestAnimationFrame(draw);
    }
  };

  const invalidate = () => {
    if (!frame && visible && !disposed) frame = requestAnimationFrame(draw);
  };

  const resize = new ResizeObserver(() => {
    const { width, height } = host.getBoundingClientRect();
    renderer.setSize(width, height, false);
    camera.aspect = width / Math.max(height, 1);
    camera.updateProjectionMatrix();
    invalidate();
  });
  resize.observe(host);

  const visibility = new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting;
    host.dataset.rendering = visible ? "visible" : "paused";
    if (visible) invalidate();
    else {
      cancelAnimationFrame(frame);
      frame = 0;
    }
  });
  visibility.observe(host);

  const ray = new THREE.Raycaster(),
    pointer = new THREE.Vector2();

  const hit = (e: PointerEvent) => {
    const rect = host.getBoundingClientRect();
    pointer.set(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      (-(e.clientY - rect.top) / rect.height) * 2 + 1,
    );
    ray.setFromCamera(pointer, camera);
    const testMeshes = pickables.filter((m) => {
      const entry = entries.find((e) => e.mesh === m);
      if (!entry) return false;
      const shown = entry.node.kind !== "memory" ||
        entry.node.detail.includes(state.project) ||
        entry.node.detail.includes("Global");
      if (!shown) return false;
      if (entry.glbRoot && !m.visible) { m.visible = true; m.userData._hiddenForRay = true; }
      return true;
    });
    const result = ray.intersectObjects(testMeshes)[0]?.object.userData.id as string | undefined;
    testMeshes.forEach((m) => { if (m.userData._hiddenForRay) { m.visible = false; delete m.userData._hiddenForRay; } });
    return result;
  };

  let drag: { x: number; y: number; distance: number } | null = null;

  const down = (e: PointerEvent) => {
    if (e.button !== 0) return;
    drag = { x: e.clientX, y: e.clientY, distance: 0 };
    renderer.domElement.setPointerCapture(e.pointerId);
  };
  const move = (e: PointerEvent) => {
    if (drag) {
      const dx = e.clientX - drag.x,
        dy = e.clientY - drag.y;
      yaw += dx * 0.008;
      pitch = THREE.MathUtils.clamp(pitch + dy * 0.005, -0.6, 0.6);
      drag.distance += Math.abs(dx) + Math.abs(dy);
      drag.x = e.clientX;
      drag.y = e.clientY;
      invalidate();
    } else {
      const id = hit(e);
      hover(nodes.find((n) => n.id === id)?.label || "");
      renderer.domElement.style.cursor = id ? "pointer" : "grab";
    }
  };
  const up = (e: PointerEvent) => {
    if (drag && drag.distance < 6) {
      const id = hit(e);
      if (id) select(id);
    }
    drag = null;
    if (renderer.domElement.hasPointerCapture(e.pointerId))
      renderer.domElement.releasePointerCapture(e.pointerId);
  };
  const cancel = () => { drag = null; hover(""); };
  const lost = (e: Event) => { e.preventDefault(); failed(); };

  renderer.domElement.addEventListener("pointerdown", down);
  renderer.domElement.addEventListener("pointermove", move);
  renderer.domElement.addEventListener("pointerup", up);
  renderer.domElement.addEventListener("pointercancel", cancel);
  renderer.domElement.addEventListener("webglcontextlost", lost);
  invalidate();

  return {
    update(next: SceneState) {
      if (next.reset !== state.reset) { yaw = 0; pitch = 0; }
      state = next;
      invalidate();
    },
    progress(value: number) {
      progress = THREE.MathUtils.clamp(value, 0, 1);
      invalidate();
    },
    dispose() {
      disposed = true;
      cancelAnimationFrame(frame);
      resize.disconnect();
      visibility.disconnect();
      renderer.domElement.removeEventListener("pointerdown", down);
      renderer.domElement.removeEventListener("pointermove", move);
      renderer.domElement.removeEventListener("pointerup", up);
      renderer.domElement.removeEventListener("pointercancel", cancel);
      renderer.domElement.removeEventListener("webglcontextlost", lost);
      geometries.forEach((g) => g.dispose());
      materials.forEach((m) => m.dispose());
      textures.forEach((t) => t.dispose());
      renderer.dispose();
      renderer.forceContextLoss();
      renderer.domElement.remove();
      delete host.dataset.sceneReady;
    },
  };
}
