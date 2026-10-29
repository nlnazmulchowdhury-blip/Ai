/* My AI Company — live org chart (CEO -> Bosses -> Workers). */
/* global React, ReactDOM, ReactFlow */

const { ReactFlow, ReactFlowProvider, Handle, Position, Background, Controls } =
  window.ReactFlow;
const { createElement, useState, useEffect, useCallback, memo } = React;

const EDGE_COLOR = "rgba(168,200,255,.38)";
const GOLD = "rgba(245,165,36,.55)";

/* --- Node card ---------------------------------------------------------- */

function AgentNode({ data }) {
  const kind = data.ceo ? "ceo" : data.role === "boss" ? "boss" : "worker";
  const cls = ["agent-node", data.status, data.ceo ? "ceo" : ""].join(" ").trim();
  const badge =
    kind === "ceo" ? "CEO" : kind === "boss" ? "BOSS" : "WORKER";
  return createElement(
    "div",
    { className: cls, title: data.lastError || "" },
    createElement(Handle, { type: "target", position: Position.Top, style: { opacity: 0 } }),
    createElement(
      "div",
      { style: { display: "flex", alignItems: "center" } },
      createElement("span", { className: "dot" }),
      createElement(
        "div",
        { style: { minWidth: 0 } },
        createElement(
          "div",
          { style: { fontSize: 13, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } },
          data.name
        ),
        createElement(
          "div",
          { style: { fontSize: 10, letterSpacing: 2, opacity: 0.55, marginTop: 2 } },
          badge
        )
      )
    ),
    createElement(
      "div",
      {
        style: {
          marginTop: 8, fontSize: 10, opacity: 0.5, display: "flex", gap: 10,
          borderTop: "1px solid rgba(255,255,255,.08)", paddingTop: 6,
        },
      },
      createElement("span", null, "done " + (data.tasksDone || 0)),
      createElement("span", null, "fail " + (data.failures || 0))
    ),
    createElement(Handle, { type: "source", position: Position.Bottom, style: { opacity: 0 } })
  );
}
const AgentNodeMemo = memo(AgentNode);

/* --- Graph layout ------------------------------------------------------- */

function buildGraph(agents) {
  const ceo = agents.find((a) => a.ceo);
  const bosses = agents.filter((a) => a.role === "boss" && !a.ceo);
  const workers = agents.filter((a) => a.role === "worker" || a.role === "unknown");
  const width = window.innerWidth || 1200;
  const cx = Math.max(340, width / 2);
  const nodes = [];
  const edges = [];
  const known = new Set(agents.map((a) => a.name));

  const pushNode = (a, x, y) =>
    nodes.push({ id: a.name, type: "agent", position: { x: x - 95, y }, data: a });

  if (ceo) pushNode(ceo, cx, 60);

  bosses.forEach((b, i) => {
    const x = cx + (i - (bosses.length - 1) / 2) * 240;
    pushNode(b, x, 240);
    if (ceo) edges.push(makeEdge(ceo.name, b.name, GOLD));
    (b.workers || []).forEach((wn) => {
      if (known.has(wn)) edges.push(makeEdge(b.name, wn, EDGE_COLOR));
    });
  });

  workers.forEach((w, i) => {
    const x = cx + (i - (workers.length - 1) / 2) * 210;
    pushNode(w, x, 440);
  });

  return { nodes, edges };
}

function makeEdge(source, target, color) {
  return {
    id: `${source}->${target}`,
    source,
    target,
    animated: true,
    style: { stroke: color },
    markerEnd: { type: "arrowclosed", color, width: 14, height: 14 },
  };
}

/* --- App ---------------------------------------------------------------- */

const nodeTypes = { agent: AgentNodeMemo };

function CommandCenter() {
  const [nodes, setNodes] = useState([]);
  const [edges, setEdges] = useState([]);
  const [stats, setStats] = useState({ agents: 0, busy: 0, errors: 0, tasks: 0 });

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/state");
      const state = await res.json();
      const graph = buildGraph(state.agents || []);
      setNodes(graph.nodes);
      setEdges(graph.edges);
      setStats({
        agents: state.agents.length,
        busy: state.agents.filter((a) => a.status === "busy").length,
        errors: state.agents.filter((a) => a.status === "error").length,
        tasks: (state.tasks || []).length,
      });
    } catch {
      /* dashboard server not up yet — retry next tick */
    }
  }, []);

  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, 2000);
    return () => clearInterval(timer);
  }, [refresh]);

  return createElement(
    "div",
    { style: { width: "100vw", height: "100vh", position: "relative" } },
    createElement(
      "div",
      {
        className: "glass",
        style: {
          position: "absolute", top: 18, left: 18, zIndex: 10,
          padding: "14px 20px", display: "flex", alignItems: "center", gap: 26,
        },
      },
      createElement(
        "div",
        null,
        createElement("div", { style: { fontSize: 17, fontWeight: 700, letterSpacing: 1 } }, "MY AI COMPANY"),
        createElement("div", { style: { fontSize: 10, letterSpacing: 3, opacity: 0.5 } }, "COMMAND CENTER")
      ),
      createElement(Stat, { label: "AGENTS", value: stats.agents }),
      createElement(Stat, { label: "BUSY", value: stats.busy }),
      createElement(Stat, { label: "ERRORS", value: stats.errors }),
      createElement(Stat, { label: "TASKS", value: stats.tasks })
    ),
    createElement(ReactFlow, {
      nodes,
      edges,
      nodeTypes,
      fitView: true,
      fitViewOptions: { padding: 0.15 },
      minZoom: 0.4,
      maxZoom: 1.6,
      proOptions: { hideAttribution: false },
      style: { width: "100%", height: "100%" },
    },
      createElement(Background, { color: "rgba(168,200,255,.09)", gap: 26 }),
      createElement(Controls, null)
    )
  );
}

function Stat({ label, value }) {
  return createElement(
    "div",
    { style: { textAlign: "center" } },
    createElement("div", { style: { fontSize: 18, fontWeight: 700, color: "var(--accent)" } }, value),
    createElement("div", { style: { fontSize: 9, letterSpacing: 2, opacity: 0.5 } }, label)
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(
  createElement(ReactFlowProvider, null, createElement(CommandCenter))
);
