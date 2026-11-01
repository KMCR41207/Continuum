import { useEffect, useRef, useState, type CSSProperties } from "react";
import type * as THREE_TYPES from "three";
import { integrations } from "../../config/integrations";
import { useMotionPreference } from "../../lib/useMotionPreference";

/** Three.js + GLB orbit scene for the integrations page */
function createOrbitScene(host: HTMLElement, onSelect: (id: string) => void) {
  // Dynamic imports to keep bundle lean
  let disposed = false, frame = 0, clock = 0, lastTime = performance.now();
  let selectedId = "";

  const promise = (async () => {
    const THREE = await import("three");
    // @ts-ignore — three/addons is a valid package export path at runtime
    const { GLTFLoader } = await import("three/addons/loaders/GLTFLoader.js");

    if (disposed) return null;

    const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: "low-power" });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    renderer.setClearColor(0x000000, 0);
    host.appendChild(renderer.domElement);
    renderer.domElement.setAttribute("aria-hidden", "true");
    renderer.domElement.style.cssText = "display:block;width:100%;height:100%;touch-action:none;";

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(48, 1, 0.1, 40);
    camera.position.set(0, 1.4, 7.5);
    camera.lookAt(0, 0, 0);

    scene.add(new THREE.AmbientLight(0xffffff, 2.5));
    const key = new THREE.DirectionalLight(0xdbeaff, 3.5);
    key.position.set(4, 6, 5);
    scene.add(key);
    const fill = new THREE.PointLight(0x3158c9, 1.8, 14);
    fill.position.set(-4, 1, -3);
    scene.add(fill);
    const rim = new THREE.PointLight(0xafc5ef, 1.2, 10);
    rim.position.set(0, -3, 4);
    scene.add(rim);

    const loader = new (GLTFLoader as any)();
    const loadGlb = (url: string, targetSize: number): Promise<THREE_TYPES.Group> =>
      new Promise((res, rej) =>
        loader.load(url, (g: any) => {
          const b = new THREE.Box3().setFromObject(g.scene);
          const s = new THREE.Vector3(); b.getSize(s);
          const sc = targetSize / Math.max(s.x, s.y, s.z);
          g.scene.scale.setScalar(sc);
          res(g.scene);
        }, undefined, rej),
      );

    // --- Core model ---
    const coreGroup = new THREE.Group();
    scene.add(coreGroup);
    let coreGlb: THREE_TYPES.Group | null = null;

    // Fallback procedural core while GLB loads
    const fallbackGeo = new THREE.IcosahedronGeometry(0.7, 2);
    const fallbackMat = new THREE.MeshStandardMaterial({ color: 0x3158c9, roughness: 0.3, metalness: 0.6 });
    const fallbackMesh = new THREE.Mesh(fallbackGeo, fallbackMat);
    coreGroup.add(fallbackMesh);

    loadGlb("/models/core.glb", 1.5)
      .then((glb) => {
        coreGlb = glb;
        coreGroup.add(glb);
        fallbackMesh.visible = false;
        invalidate();
      })
      .catch(() => {});

    // Sprite label helper
    const makeLabel = (text: string): THREE_TYPES.Sprite => {
      const cv = document.createElement("canvas");
      cv.width = 512; cv.height = 80;
      const ctx = cv.getContext("2d")!;
      ctx.fillStyle = "#eef2fa";
      ctx.textAlign = "center";
      ctx.font = "bold 36px Arial";
      ctx.fillText(text, 256, 52);
      const tex = new THREE.CanvasTexture(cv);
      const mat = new THREE.SpriteMaterial({ map: tex, depthTest: false });
      const sprite = new THREE.Sprite(mat);
      sprite.scale.set(2.2, 0.44, 1);
      return sprite;
    };

    // --- Agent nodes ---
    type AgentEntry = {
      id: string;
      name: string;
      angle: number;
      glb: THREE_TYPES.Group | null;
      fallback: THREE_TYPES.Mesh;
      label: THREE_TYPES.Sprite;
      line: THREE_TYPES.Line;
      dot: THREE_TYPES.Mesh;
      pickProxy: THREE_TYPES.Mesh;
    };

    const agentDefs = [
      { id: "chatgpt",  name: "ChatGPT",  glbUrl: "/models/chatgpt.glb",  size: 0.52 },
      { id: "claude",   name: "Claude",   glbUrl: "/models/claude.glb",   size: 0.52 },
      { id: "cursor",   name: "Cursor",   glbUrl: null,                    size: 0.52 },
      { id: "codex",    name: "Codex",    glbUrl: null,                    size: 0.52 },
      { id: "gemini",   name: "Gemini",   glbUrl: null,                    size: 0.52 },
      { id: "grok",     name: "Grok",     glbUrl: null,                    size: 0.52 },
    ];

    const agentGroup = new THREE.Group();
    scene.add(agentGroup);
    const agents: AgentEntry[] = [];
    const proxyGeo = new THREE.SphereGeometry(0.38, 8, 8);

    agentDefs.forEach((def, i) => {
      const angle = (i / agentDefs.length) * Math.PI * 2;

      // Procedural fallback sphere
      const fallbackMat2 = new THREE.MeshStandardMaterial({ color: 0xaec4e8, roughness: 0.6 });
      const fallback = new THREE.Mesh(new THREE.IcosahedronGeometry(0.3, 1), fallbackMat2);
      agentGroup.add(fallback);

      // Pick proxy (invisible, always at node position for raycasting)
      const proxy = new THREE.Mesh(proxyGeo, new THREE.MeshBasicMaterial({ visible: false }));
      proxy.userData.id = def.id;
      agentGroup.add(proxy);

      const label = makeLabel(def.name);
      agentGroup.add(label);

      // Connection line
      const lineGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
      const lineMat = new THREE.LineBasicMaterial({ color: 0x3158c9, transparent: true, opacity: 0.45 });
      const line = new THREE.Line(lineGeo, lineMat);
      agentGroup.add(line);

      // Animated dot
      const dotMat = new THREE.MeshBasicMaterial({ color: 0x94adff });
      const dot = new THREE.Mesh(new THREE.SphereGeometry(0.07, 6, 6), dotMat);
      agentGroup.add(dot);

      const entry: AgentEntry = { id: def.id, name: def.name, angle, glb: null, fallback, label, line, dot, pickProxy: proxy };
      agents.push(entry);

      if (def.glbUrl) {
        loadGlb(def.glbUrl, def.size)
          .then((glb) => {
            entry.glb = glb;
            agentGroup.add(glb);
            fallback.visible = false;
            invalidate();
          })
          .catch(() => {});
      }
    });

    // Raycasting
    const ray = new THREE.Raycaster();
    const ptr = new THREE.Vector2();

    const getHit = (e: PointerEvent) => {
      const rect = host.getBoundingClientRect();
      ptr.set(((e.clientX - rect.left) / rect.width) * 2 - 1, (-(e.clientY - rect.top) / rect.height) * 2 + 1);
      ray.setFromCamera(ptr, camera);
      const proxies = agents.map((a) => a.pickProxy);
      return ray.intersectObjects(proxies)[0]?.object.userData.id as string | undefined;
    };

    let dragDist = 0, dragStart = { x: 0, y: 0 };
    const onDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      dragStart = { x: e.clientX, y: e.clientY }; dragDist = 0;
      renderer.domElement.setPointerCapture(e.pointerId);
    };
    const onMove = (e: PointerEvent) => {
      dragDist += Math.abs(e.clientX - dragStart.x) + Math.abs(e.clientY - dragStart.y);
      dragStart = { x: e.clientX, y: e.clientY };
      const id = getHit(e);
      renderer.domElement.style.cursor = id ? "pointer" : "default";
    };
    const onUp = (e: PointerEvent) => {
      if (dragDist < 6) { const id = getHit(e); if (id) { selectedId = id; onSelect(id); invalidate(); } }
      if (renderer.domElement.hasPointerCapture(e.pointerId)) renderer.domElement.releasePointerCapture(e.pointerId);
    };
    renderer.domElement.addEventListener("pointerdown", onDown);
    renderer.domElement.addEventListener("pointermove", onMove);
    renderer.domElement.addEventListener("pointerup", onUp);

    // Draw
    const ORBIT_R = 2.8;
    const draw = () => {
      frame = 0;
      if (disposed) return;
      const now = performance.now();
      clock += Math.min((now - lastTime) / 1000, 0.05);
      lastTime = now;

      // Core idle rotation
      if (coreGlb) coreGlb.rotation.y = clock * 0.35;
      else fallbackMesh.rotation.y = clock * 0.35;
      coreGroup.rotation.x = Math.sin(clock * 0.25) * 0.12;

      agents.forEach((a, i) => {
        const angle = a.angle + clock * 0.18;
        const px = Math.cos(angle) * ORBIT_R;
        const py = Math.sin(clock * 0.5 + i * 1.1) * 0.25;
        const pz = Math.sin(angle) * ORBIT_R * 0.55;
        const isSelected = a.id === selectedId;
        const baseScale = isSelected ? 1.35 : 1.0;

        // Position fallback or GLB
        if (a.glb) {
          a.glb.position.set(px, py, pz);
          a.glb.rotation.y = clock * 0.7 + i;
          // Maintain target size accounting for baseScale
          const b = new THREE.Box3().setFromObject(a.glb);
          const s = new THREE.Vector3(); b.getSize(s);
          const sc = (0.52 * baseScale) / Math.max(s.x, s.y, s.z);
          a.glb.scale.setScalar(sc);
          a.fallback.visible = false;
        } else {
          a.fallback.position.set(px, py, pz);
          a.fallback.scale.setScalar(baseScale);
        }

        // Proxy always at node position for picking
        a.pickProxy.position.set(px, py, pz);

        // Label above node
        a.label.position.set(px, py + 0.55, pz);

        // Connection line core → node
        const attr = a.line.geometry.getAttribute("position") as THREE_TYPES.BufferAttribute;
        attr.setXYZ(0, 0, 0, 0);
        attr.setXYZ(1, px, py, pz);
        attr.needsUpdate = true;
        a.line.geometry.computeBoundingSphere();
        (a.line.material as THREE_TYPES.LineBasicMaterial).opacity = isSelected ? 0.85 : 0.4;

        // Animated dot along line
        const t = ((clock * 0.6 + i * 0.22) % 1);
        a.dot.position.set(px * t, py * t, pz * t);
        a.dot.visible = true;
      });

      renderer.render(scene, camera);
      frame = requestAnimationFrame(draw);
    };

    const invalidate = () => { if (!frame && !disposed) frame = requestAnimationFrame(draw); };

    const obs = new ResizeObserver(() => {
      const { width, height } = host.getBoundingClientRect();
      if (!width || !height) return;
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      invalidate();
    });
    obs.observe(host);

    // Visibility pause
    const vis = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) { invalidate(); }
      else { cancelAnimationFrame(frame); frame = 0; }
    });
    vis.observe(host);

    invalidate();

    return {
      setSelected(id: string) { selectedId = id; invalidate(); },
      dispose() {
        disposed = true;
        cancelAnimationFrame(frame);
        obs.disconnect(); vis.disconnect();
        renderer.domElement.removeEventListener("pointerdown", onDown);
        renderer.domElement.removeEventListener("pointermove", onMove);
        renderer.domElement.removeEventListener("pointerup", onUp);
        renderer.dispose();
        renderer.forceContextLoss();
        renderer.domElement.remove();
      },
    };
  })();

  return {
    setSelected(id: string) { promise.then((c) => c?.setSelected(id)); },
    dispose() {
      disposed = true;
      promise.then((c) => c?.dispose());
    },
  };
}

