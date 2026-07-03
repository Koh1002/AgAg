// AgAg アプリ内実行ランナー
// ▶実行 → ページ内モーダルで「入力 → Issue作成(GitHub API) → 進捗 → 結果表示」まで完結する。
// 実行状態は localStorage に永続化され、モーダルを閉じたりリロードしても
// 画面右下のチップから進捗・結果に戻れる。runs.html ではライブ実行履歴も描画する。
// 認証: Fine-grained PAT(AgAg リポジトリの Issues: Read and write のみ)を localStorage に保存。

(function () {
  "use strict";
  const REPO = "Koh1002/AgAg";
  const API = "https://api.github.com/repos/" + REPO;
  const TOKEN_KEY = "agag_token";
  const RUNS_KEY = "agag_runs";
  const POLL_MS = 10_000; // モーダル表示中の高速ポーリング
  const CHIP_MS = 60_000; // バックグラウンド(チップ)の低速ポーリング
  const TIMEOUT_MS = 20 * 60_000;

  // ---------- ユーティリティ ----------
  const esc = (s) =>
    String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const linkify = (s) =>
    esc(s).replace(/(https?:\/\/[^\s&<]+[^\s&<.,)])/g, '<a href="$1" target="_blank" rel="noopener">$1</a>').replace(/\n/g, "<br>");
  const getToken = () => localStorage.getItem(TOKEN_KEY) || "";
  const setToken = (t) => localStorage.setItem(TOKEN_KEY, t);
  const clearToken = () => localStorage.removeItem(TOKEN_KEY);

  // 公開リポジトリなので参照系はトークンなしでも動く(レート制限は緩いが黙って劣化)
  async function gh(path, opts = {}) {
    const headers = { Accept: "application/vnd.github+json", ...(opts.body ? { "Content-Type": "application/json" } : {}), ...opts.headers };
    if (getToken()) headers.Authorization = "Bearer " + getToken();
    const res = await fetch(API + path, { ...opts, headers });
    if (!res.ok) {
      const err = new Error("GitHub API " + res.status);
      err.status = res.status;
      try { err.detail = (await res.json()).message; } catch { /* ignore */ }
      throw err;
    }
    return res.json();
  }

  // ---------- 実行状態ストア(localStorage) ----------
  const loadRuns = () => {
    try { return JSON.parse(localStorage.getItem(RUNS_KEY) || "[]"); } catch { return []; }
  };
  const saveRuns = (rs) => localStorage.setItem(RUNS_KEY, JSON.stringify(rs.slice(-10)));
  function upsertRun(r) {
    const rs = loadRuns().filter((x) => x.issue !== r.issue);
    rs.push(r);
    saveRuns(rs);
    renderChip();
  }
  const findRun = (issue) => loadRuns().find((r) => r.issue === issue);

  // ---------- フローティングチップ(右下・進行中/未読の実行) ----------
  function renderChip() {
    const active = loadRuns().filter((r) => !r.done || !r.seen);
    let chip = document.getElementById("agag-run-chip");
    if (!active.length) {
      if (chip) chip.remove();
      return;
    }
    const r = active[active.length - 1];
    if (!chip) {
      chip = document.createElement("button");
      chip.id = "agag-run-chip";
      document.body.appendChild(chip);
    }
    chip.className = r.done ? "done" : r.failed ? "failed" : "running";
    chip.innerHTML = r.failed
      ? `❌ ${esc(r.title)} 失敗 — タップで詳細`
      : r.done
        ? `✅ ${esc(r.title)} 完了 — タップで結果`
        : `⏳ ${esc(r.title)} 実行中 <span class="agag-chip-num">#${r.issue}</span>${active.length > 1 ? ` (+${active.length - 1})` : ""}`;
    chip.onclick = () => openProgress(r);
  }

  // バックグラウンド監視: 未完了の実行を低頻度で確認してチップを更新
  async function backgroundCheck() {
    for (const r of loadRuns().filter((x) => !x.done)) {
      try {
        const issue = await gh(`/issues/${r.issue}`);
        if (issue.state === "closed") upsertRun({ ...r, done: true });
      } catch { /* 次回に再試行 */ }
    }
  }

  // run-agent ワークフローの失敗検知(Issue はオープンのまま残るため)
  async function findWorkflowFailure(r) {
    try {
      const data = await gh(`/actions/workflows/run-agent.yml/runs?per_page=5`);
      const started = new Date(r.startedAt ?? 0).getTime() - 90_000;
      const match = (data.workflow_runs ?? []).find(
        (w) => w.display_title === `▶ run: ${r.name}` && new Date(w.created_at).getTime() >= started
      );
      if (match && match.conclusion === "failure") return match.html_url;
    } catch { /* ignore */ }
    return null;
  }

  // ---------- モーダルの骨組み ----------
  let overlay = null;
  let pollTimer = null;

  function modal(contentHtml) {
    if (!overlay) {
      overlay = document.createElement("div");
      overlay.id = "agag-run-overlay";
      overlay.addEventListener("click", (ev) => { if (ev.target === overlay) close(); });
      document.body.appendChild(overlay);
    }
    overlay.innerHTML = `<div id="agag-run-modal" role="dialog" aria-modal="true">
      <button class="agag-close" aria-label="閉じる">×</button>
      ${contentHtml}
    </div>`;
    overlay.querySelector(".agag-close").onclick = close;
    return overlay.querySelector("#agag-run-modal");
  }

  function close() {
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
    if (overlay) { overlay.remove(); overlay = null; }
    renderChip(); // 実行が続いていればチップが残る
  }

  // ---------- 画面: トークン設定 ----------
  function renderSetup(run, message) {
    const m = modal(`
      <h2>🔑 初回設定: GitHub トークン</h2>
      ${message ? `<p class="agag-error">${esc(message)}</p>` : ""}
      <p>アプリ内から実行するには、GitHub の Fine-grained トークンを1回だけ設定します(このブラウザの localStorage にのみ保存され、GitHub API 以外へは送信されません)。</p>
      <ol class="agag-steps-list">
        <li><a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener">トークン作成ページを開く →</a></li>
        <li>Repository access: <b>Only select repositories → AgAg</b></li>
        <li>Permissions → Repository permissions → <b>Issues: Read and write</b>(それ以外は不要)</li>
        <li>Generate token して、下に貼り付け</li>
      </ol>
      <input type="password" id="agag-token-input" placeholder="github_pat_..." autocomplete="off">
      <div class="agag-actions">
        <button class="agag-primary" id="agag-token-save">検証して保存</button>
        ${getToken() ? `<button class="agag-ghost" id="agag-token-clear">保存済みトークンを削除</button>` : ""}
        ${run?.runUrl ? `<a class="agag-fallback" href="${esc(run.runUrl)}" target="_blank" rel="noopener">トークンなしで GitHub 上で実行 →</a>` : ""}
      </div>`);
    const clearBtn = m.querySelector("#agag-token-clear");
    if (clearBtn) clearBtn.onclick = () => { clearToken(); close(); };
    m.querySelector("#agag-token-save").onclick = async () => {
      const t = m.querySelector("#agag-token-input").value.trim();
      if (!t) return;
      setToken(t);
      const btn = m.querySelector("#agag-token-save");
      btn.disabled = true;
      btn.textContent = "検証中…";
      try {
        await gh("");
        run ? renderForm(run) : modal(`<h2>✅ トークンを保存しました</h2><p>これでグラフや実行ページの ▶ からアプリ内で実行できます。</p>`);
      } catch (e) {
        clearToken();
        renderSetup(run, `トークンの検証に失敗しました(${e.status ?? ""} ${e.detail ?? e.message})。権限とリポジトリ指定を確認してください。`);
      }
    };
  }

  // ---------- 画面: 入力フォーム ----------
  function renderForm(run) {
    const inputs = run.inputs ?? [];
    const fields = inputs
      .map(
        (i, idx) => `<label class="agag-field">
          <span>${esc(i.name)}${i.required === true ? ' <em class="agag-req">必須</em>' : ""}</span>
          <input type="text" data-input-idx="${idx}" placeholder="${esc(i.description ?? "")}">
        </label>`
      )
      .join("");
    const m = modal(`
      <h2>▶ ${esc(run.title ?? run.name)}</h2>
      <p class="agag-sub"><code>${esc(run.name)}</code> をこのままアプリ内で実行します。</p>
      ${fields || `<p class="agag-sub">入力はありません。</p>`}
      <div class="agag-actions">
        <button class="agag-primary" id="agag-run-go">▶ 実行</button>
        <button class="agag-ghost" id="agag-token-edit">⚙ トークン設定</button>
      </div>`);
    m.querySelector("#agag-token-edit").onclick = () => renderSetup(run);
    m.querySelector("#agag-run-go").onclick = () => {
      const values = {};
      let missing = null;
      m.querySelectorAll("[data-input-idx]").forEach((el) => {
        const def = inputs[Number(el.dataset.inputIdx)];
        const v = el.value.trim();
        if (def.required === true && !v) missing = def.name;
        if (v) values[def.name] = v;
      });
      if (missing) {
        alert(`「${missing}」は必須です`);
        return;
      }
      execute(run, values);
    };
    const first = m.querySelector("[data-input-idx]");
    if (first) first.focus();
  }

  // ---------- 実行 ----------
  async function execute(run, values) {
    const m = modal(`<h2>▶ ${esc(run.title ?? run.name)}</h2><p class="agag-sub">実行リクエストを送信中…</p>`);
    const inputLines = Object.entries(values).map(([k, v]) => `${k}: ${v}`);
    const body = [`agent: ${run.name}`, "", "## 入力", ...(inputLines.length ? inputLines : ["(入力なし)"])].join("\n");
    let issue;
    try {
      try {
        issue = await gh("/issues", { method: "POST", body: JSON.stringify({ title: `▶ run: ${run.name}`, body, labels: ["run"] }) });
      } catch (e) {
        if (e.status === 422 || e.status === 404) {
          issue = await gh("/issues", { method: "POST", body: JSON.stringify({ title: `▶ run: ${run.name}`, body }) });
        } else throw e;
      }
    } catch (e) {
      if (e.status === 401) return renderSetup(run, "トークンが無効になっています。再設定してください。");
      m.innerHTML += `<p class="agag-error">実行リクエストに失敗しました: ${esc(e.detail ?? e.message)}</p>`;
      return;
    }
    const record = {
      issue: issue.number,
      name: run.name,
      title: run.title ?? run.name,
      html_url: issue.html_url,
      startedAt: new Date().toISOString(),
      done: false,
      seen: false,
    };
    upsertRun(record);
    openProgress(record);
  }

  // ---------- 画面: 進捗(復帰可能) ----------
  function stepsHtml(state, r) {
    const rows = [
      ["create", "実行リクエストを送信(Issue 作成)"],
      ["running", "GitHub Actions でエージェント実行中(数分かかります)"],
      ["done", "完了"],
    ];
    const cur = ["create", "running", "done"].indexOf(state);
    return `<ol class="agag-steps">${rows
      .map(([key, label], i) => {
        const finished = i < cur || state === "done";
        const cls = finished ? "done" : i === cur ? "active" : "";
        return `<li class="${cls}">${finished ? "✅" : i === cur ? "⏳" : "・"} ${esc(label)}${key === "running" && r ? ` <a href="${esc(r.html_url)}" target="_blank" rel="noopener">#${r.issue}</a>` : ""}</li>`;
      })
      .join("")}</ol>
    ${state === "running" ? `<p class="agag-sub">このモーダルを閉じても実行は続きます(右下のチップからいつでも戻れます)。</p>` : ""}`;
  }

  async function showResult(r) {
    upsertRun({ ...r, done: true, seen: true });
    const m = modal(`<h2>▶ ${esc(r.title)}</h2><div id="agag-progress">${stepsHtml("done", r)}<p class="agag-sub">結果を取得中…</p></div>`);
    try {
      const comments = await gh(`/issues/${r.issue}/comments`);
      const last = comments.length ? comments[comments.length - 1].body : "(結果コメントがまだありません)";
      m.querySelector("#agag-progress").innerHTML = `${stepsHtml("done", r)}
        <div class="agag-result">${linkify(last)}</div>
        <div class="agag-actions">
          <a class="agag-primary" href="runs.html">📊 実行履歴で詳細を見る</a>
          <a class="agag-ghost" href="${esc(r.html_url)}" target="_blank" rel="noopener">Issue を見る</a>
        </div>`;
    } catch (e) {
      m.querySelector("#agag-progress").innerHTML += `<p class="agag-error">結果の取得に失敗: ${esc(e.detail ?? e.message)}</p>`;
    }
  }

  function openProgress(r) {
    const current = findRun(r.issue) ?? r;
    if (current.done) return showResult(current);
    const m = modal(`<h2>▶ ${esc(current.title)}</h2><div id="agag-progress">${stepsHtml("running", current)}</div>`);
    const progress = () => m.querySelector("#agag-progress");
    const startedAt = new Date(current.startedAt ?? Date.now()).getTime();
    let tick = 0;
    if (pollTimer) clearInterval(pollTimer);
    const poll = async () => {
      tick++;
      try {
        const issue = await gh(`/issues/${current.issue}`);
        if (issue.state === "closed") {
          clearInterval(pollTimer);
          pollTimer = null;
          return showResult({ ...current, done: true });
        }
        // 3回に1回、ワークフローの失敗を確認(失敗時 Issue はオープンのまま残るため)
        if (tick % 3 === 0) {
          const failUrl = await findWorkflowFailure(current);
          if (failUrl && progress()) {
            clearInterval(pollTimer);
            pollTimer = null;
            upsertRun({ ...current, done: true, failed: true });
            progress().innerHTML = `${stepsHtml("running", current)}
              <p class="agag-error">❌ 実行が失敗しました。<a href="${esc(failUrl)}" target="_blank" rel="noopener">実行ログ</a>を確認してください。</p>`;
            return;
          }
        }
        if (Date.now() - startedAt > TIMEOUT_MS && progress()) {
          clearInterval(pollTimer);
          pollTimer = null;
          progress().innerHTML = `${stepsHtml("running", current)}
            <p class="agag-error">20分以内に完了しませんでした。<a href="${esc(current.html_url)}" target="_blank" rel="noopener">Issue #${current.issue}</a> で状況を確認してください。</p>`;
        }
      } catch { /* 一時的なAPIエラーは次回再試行 */ }
    };
    pollTimer = setInterval(poll, POLL_MS);
    poll();
  }

  // ---------- runs.html: ライブ実行履歴 ----------
  async function renderLiveHistory() {
    const el = document.getElementById("live-run-history");
    if (!el) return;
    try {
      const issues = await gh(`/issues?state=all&per_page=15`);
      const runs = issues.filter((i) => i.title.startsWith("▶ run:") && !i.pull_request);
      if (!runs.length) return;
      el.innerHTML =
        `<div class="cards">` +
        runs
          .map((i) => {
            const name = i.title.replace("▶ run: ", "");
            const state = i.state === "closed" ? "✅ 完了" : "⏳ 実行中";
            const when = new Date(i.created_at).toLocaleString("ja-JP");
            return `<article class="card live-run" data-live-issue="${i.number}" data-live-name="${esc(name)}" data-live-url="${esc(i.html_url)}" data-live-state="${i.state}" data-live-started="${esc(i.created_at)}">
              <div class="card-meta"><span class="badge ${i.state === "closed" ? "badge-growth" : ""}">${state}</span><span class="muted">${esc(when)} · #${i.number}</span></div>
              <h3>${esc(name)}</h3>
              <p class="muted">クリックで${i.state === "closed" ? "結果を表示" : "進捗を表示"}</p>
            </article>`;
          })
          .join("") +
        `</div>`;
    } catch { /* API失敗時は黙って非表示 */ }
  }

  // ---------- 公開 API & イベント委譲 ----------
  window.AgAgRun = {
    open(run) {
      if (!run || !run.name) return;
      getToken() ? renderForm(run) : renderSetup(run);
    },
    openSettings() {
      renderSetup(null);
    },
  };

  document.addEventListener("click", (ev) => {
    const btn = ev.target.closest("[data-run]");
    if (btn) {
      ev.preventDefault();
      try { window.AgAgRun.open(JSON.parse(btn.dataset.run)); } catch { /* ignore */ }
      return;
    }
    const settings = ev.target.closest("[data-agag-settings]");
    if (settings) {
      ev.preventDefault();
      window.AgAgRun.openSettings();
      return;
    }
    const live = ev.target.closest("[data-live-issue]");
    if (live) {
      ev.preventDefault();
      const r = {
        issue: Number(live.dataset.liveIssue),
        name: live.dataset.liveName,
        title: live.dataset.liveName,
        html_url: live.dataset.liveUrl,
        startedAt: live.dataset.liveStarted,
        done: live.dataset.liveState === "closed",
        seen: true,
      };
      r.done ? showResult(r) : openProgress(r);
    }
  });

  // 起動時: チップ復元+バックグラウンド監視+ライブ履歴
  renderChip();
  backgroundCheck().then(renderChip);
  setInterval(async () => { await backgroundCheck(); renderChip(); }, CHIP_MS);
  renderLiveHistory();
})();
