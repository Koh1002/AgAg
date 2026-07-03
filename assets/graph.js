// AgAg グラフビュー(Obsidian のグラフビュー風)
// graph.json(scripts/graph.mjs が生成)を読み込み、d3-force で描画する。
// 将来ノードが増えて重くなったら Canvas 化を検討(agent/knowledge/proposals.md に提案を書くこと)。

/* global d3 */
(async function () {
  const res = await fetch("graph.json");
  const graph = await res.json();
  const nodes = graph.nodes.map((n) => ({ ...n }));
  const links = graph.edges.map((e) => ({ ...e }));

  // ---------- 見た目の定義 ----------
  const COLOR = {
    agent: "#ffd76a",
    subagent: "#b28cf0",
    skill: "#5ad0e6",
    knowledge: "#6fdc8f",
    source: "#f0a35a",
    digest: "#6f9df0",
    growth: "#c8e65a",
    run: "#f07ab8",
    script: "#8f99ab",
    archive: "#55607a",
  };
  const TYPE_LABEL = {
    agent: "本体",
    subagent: "サブエージェント",
    skill: "スキル",
    knowledge: "知識",
    source: "情報源",
    digest: "ダイジェスト",
    growth: "成長イベント",
    run: "実行結果",
    script: "コード",
    archive: "アーカイブ",
  };
  const BASE_R = { agent: 22, subagent: 12, skill: 10, knowledge: 10, source: 8, digest: 9, growth: 7, run: 9, script: 7, archive: 9 };
  // 常時ラベルを出す種別(それ以外はズームインで表示)
  const ALWAYS_LABEL = new Set(["agent", "subagent", "skill", "knowledge", "source"]);
  const LINK_DIST = { owns: 115, watches: 145, fed: 55, grew: 50, changed: 60, ran: 65 };

  // 次数・隣接マップ
  const degree = new Map();
  const neighbors = new Map(); // id -> [{node, kind, dir}]
  const byId = new Map(nodes.map((n) => [n.id, n]));
  for (const l of links) {
    degree.set(l.source, (degree.get(l.source) ?? 0) + 1);
    degree.set(l.target, (degree.get(l.target) ?? 0) + 1);
    if (!neighbors.has(l.source)) neighbors.set(l.source, []);
    if (!neighbors.has(l.target)) neighbors.set(l.target, []);
    neighbors.get(l.source).push({ id: l.target, kind: l.kind, dir: "out" });
    neighbors.get(l.target).push({ id: l.source, kind: l.kind, dir: "in" });
  }
  const radius = (n) => (BASE_R[n.type] ?? 8) + Math.min(8, Math.sqrt(degree.get(n.id) ?? 0) * 1.5);

  // 7日以内に生まれた/更新されたノードは「最近の成長」として脈動させる
  const now = new Date(graph.meta?.generatedAt ?? Date.now());
  const isFresh = (n) => {
    const d = n.updated ?? n.date;
    return d && now - new Date(d) < 7 * 86400_000;
  };

  // ---------- SVG セットアップ ----------
  const svg = d3.select("#graph");
  const W = () => window.innerWidth;
  const H = () => window.innerHeight;
  svg.attr("viewBox", [0, 0, W(), H()]);

  // 星空(ズームに追従しない背景レイヤー)
  const starLayer = svg.append("g").attr("class", "stars");
  const rand = d3.randomLcg(42);
  starLayer
    .selectAll("circle")
    .data(d3.range(140))
    .join("circle")
    .attr("cx", () => rand() * W())
    .attr("cy", () => rand() * H())
    .attr("r", () => rand() * 1.2 + 0.2)
    .attr("opacity", () => rand() * 0.5 + 0.1);

  const zoomG = svg.append("g");

  const link = zoomG
    .append("g")
    .selectAll("line")
    .data(links)
    .join("line")
    .attr("class", (d) => `link link-${d.kind}`)
    .attr("stroke-width", (d) => Math.min(4, 0.8 + Math.sqrt(d.weight ?? 1)));

  const node = zoomG
    .append("g")
    .selectAll("g")
    .data(nodes)
    .join("g")
    .attr("class", (d) => `node node-${d.type}${isFresh(d) ? " fresh" : ""}`)
    .style("cursor", "pointer");

  node
    .filter((d) => isFresh(d))
    .append("circle")
    .attr("class", "halo")
    .attr("r", (d) => radius(d) + 6)
    .attr("fill", "none")
    .attr("stroke", (d) => COLOR[d.type] ?? "#999");

  node
    .append("circle")
    .attr("class", "dot")
    .attr("r", radius)
    .attr("fill", (d) => COLOR[d.type] ?? "#999");

  node
    .append("text")
    .attr("class", (d) => `label ${ALWAYS_LABEL.has(d.type) ? "label-always" : "label-zoom"}`)
    .attr("dy", (d) => radius(d) + 14)
    .attr("text-anchor", "middle")
    .text((d) => (d.label.length > 24 ? d.label.slice(0, 24) + "…" : d.label));

  // ---------- 物理シミュレーション ----------
  const agentNode = nodes.find((n) => n.id === "agent");
  if (agentNode) {
    agentNode.fx = W() / 2;
    agentNode.fy = H() / 2;
  }
  const sim = d3
    .forceSimulation(nodes)
    .force("link", d3.forceLink(links).id((d) => d.id).distance((l) => LINK_DIST[l.kind] ?? 60).strength(0.6))
    .force("charge", d3.forceManyBody().strength(-320))
    .force("collide", d3.forceCollide().radius((d) => radius(d) + 6))
    .force("x", d3.forceX(W() / 2).strength(0.03))
    .force("y", d3.forceY(H() / 2).strength(0.03))
    .on("tick", () => {
      link
        .attr("x1", (d) => d.source.x)
        .attr("y1", (d) => d.source.y)
        .attr("x2", (d) => d.target.x)
        .attr("y2", (d) => d.target.y);
      node.attr("transform", (d) => `translate(${d.x},${d.y})`);
    });

  // ---------- ズーム & ドラッグ ----------
  const zoom = d3
    .zoom()
    .scaleExtent([0.2, 4])
    .on("zoom", (ev) => {
      zoomG.attr("transform", ev.transform);
      document.body.classList.toggle("zoomed-in", ev.transform.k > 1.15);
    });
  svg.call(zoom);

  node.call(
    d3
      .drag()
      .on("start", (ev, d) => {
        if (!ev.active) sim.alphaTarget(0.3).restart();
        d.fx = d.x;
        d.fy = d.y;
      })
      .on("drag", (ev, d) => {
        d.fx = ev.x;
        d.fy = ev.y;
      })
      .on("end", (ev, d) => {
        if (!ev.active) sim.alphaTarget(0);
        if (d.id !== "agent") {
          d.fx = null;
          d.fy = null;
        }
      })
  );

  // ---------- 凡例 ----------
  const typesPresent = [...new Set(nodes.map((n) => n.type))];
  document.getElementById("graph-legend").innerHTML =
    typesPresent
      .map((t) => `<span class="legend-item"><i style="background:${COLOR[t]}"></i>${TYPE_LABEL[t] ?? t}</span>`)
      .join("") + `<span class="legend-item"><i class="legend-fresh"></i>最近7日の成長</span>`;

  // ---------- サイドパネル ----------
  const panel = document.getElementById("side-panel");
  const escHtml = (s) =>
    String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  function openPanel(d) {
    const nbs = (neighbors.get(d.id) ?? [])
      .map((nb) => ({ ...nb, node: byId.get(nb.id) }))
      .filter((nb) => nb.node);
    const growthNbs = nbs.filter((nb) => nb.node.type === "growth");
    const items = (d.items ?? [])
      .map((i) => `<li><a href="${escHtml(i.url)}" target="_blank" rel="noopener">${escHtml(i.title)}</a></li>`)
      .join("");
    panel.innerHTML = `
      <button id="panel-close" aria-label="閉じる">×</button>
      <span class="badge" style="background:${COLOR[d.type]}22;color:${COLOR[d.type]}">${TYPE_LABEL[d.type] ?? d.type}</span>
      ${isFresh(d) ? `<span class="badge badge-fresh">🌱 最近の成長</span>` : ""}
      <h2>${escHtml(d.label)}</h2>
      ${d.description ? `<p>${escHtml(d.description)}</p>` : ""}
      ${d.date ? `<p class="panel-meta">誕生: ${escHtml(d.date)}${d.updated && d.updated !== d.date ? ` · 最終成長: ${escHtml(d.updated)}` : ""}</p>` : ""}
      ${d.runUrl ? `<p><a class="run-btn" href="${escHtml(d.runUrl)}" target="_blank" rel="noopener">▶ 実行(Issue を作成)</a></p>` : ""}
      ${items ? `<h3>収録記事</h3><ul class="panel-list">${items}</ul>` : ""}
      ${growthNbs.length ? `<h3>関連する成長</h3><ul class="panel-list">${growthNbs.map((nb) => `<li>${escHtml(nb.node.date ?? "")} — ${escHtml(nb.node.description)}</li>`).join("")}</ul>` : ""}
      <p class="panel-links">
        ${d.url ? `<a href="${escHtml(d.url)}">サイト内ページ →</a>` : ""}
        ${d.repoUrl ? `<a href="${escHtml(d.repoUrl)}" target="_blank" rel="noopener">ソースを見る →</a>` : ""}
      </p>
      <p class="panel-meta">つながり: ${nbs.length}</p>`;
    panel.hidden = false;
    document.getElementById("panel-close").onclick = closePanel;

    // 選択の強調: 隣接ノード以外を薄く
    const near = new Set([d.id, ...nbs.map((nb) => nb.id)]);
    node.classed("dim", (n) => !near.has(n.id));
    link.classed("dim", (l) => l.source.id !== d.id && l.target.id !== d.id);
  }

  function closePanel() {
    panel.hidden = true;
    node.classed("dim", false);
    link.classed("dim", false);
  }

  node.on("click", (ev, d) => {
    ev.stopPropagation();
    openPanel(d);
  });
  svg.on("click", closePanel);

  // 操作ヒントは数秒で消す
  setTimeout(() => document.getElementById("graph-hint")?.classList.add("fade"), 6000);

  // リサイズ対応
  window.addEventListener("resize", () => {
    svg.attr("viewBox", [0, 0, W(), H()]);
    if (agentNode) {
      agentNode.fx = W() / 2;
      agentNode.fy = H() / 2;
    }
    sim.force("x", d3.forceX(W() / 2).strength(0.03)).force("y", d3.forceY(H() / 2).strength(0.03));
    sim.alpha(0.3).restart();
  });
})();
