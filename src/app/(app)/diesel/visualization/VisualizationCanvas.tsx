"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { transferMachine } from "../machines/actions";
import { soStatus, type Machine } from "@/lib/diesel/types";

/* A free-form, pannable/zoomable canvas: a central "machine pool" hub,
   one draggable box per site, and machine cards you drag between them
   to relocate a machine. Ported from a standalone prototype
   (machinery-tracker) that solved this same visualization problem —
   the pointer/pan/zoom/SVG-connector math below mirrors that
   implementation, wired here to the existing transferMachine action
   instead of a custom API. Only internal machines are draggable
   (external/hired machines aren't meant to move between sites, matching
   the same rule the Machinery page's "Transfer site" control follows).

   Node positions are cosmetic-only and persist per-browser in
   localStorage — there's nothing server-side to keep in sync for them. */

const SCENE = { width: 2800, height: 1800, minScale: 0.3, maxScale: 1.6 };
const STORAGE_KEY = "diesel_viz_positions_v1";

interface Point {
  x: number;
  y: number;
}

interface Site {
  id: string;
  name: string;
}

type PointerState =
  | { type: "pan"; startX: number; startY: number; viewX: number; viewY: number }
  | { type: "node"; pointerId: number; key: string; startScene: Point; startPosition: Point }
  | {
      type: "machine";
      pointerId: number;
      machineId: string;
      fromProjectId: string;
      preview: HTMLElement;
      startedAt: Point;
    };

function nodeKey(siteId: string | null) {
  return siteId == null ? "hub" : `site-${siteId}`;
}

function defaultPosition(key: string, index: number): Point {
  if (key === "hub") return { x: 70, y: 720 };
  const cols = 4;
  const col = index % cols;
  const row = Math.floor(index / cols);
  return { x: 460 + col * 470, y: 200 + row * 360 };
}

