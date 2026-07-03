// AgAg アプリ内実行ランナー
// ▶実行 を押すとページ内モーダルで「入力 → Issue作成(GitHub API) → 進捗 → 結果表示」まで完結する。
// 認証: Fine-grained PAT(AgAg リポジトリの Issues: Read and write のみ)を localStorage に保存。
// 裏の仕組みは Issue 駆動(run-agent.yml)をそのまま使う。

(function () {
  "use strict";
  const REPO = "Koh1002/AgAg";
  const API = "https://api.github.com/repos/" + REPO;
  const TOKEN_KEY = "agag_token";
  const POLL_MS = 10_000;
  const TIMEOUT_MS = 20 * 60_000;

  // ---------- ユーティリティ ----------
  const esc = (s) =>
    String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const linkify = (s) =>
    esc(s).replace(/(https?:\/\/[^\s&<]+[^\s&<.,)])/g, '<a href="$1" target="_blank" rel="noopener">$1</a>').replace(/\n/g, "<br>");
  const getToken = () => localStorage.getItem(TOKEN_KEY) || "";
  const setToken = (t) => localStorage.setItem(TOKEN_KEY, t);
  const clearToken = () => localStorage.removeItem(TOKEN_KEY);

  async function gh(path, opts = {}) {
    const res = await fetch(API + path, {
      ...opts,
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: "Bearer " + getToken(),
        ...(opts.body ? { "Content-Type": "application/json" } : {}),
        ...opts.headers,
      },
    });
    if (!res.ok) {
      const err = new Error("GitHub API " + res.status);
      err.status = res.status;
      try { err.detail = (await res.json()).message; } catch { /* ignore */ }
      throw err;
    }
    return res.json();
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
        ${run?.runUrl ? `<a class="agag-fallback" href="${esc(run.runUrl)}" target="_blank" rel="noopener">トークンなしで GitHub 上で実行 →</a>` : ""}
      </div>`);
    m.querySelector("#agag-token-save").onclick = async () => {
      const t = m.querySelector("#agag-token-input").value.trim();
      if (!t) return;
      setToken(t);
      const btn = m.querySelector("#agag-token-save");
      btn.disabled = true;
      btn.textContent = "検証中…";
      try {
        await gh("");
        run ? renderForm(run) : renderSettingsDone();
      } catch (e) {
        clearToken();
        renderSetup(run, `トークンの検証に失敗しました(${e.status ?? ""} ${e.detail ?? e.message})。権限とリポジトリ指定を確認してください。`);
      }
    };
  }

  function renderSettingsDone() {
    modal(`<h2>✅ トークンを保存しました</h2><p>これでグラフや実行ページの ▶ からアプリ内で実行できます。</p>`);
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

  // ---------- 実行 & 進捗 ----------
  function stepsHtml(state, issue) {
    const rows = [
      ["create", "実行リクエストを送信(Issue 作成)"],
      ["running", "GitHub Actions でエージェント実行中(数分かかります)"],
      ["done", "完了"],
    ];
    const order = ["create", "running", "done"];
    const cur = order.indexOf(state);
    return `<ol class="agag-steps">${rows
      .map(([key, label], i) => {
        const finished = i < cur || state === "done";
        const cls = finished ? "done" : i === cur ? "active" : "";
        return `<li class="${cls}">${finished ? "✅" : i === cur ? "⏳" : "・"} ${esc(label)}${key === "running" && issue ? ` <a href="${esc(issue.html_url)}" target="_blank" rel="noopener">#${issue.number}</a>` : ""}</li>`;
      })
      .join("")}</ol>`;
  }

  async function execute(run, values) {
    const m = modal(`<h2>▶ ${esc(run.title ?? run.name)}</h2><div id="agag-progress">${stepsHtml("create")}</div>`);
    const progress = () => m.querySelector("#agag-progress");
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
      progress().innerHTML = `<p class="agag-error">実行リクエストに失敗しました: ${esc(e.detail ?? e.message)}</p>`;
      return;
    }

    progress().innerHTML = stepsHtml("running", issue);
    const startedAt = Date.now();

    pollTimer = setInterval(async () => {
      try {
        const cur = await gh(`/issues/${issue.number}`);
        if (cur.state === "closed") {
          clearInterval(pollTimer);
          pollTimer = null;
          const comments = await gh(`/issues/${issue.number}/comments`);
          const last = comments.length ? comments[comments.length - 1].body : "(コメントなし)";
          progress().innerHTML = `${stepsHtml("done", issue)}
            <div class="agag-result">${linkify(last)}</div>
            <div class="agag-actions">
              <a class="agag-primary" href="runs.html">📊 実行履歴で詳細を見る</a>
              <a class="agag-ghost" href="${esc(cur.html_url)}" target="_blank" rel="noopener">Issue を見る</a>
            </div>`;
        } else if (Date.now() - startedAt > TIMEOUT_MS) {
          clearInterval(pollTimer);
          pollTimer = null;
          progress().innerHTML = `${stepsHtml("running", issue)}
            <p class="agag-error">20分以内に完了しませんでした。<a href="${esc(issue.html_url)}" target="_blank" rel="noopener">Issue #${issue.number}</a> で状況を確認してください。</p>`;
        }
      } catch {
        /* 一時的なAPIエラーは次のポーリングで再試行 */
      }
    }, POLL_MS);
  }

  // ---------- 公開 API & ボタン連携 ----------
  window.AgAgRun = {
    open(run) {
      if (!run || !run.name) return;
      getToken() ? renderForm(run) : renderSetup(run);
    },
    openSettings() {
      getToken() ? renderSetup(null, "保存済みのトークンを上書きします。空のまま閉じれば現状維持です。") : renderSetup(null);
    },
  };

  // data-run 属性を持つボタン(実行ページ・グラフのサイドパネル)を委譲ハンドリング
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
    }
  });
})();