export function IntegrationOrbit() {
  const root = useRef<HTMLElement>(null);
  const canvasHost = useRef<HTMLDivElement>(null);
  const reduced = useMotionPreference();
  const items = integrations.filter((i) => i.capability === "Agent access").slice(0, 6);
  const [id, setId] = useState(items[0].id);
  const selected = items.find((i) => i.id === id)!;
  const sceneRef = useRef<ReturnType<typeof createOrbitScene> | null>(null);

  // Boot the 3-D scene once (desktop non-reduced)
  useEffect(() => {
    if (reduced || !canvasHost.current) return;
    const scene = createOrbitScene(canvasHost.current, (newId) => {
      setId(newId);
    });
    sceneRef.current = scene;
    return () => { scene.dispose(); sceneRef.current = null; };
  }, [reduced]);

  // Keep scene in sync with selected id
  useEffect(() => {
    sceneRef.current?.setSelected(id);
  }, [id]);

  // CSS orbit scroll animation on the outer wrapper
  useEffect(() => {
    if (reduced || !root.current) return;
    let cancel = false, dispose: (() => void) | undefined;
    void import("../../lib/orbitScroll")
      .then(({ mountOrbitScroll }) => {
        if (!cancel && root.current) dispose = mountOrbitScroll(root.current);
      })
      .catch(() => {});
    return () => { cancel = true; dispose?.(); };
  }, [reduced]);

  return (
    <section className="integration-orbit" ref={root} aria-label="Agent capability explorer">
      {/* Scrolling ticker */}
      <div className="agent-ticker" aria-label="Integration capabilities">
        <div className="agent-ticker-track">
          {items.map((i) => (
            <span key={i.id}>
              {i.name}
              <small>{i.status}</small>
            </span>
          ))}
        </div>
      </div>

      <div className="orbit-layout">
        {/* 3-D canvas (desktop) / CSS fallback (mobile / reduced) */}
        <div className="agent-orbit">
          {!reduced ? (
            <div
              ref={canvasHost}
              className="orbit-3d-canvas"
              aria-label="3D integration orbit visualization"
            />
          ) : (
            /* CSS fallback */
            <>
              <div className="orbit-core">
                Continuum<small>Scoped memory</small>
              </div>
              <div className="agent-ring">
                {items.map((i, n) => (
                  <button
                    key={i.id}
                    style={{ "--angle": `${n * 60}deg` } as CSSProperties}
                    aria-pressed={id === i.id}
                    onClick={() => setId(i.id)}
                  >
                    <span>{i.name}</span>
                  </button>
                ))}
              </div>
            </>
          )}
          {/* Always render invisible buttons for keyboard nav over the canvas */}
          {!reduced && (
            <div className="orbit-node-labels" aria-label="Agent selector">
              {items.map((i) => (
                <button
                  key={i.id}
                  className={`orbit-node-btn${id === i.id ? " active" : ""}`}
                  aria-pressed={id === i.id}
                  onClick={() => setId(i.id)}
                >
                  {i.name}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="orbit-detail" aria-live="polite">
          <span className="eyebrow">CAPABILITY / {selected.status}</span>
          <h2>{selected.name}</h2>
          <p>{selected.description}</p>
          <p>
            No live provider session is claimed. Explore the capability details
            below before configuring access.
          </p>
        </div>
      </div>
    </section>
  );
}