export function VisualizationCanvas({
  sites,
  machines: initialMachines,
}: {
  sites: Site[];
  machines: Machine[];
}) {
  const router = useRouter();
  const [machines, setMachines] = useState(initialMachines);
  const [query, setQuery] = useState("");
  const [positions, setPositions] = useState<Record<string, Point>>({});
  const [error, setError] = useState<string | null>(null);

  const viewportRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<HTMLDivElement>(null);
  const linesRef = useRef<SVGSVGElement>(null);
  const nodeRefs = useRef(new Map<string, HTMLDivElement>());

  const view = useRef({ x: 0, y: 0, scale: 0.82 });
  const pointer = useRef<PointerState | null>(null);

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}");
      setPositions(saved);
    } catch {
      // ignore malformed storage
    }
  }, []);

  const getPosition = useCallback(
    (key: string, index = 0): Point => positions[key] ?? defaultPosition(key, index),
    [positions],
  );

  const applyView = useCallback(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    scene.style.width = `${SCENE.width}px`;
    scene.style.height = `${SCENE.height}px`;
    scene.style.transform = `translate(${view.current.x}px, ${view.current.y}px) scale(${view.current.scale})`;
    scene.style.transformOrigin = "0 0";
  }, []);

  const viewportCenter = useCallback((): Point => {
    const rect = viewportRef.current!.getBoundingClientRect();
    return { x: rect.width / 2, y: rect.height / 2 };
  }, []);

  const viewportCenterToScene = useCallback((): Point => {
    const c = viewportCenter();
    return {
      x: (c.x - view.current.x) / view.current.scale,
      y: (c.y - view.current.y) / view.current.scale,
    };
  }, [viewportCenter]);

  const setZoom = useCallback(
    (nextScale: number) => {
      const before = viewportCenterToScene();
      view.current.scale = Math.max(SCENE.minScale, Math.min(SCENE.maxScale, nextScale));
      const center = viewportCenter();
      view.current.x = center.x - before.x * view.current.scale;
      view.current.y = center.y - before.y * view.current.scale;
      applyView();
      drawConnections();
    },
    [viewportCenter, viewportCenterToScene, applyView],
  );

  const clientToScene = useCallback((clientX: number, clientY: number): Point => {
    const rect = viewportRef.current!.getBoundingClientRect();
    return {
      x: (clientX - rect.left - view.current.x) / view.current.scale,
      y: (clientY - rect.top - view.current.y) / view.current.scale,
    };
  }, []);

  function getNodeBox(node: HTMLElement) {
    const sceneRect = sceneRef.current!.getBoundingClientRect();
    const rect = node.getBoundingClientRect();
    const scale = view.current.scale || 1;
    return {
      x: (rect.left - sceneRect.left) / scale,
      y: (rect.top - sceneRect.top) / scale,
      width: rect.width / scale,
      height: rect.height / scale,
    };
  }

  function boxCenter(box: { x: number; y: number; width: number; height: number }) {
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  }

  function anchorToward(
    box: { x: number; y: number; width: number; height: number },
    targetBox: { x: number; y: number; width: number; height: number },
  ) {
    const center = boxCenter(box);
    const target = boxCenter(targetBox);
    const dx = target.x - center.x;
    const dy = target.y - center.y;
    if (Math.abs(dx) >= Math.abs(dy)) {
      return dx >= 0
        ? { side: "right" as const, point: { x: box.x + box.width, y: center.y } }
        : { side: "left" as const, point: { x: box.x, y: center.y } };
    }
    return dy >= 0
      ? { side: "bottom" as const, point: { x: center.x, y: box.y + box.height } }
      : { side: "top" as const, point: { x: center.x, y: box.y } };
  }

  function controlPoint(anchor: { side: string; point: Point }, distance: number) {
    const point = { ...anchor.point };
    if (anchor.side === "right") point.x += distance;
    if (anchor.side === "left") point.x -= distance;
    if (anchor.side === "bottom") point.y += distance;
    if (anchor.side === "top") point.y -= distance;
    return point;
  }

  const drawConnections = useCallback(() => {
    const svg = linesRef.current;
    const hub = nodeRefs.current.get("hub");
    if (!svg || !hub) return;
    svg.setAttribute("width", String(SCENE.width));
    svg.setAttribute("height", String(SCENE.height));
    svg.setAttribute("viewBox", `0 0 ${SCENE.width} ${SCENE.height}`);
    svg.innerHTML = "";

    const hubBox = getNodeBox(hub);
    for (const [key, node] of nodeRefs.current) {
      if (key === "hub") continue;
      const box = getNodeBox(node);
      const start = anchorToward(hubBox, box);
      const end = anchorToward(box, hubBox);
      const dist = Math.max(
        90,
        Math.min(280, Math.hypot(start.point.x - end.point.x, start.point.y - end.point.y) * 0.36),
      );
      const c1 = controlPoint(start, dist);
      const c2 = controlPoint(end, dist);
      const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
      path.setAttribute(
        "d",
        `M ${start.point.x} ${start.point.y} C ${c1.x} ${c1.y}, ${c2.x} ${c2.y}, ${end.point.x} ${end.point.y}`,
      );
      path.setAttribute("stroke", "var(--color-accent)");
      path.setAttribute("stroke-width", "2");
      path.setAttribute("fill", "none");
      path.setAttribute("opacity", "0.45");
      svg.appendChild(path);
    }
  }, []);

  // Zoom/pan so every node fits inside the viewport with a little padding.
  // This is what stops the outer sites (Office / Store / godown, which land
  // in the far grid columns) from sitting off-screen at the default view.
  const fitToContent = useCallback(() => {
    const vp = viewportRef.current;
    if (!vp || nodeRefs.current.size === 0) return;

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const [, node] of nodeRefs.current) {
      const b = getNodeBox(node);
      minX = Math.min(minX, b.x);
      minY = Math.min(minY, b.y);
      maxX = Math.max(maxX, b.x + b.width);
      maxY = Math.max(maxY, b.y + b.height);
    }
    if (!Number.isFinite(minX)) return;

    const pad = 60;
    const rect = vp.getBoundingClientRect();
    const contentW = maxX - minX + pad * 2;
    const contentH = maxY - minY + pad * 2;
    const scale = Math.max(
      SCENE.minScale,
      Math.min(SCENE.maxScale, rect.width / contentW, rect.height / contentH),
    );
    view.current.scale = scale;
    view.current.x = rect.width / 2 - ((minX + maxX) / 2) * scale;
    view.current.y = rect.height / 2 - ((minY + maxY) / 2) * scale;
    applyView();
    drawConnections();
  }, [applyView, drawConnections]);

  useEffect(() => {
    applyView();
    drawConnections();
    const onResize = () => drawConnections();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [applyView, drawConnections, positions, machines, query]);

  // On first render (once nodes are measurable, and after any saved
  // positions have loaded), frame everything so nothing starts clipped.
  const didFit = useRef(false);
  useEffect(() => {
    if (didFit.current || nodeRefs.current.size === 0) return;
    didFit.current = true;
    const id = requestAnimationFrame(() =>
      requestAnimationFrame(() => fitToContent()),
    );
    return () => cancelAnimationFrame(id);
  }, [fitToContent, positions, sites, machines]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return machines;
    return machines.filter(
      (m) =>
        m.name.toLowerCase().includes(q) ||
        (m.registration_no ?? "").toLowerCase().includes(q) ||
        (m.vendor_name ?? "").toLowerCase().includes(q),
    );
  }, [machines, query]);

  function machinesForSite(siteId: string) {
    return filtered.filter((m) => m.project_id === siteId);
  }

  // ---------------- Pointer handling ----------------

  function startCanvasPan(e: React.PointerEvent) {
    if (e.button !== 0) return;
    const target = e.target as HTMLElement;
    if (target.closest(".viz-node") || target.closest(".viz-machine")) return;
    pointer.current = {
      type: "pan",
      startX: e.clientX,
      startY: e.clientY,
      viewX: view.current.x,
      viewY: view.current.y,
    };
    viewportRef.current!.setPointerCapture(e.pointerId);
  }

  function startNodeDrag(e: React.PointerEvent, key: string) {
    if (e.button !== 0) return;
    const target = e.target as HTMLElement;
    if (target.closest(".viz-machine")) return;
    const node = nodeRefs.current.get(key);
    if (!node) return;
    pointer.current = {
      type: "node",
      pointerId: e.pointerId,
      key,
      startScene: clientToScene(e.clientX, e.clientY),
      startPosition: getPosition(key),
    };
    node.setPointerCapture(e.pointerId);
    node.classList.add("is-moving");
    e.preventDefault();
  }

  function startMachineDrag(e: React.PointerEvent, machine: Machine) {
    if (e.button !== 0 || machine.ownership !== "internal") return;
    const card = e.currentTarget as HTMLElement;
    const preview = document.createElement("div");
    preview.className = "viz-machine-drag-preview";
    preview.textContent = machine.name;
    preview.style.left = `${e.clientX + 14}px`;
    preview.style.top = `${e.clientY + 14}px`;
    document.body.appendChild(preview);

    pointer.current = {
      type: "machine",
      pointerId: e.pointerId,
      machineId: machine.id,
      fromProjectId: machine.project_id,
      preview,
      startedAt: { x: e.clientX, y: e.clientY },
    };
    card.setPointerCapture(e.pointerId);
    card.classList.add("dragging");
    e.preventDefault();
    e.stopPropagation();
  }

  function dropTargetAt(clientX: number, clientY: number): { siteId: string } | null {
    const el = document.elementFromPoint(clientX, clientY);
    const column = el?.closest<HTMLElement>(".viz-column");
    const siteId = column?.dataset.siteId;
    return siteId ? { siteId } : null;
  }

  function clearDropHighlights() {
    document.querySelectorAll(".viz-dropzone.drag-over").forEach((z) => z.classList.remove("drag-over"));
  }

  function handlePointerMove(e: React.PointerEvent) {
    const p = pointer.current;
    if (!p) return;

    if (p.type === "pan") {
      view.current.x = p.viewX + e.clientX - p.startX;
      view.current.y = p.viewY + e.clientY - p.startY;
      applyView();
      return;
    }

    if (p.type === "node") {
      const scene = clientToScene(e.clientX, e.clientY);
      const next = {
        x: Math.max(10, Math.min(SCENE.width - 360, p.startPosition.x + scene.x - p.startScene.x)),
        y: Math.max(10, Math.min(SCENE.height - 280, p.startPosition.y + scene.y - p.startScene.y)),
      };
      const node = nodeRefs.current.get(p.key);
      if (node) {
        node.style.left = `${next.x}px`;
        node.style.top = `${next.y}px`;
      }
      drawConnections();
      return;
    }

    if (p.type === "machine") {
      p.preview.style.left = `${e.clientX + 14}px`;
      p.preview.style.top = `${e.clientY + 14}px`;
      clearDropHighlights();
      const target = dropTargetAt(e.clientX, e.clientY);
      if (target) {
        nodeRefs.current.get(nodeKey(target.siteId))?.querySelector(".viz-dropzone")?.classList.add("drag-over");
      }
    }
  }

  async function handlePointerUp(e: React.PointerEvent) {
    const p = pointer.current;
    if (!p) return;
    pointer.current = null;

    if (p.type === "pan") {
      viewportRef.current?.releasePointerCapture(e.pointerId);
      return;
    }

    if (p.type === "node") {
      const node = nodeRefs.current.get(p.key);
      node?.classList.remove("is-moving");
      node?.releasePointerCapture(p.pointerId);
      const scene = clientToScene(e.clientX, e.clientY);
      const next = {
        x: Math.max(10, Math.min(SCENE.width - 360, p.startPosition.x + scene.x - p.startScene.x)),
        y: Math.max(10, Math.min(SCENE.height - 280, p.startPosition.y + scene.y - p.startScene.y)),
      };
      const nextPositions = { ...positions, [p.key]: next };
      setPositions(nextPositions);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(nextPositions));
      drawConnections();
      return;
    }

    if (p.type === "machine") {
      clearDropHighlights();
      p.preview.remove();
      const moved = Math.hypot(e.clientX - p.startedAt.x, e.clientY - p.startedAt.y);
      const target = dropTargetAt(e.clientX, e.clientY);
      if (moved < 8 || !target || target.siteId === p.fromProjectId) return;

      setError(null);
      const prevMachines = machines;
      setMachines((prev) =>
        prev.map((m) => (m.id === p.machineId ? { ...m, project_id: target.siteId } : m)),
      );
      try {
        const fd = new FormData();
        fd.set("machine_id", p.machineId);
        fd.set("project_id", target.siteId);
        await transferMachine(fd);
        router.refresh();
      } catch (err) {
        setMachines(prevMachines);
        setError(err instanceof Error ? err.message : "Couldn't move that machine.");
      }
    }
  }

  function zoomBy(delta: number) {
    setZoom(view.current.scale + delta);
  }

  const totalCount = machines.length;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search machine, numberplate, vendor…"
          className="w-64 rounded-md border border-line-strong bg-surface px-3 py-1.5 text-sm"
        />
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => zoomBy(-0.12)}
            className="rounded-md border border-line-strong px-2.5 py-1 text-sm hover:bg-surface-2"
          >
            −
          </button>
          <button
            type="button"
            onClick={() => fitToContent()}
            className="rounded-md border border-line-strong px-2.5 py-1 text-xs hover:bg-surface-2"
          >
            Fit all
          </button>
          <button
            type="button"
            onClick={() => {
              setPositions({});
              localStorage.removeItem(STORAGE_KEY);
              requestAnimationFrame(() =>
                requestAnimationFrame(() => fitToContent()),
              );
            }}
            className="rounded-md border border-line-strong px-2.5 py-1 text-xs hover:bg-surface-2"
          >
            Reset layout
          </button>
          <button
            type="button"
            onClick={() => zoomBy(0.12)}
            className="rounded-md border border-line-strong px-2.5 py-1 text-sm hover:bg-surface-2"
          >
            +
          </button>
        </div>
      </div>

      {error && <p className="text-sm text-danger">{error}</p>}
      <p className="text-xs text-ink-3">
        Drag internal machines between site boxes to relocate them. External/hired machines aren&apos;t
        draggable. Pan by dragging empty space; scroll to zoom.
      </p>

      <div
        ref={viewportRef}
        onPointerDown={startCanvasPan}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onWheel={(e) => {
          e.preventDefault();
          zoomBy(e.deltaY > 0 ? -0.08 : 0.08);
        }}
        className="relative h-[70vh] overflow-hidden rounded-lg border border-line bg-surface-2 select-none"
        style={{ touchAction: "none" }}
      >
        <div ref={sceneRef} className="absolute left-0 top-0">
          <svg ref={linesRef} className="pointer-events-none absolute left-0 top-0" />

          {/* Hub */}
          <div
            ref={(node) => {
              if (node) nodeRefs.current.set("hub", node);
            }}
            className="viz-node absolute w-64 rounded-lg border border-line bg-surface p-4 shadow-sm"
            style={{ left: getPosition("hub").x, top: getPosition("hub").y }}
          >
            <div
              onPointerDown={(e) => startNodeDrag(e, "hub")}
              className="cursor-grab text-xs font-semibold uppercase tracking-wide text-ink-3"
            >
              Total Machine Pool <span className="normal-case text-ink-3">· drag me</span>
            </div>
            <p className="mt-1 text-2xl font-semibold text-ink">{totalCount}</p>
            <p className="mt-1 text-xs text-ink-3">{sites.length} sites</p>
          </div>

          {/* Site nodes */}
          {sites.map((site, index) => {
            const key = nodeKey(site.id);
            const siteMachines = machinesForSite(site.id);
            return (
              <div
                key={site.id}
                ref={(node) => {
                  if (node) nodeRefs.current.set(key, node);
                }}
                data-site-id={site.id}
                className="viz-node viz-column absolute w-80 rounded-lg border border-line bg-surface shadow-sm"
                style={{ left: getPosition(key, index).x, top: getPosition(key, index).y }}
              >
                <div
                  onPointerDown={(e) => startNodeDrag(e, key)}
                  className="flex cursor-grab items-center justify-between rounded-t-lg border-b border-line bg-surface-2 px-3 py-2"
                >
                  <strong className="text-sm">{site.name}</strong>
                  <span className="text-xs text-ink-3">{siteMachines.length} machines</span>
                </div>
                <div className="viz-dropzone flex max-h-72 flex-col gap-1.5 overflow-y-auto p-2">
                  {siteMachines.length === 0 && (
                    <p className="p-2 text-xs text-ink-3">No machines</p>
                  )}
                  {siteMachines.map((m) => {
                    const so = soStatus(m);
                    return (
                      <div
                        key={m.id}
                        onPointerDown={(e) => startMachineDrag(e, m)}
                        className={`viz-machine rounded-md border bg-surface px-2.5 py-1.5 text-xs ${
                          so.state === "expired"
                            ? "border-danger ring-1 ring-danger"
                            : "border-line-strong"
                        } ${
                          m.ownership === "internal" ? "cursor-grab" : "cursor-default opacity-70"
                        }`}
                      >
                        <p className="font-medium text-ink">{m.name}</p>
                        <p className="text-ink-3">
                          {m.machine_type}
                          {m.registration_no ? ` · ${m.registration_no}` : ""}
                          {m.ownership === "external" ? " · external" : ""}
                        </p>
                        {so.state === "expired" && (
                          <p className="mt-0.5 font-semibold text-danger">
                            SO expired · {so.days}d over
                          </p>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
