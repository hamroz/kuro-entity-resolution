"use client";

import { Background, Controls, MarkerType, Position, ReactFlow, type Edge, type Node } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useRouter } from "next/navigation";
import { useMemo } from "react";
import { useER } from "./er-provider";

const ROW = 54;

export default function EntityGraph() {
  const { entities, docs, queue } = useER();
  const router = useRouter();

  const { nodes, edges } = useMemo(() => {
    const docIndex = new Map(docs.map((d, i) => [d.id, i]));
    const openByEntity = new Map<string, number>();
    for (const q of queue) {
      if (q.skipped) continue;
      for (const c of q.clusters) openByEntity.set(c, (openByEntity.get(c) ?? 0) + 1);
    }
    const docY = (id: string) => (docIndex.get(id) ?? 0) * ROW * 1.6;
    const place = (list: typeof entities) => {
      const sorted = list
        .map((e) => ({ e, y: e.docs.reduce((s, d) => s + docY(d), 0) / Math.max(1, e.docs.length) }))
        .sort((a, b) => a.y - b.y);
      let last = -Infinity;
      return sorted.map(({ e, y }) => {
        const yy = Math.max(y, last + ROW);
        last = yy;
        return { e, y: yy };
      });
    };
    const nodes: Node[] = [];
    const edges: Edge[] = [];
    const entityNode = (e: (typeof entities)[number], x: number, y: number, side: "left" | "right"): Node => {
      const open = openByEntity.get(e.id) ?? 0;
      const org = e.type === "org";
      return {
        id: `e:${e.id}`,
        position: { x, y },
        data: { label: `${e.name}${e.mentions.length > 1 ? ` · ${e.mentions.length}×` : ""}${open ? `  ? ${open}` : ""}` },
        sourcePosition: side === "left" ? Position.Right : Position.Left,
        targetPosition: side === "left" ? Position.Right : Position.Left,
        style: {
          width: 230,
          fontSize: 12,
          textAlign: "left",
          borderRadius: 8,
          padding: "6px 10px",
          background: org ? "#f0f9ff" : "#f5f3ff",
          border: open ? "2px dashed #f59e0b" : `1px solid ${org ? "#7dd3fc" : "#c4b5fd"}`,
          color: "#1c1917",
          cursor: "pointer",
        },
      };
    };
    for (const { e, y } of place(entities.filter((x) => x.type === "org"))) nodes.push(entityNode(e, 0, y, "left"));
    docs.forEach((d) => {
      nodes.push({
        id: `d:${d.id}`,
        position: { x: 380, y: docY(d.id) },
        data: { label: `${d.id} · ${d.title}` },
        sourcePosition: Position.Right,
        targetPosition: Position.Left,
        style: { width: 220, fontSize: 11, borderRadius: 6, padding: "6px 8px", background: "#fafaf9", border: "1px solid #d6d3d1", color: "#44403c" },
      });
    });
    for (const { e, y } of place(entities.filter((x) => x.type === "person"))) nodes.push(entityNode(e, 760, y, "right"));
    for (const e of entities) {
      for (const d of e.docs) {
        const n = e.mentions.filter((m) => m.doc_id === d).length;
        const org = e.type === "org";
        edges.push({
          id: `${e.id}->${d}`,
          source: org ? `e:${e.id}` : `d:${d}`,
          target: org ? `d:${d}` : `e:${e.id}`,
          label: n > 1 ? `${n}×` : undefined,
          style: { stroke: org ? "#7dd3fc" : "#c4b5fd" },
          markerEnd: { type: MarkerType.ArrowClosed, color: org ? "#7dd3fc" : "#c4b5fd" },
        });
      }
    }
    return { nodes, edges };
  }, [entities, docs, queue]);

  return (
    <div className="rounded-lg border border-stone-200 bg-white">
      <div className="h-[72vh]">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        fitView
        forceColorMode="light"
        nodesDraggable={false}
        nodesConnectable={false}
        onNodeClick={(_, n) => {
          if (n.id.startsWith("e:")) router.push(`/entities?e=${encodeURIComponent(n.id.slice(2))}`);
          else router.push(`/documents?doc=${n.id.slice(2)}`);
        }}
        proOptions={{ hideAttribution: false }}
      >
        <Background />
        <Controls showInteractive={false} />
      </ReactFlow>
      </div>
      <p className="px-3 py-2 text-[11px] text-stone-500">
        Organisations left, documents (grouped by project) centre, people right. A dashed amber border marks an entity with open review questions.
      </p>
    </div>
  );
}
