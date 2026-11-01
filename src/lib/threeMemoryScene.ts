import * as THREE from "three";
import type { CoreNode, SceneState } from "../components/immersive/demoData";

/** Demand-rendered scene: scroll, resize and pointer changes invalidate; idle/offscreen does not render. */
export function createMemoryScene(
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
    powerPreference: "low-power",
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
  renderer.setClearColor(0x10141d, 0);
  host.appendChild(renderer.domElement);
  renderer.domElement.setAttribute("aria-hidden", "true");
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 50);
  const world = new THREE.Group();
  scene.add(world);
  scene.add(new THREE.AmbientLight(0xffffff, 2));
  const light = new THREE.DirectionalLight(0xdbe5ff, 3);
  light.position.set(3, 5, 5);
  scene.add(light);
  const core = new THREE.Group();
  world.add(core);
  const geometries: THREE.BufferGeometry[] = [];
  const materials: THREE.Material[] = [];
  const textures: THREE.Texture[] = [];
  const box = new THREE.BoxGeometry(1.18, 0.16, 1.18);
  geometries.push(box);
  for (let i = 0; i < 5; i++) {
    const material = new THREE.MeshStandardMaterial({
      color: i === 2 ? 0x3158c9 : 0xd2dfef,
      roughness: 0.45,
      metalness: 0.18,
    });
    materials.push(material);
    const plate = new THREE.Mesh(box, material);
    plate.position.y = (i - 2) * 0.24;
    core.add(plate);
  }
  core.rotation.set(0.22, 0.65, 0);
  const ring = new THREE.Group();
  world.add(ring);
  const sphere = new THREE.IcosahedronGeometry(0.18, 1);
  geometries.push(sphere);
  const projectShape = new THREE.OctahedronGeometry(0.22);
  geometries.push(projectShape);
  const card = new THREE.BoxGeometry(0.34, 0.25, 0.05);
  geometries.push(card);
  const pickables: THREE.Mesh[] = [];
  const entries: {
    node: CoreNode;
    mesh: THREE.Mesh;
    label: THREE.Sprite;
    angle: number;
    line: THREE.Line;
    dot: THREE.Mesh;
  }[] = [];
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
    const labelMat = new THREE.SpriteMaterial({
      map: texture,
      depthTest: false,
    });
    materials.push(labelMat);
    const label = new THREE.Sprite(labelMat);
    label.scale.set(1.7, 0.4, 1);
    ring.add(label);
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
    const dotMat = new THREE.MeshBasicMaterial({ color: 0xafc5ef });
    materials.push(dotMat);
    const dot = new THREE.Mesh(sphere, dotMat);
    dot.scale.setScalar(0.23);
    ring.add(dot);
    entries.push({ node, mesh, label, angle, line, dot });
  });
  let state = initial,
    progress = 0,
    visible = true,
    disposed = false,
    frame = 0,
    yaw = 0,
    pitch = 0;
  const draw = () => {
    frame = 0;
    if (!visible || disposed) return;
    world.rotation.set(pitch, yaw, 0);
    ring.rotation.y = (progress - 0.5) * 0.9;
    const zoomArc = Math.sin(Math.PI * progress) * 2.3;
    camera.position.set(0, 1.2, Math.max(3.1, 7.2 - state.zoom - zoomArc));
    camera.lookAt(0, 0, 0);
    core.rotation.y = 0.65 + progress * 0.45;
    entries.forEach(({ node, mesh, label, angle, line, dot }, index) => {
      const radius = 2.3 - Math.sin(progress * Math.PI) * 0.65;
      mesh.position.set(
        Math.cos(angle) * radius,
        Math.sin(angle) * 1.1,
        Math.sin(angle) * radius * 0.6,
      );
      mesh.scale.setScalar(node.id === state.selected ? 1.5 : 1);
      const shown =
        node.kind !== "memory" ||
        node.detail.includes(state.project) ||
        node.detail.includes("Global");
      mesh.visible = label.visible = line.visible = dot.visible = shown;
      label.position.copy(mesh.position).add(new THREE.Vector3(0, 0.32, 0));
      const attribute = line.geometry.getAttribute(
        "position",
      ) as THREE.BufferAttribute;
      attribute.setXYZ(1, mesh.position.x, mesh.position.y, mesh.position.z);
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
    return ray.intersectObjects(pickables.filter((mesh) => mesh.visible))[0]
      ?.object.userData.id as string | undefined;
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
  const cancel = () => {
    drag = null;
    hover("");
  };
  const lost = (e: Event) => {
    e.preventDefault();
    failed();
  };
  renderer.domElement.addEventListener("pointerdown", down);
  renderer.domElement.addEventListener("pointermove", move);
  renderer.domElement.addEventListener("pointerup", up);
  renderer.domElement.addEventListener("pointercancel", cancel);
  renderer.domElement.addEventListener("webglcontextlost", lost);
  invalidate();
  return {
    update(next: SceneState) {
      if (next.reset !== state.reset) {
        yaw = 0;
        pitch = 0;
      }
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
