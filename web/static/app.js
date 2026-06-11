const POSITIONS = ["PG", "SG", "SF", "PF", "C"];
const STAT_KEYS = ["pts", "reb", "ast", "stl", "blk"];
const THEME_STORAGE_KEY = "hupu-theme";

const TERM_MAP = {
  pts: { label: "PTS", zh: "得分", title: "PTS：得分" },
  reb: { label: "REB", zh: "篮板", title: "REB：篮板" },
  ast: { label: "AST", zh: "助攻", title: "AST：助攻" },
  stl: { label: "STL", zh: "抢断", title: "STL：抢断" },
  blk: { label: "BLK", zh: "盖帽", title: "BLK：盖帽" },
  raw: { label: "RAW", zh: "原始评分", title: "RAW：原始评分，封顶前的公式结果" },
  base: { label: "BASE", zh: "基础分", title: "BASE：基础分，按年代基准和位置权重计算" },
  rating: { label: "RATING", zh: "封顶评分", title: "RATING：封顶评分，最高 100" },
  total: { label: "TOTAL", zh: "三项和", title: "TOTAL：PTS + REB + AST，得分、篮板、助攻之和" },
};

const RADAR_MODES = {
  ratio: {
    label: "公式标准化",
    shortLabel: "公式",
    hint: "公式标准化：相对年代基准",
    capKey: "ratio",
    suffix: "x",
    valueFor(player, stat) {
      return numericValue(player[`${stat}_ratio`]);
    },
  },
  score: {
    label: "评分贡献分",
    shortLabel: "贡献",
    hint: "评分贡献分：按位置权重后的公式贡献",
    capKey: "score",
    suffix: "",
    valueFor(player, stat) {
      return numericValue(player[`${stat}_score`]);
    },
  },
  raw: {
    label: "原始场均数据",
    shortLabel: "原始",
    hint: "原始场均数据：PTS/REB/AST/STL/BLK",
    capKey: "raw",
    suffix: "",
    valueFor(player, stat) {
      return numericValue(player[stat]);
    },
  },
};

const DEFAULT_RADAR_CAPS = {
  ratio: { pts: 2, reb: 2, ast: 2, stl: 2, blk: 2 },
  score: { pts: 24, reb: 16, ast: 16, stl: 12, blk: 8 },
  raw: { pts: 40, reb: 22, ast: 14, stl: 4, blk: 5 },
};

const state = {
  meta: null,
  rows: [],
  total: 0,
  offset: 0,
  limit: 50,
  order: "desc",
  details: false,
  selectedId: null,
  selectedPlayer: null,
  lineup: { PG: null, SG: null, SF: null, PF: null, C: null },
  simulation: null,
  radarMode: "ratio",
  theme: "dark",
  themePreference: "system",
};

const $ = (id) => document.getElementById(id);

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function numericValue(value) {
  if (value === null || value === undefined || value === "-") return 0;
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
}

function termTitle(termKey, detail = "") {
  const term = TERM_MAP[termKey];
  if (!term) return detail;
  return detail ? `${term.title}；${detail}` : term.title;
}

function termLabel(termKey, label = null, detail = "") {
  const term = TERM_MAP[termKey];
  const text = label || term?.label || termKey;
  const title = term ? termTitle(termKey, detail) : detail;
  if (!title) return escapeHtml(text);
  return `<span class="term-hint" title="${escapeHtml(title)}" aria-label="${escapeHtml(title)}">${escapeHtml(text)}</span>`;
}

function resolveSystemTheme() {
  return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

function applyTheme(theme) {
  state.theme = theme;
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
  updateThemeButton();
}

function updateThemeButton() {
  const button = $("themeToggleBtn");
  if (!button) return;
  const nextTheme = state.theme === "dark" ? "亮色" : "暗色";
  button.textContent = state.theme === "dark" ? "暗色" : "亮色";
  button.title = `当前为${button.textContent}主题，点击切换到${nextTheme}`;
  button.setAttribute("aria-label", `切换到${nextTheme}主题`);
}

function initTheme() {
  const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
  state.themePreference = stored === "light" || stored === "dark" ? stored : "system";
  applyTheme(state.themePreference === "system" ? resolveSystemTheme() : state.themePreference);
  const query = window.matchMedia("(prefers-color-scheme: light)");
  query.addEventListener("change", () => {
    if (state.themePreference === "system") applyTheme(resolveSystemTheme());
  });
}

function toggleTheme() {
  const nextTheme = state.theme === "dark" ? "light" : "dark";
  state.themePreference = nextTheme;
  window.localStorage.setItem(THEME_STORAGE_KEY, nextTheme);
  applyTheme(nextTheme);
}

function toast(message) {
  const el = $("toast");
  el.textContent = message;
  el.classList.add("show");
  window.setTimeout(() => el.classList.remove("show"), 1800);
}

function numberText(value) {
  if (value === null || value === undefined || value === "-") return "-";
  const num = Number(value);
  if (Number.isNaN(num)) return String(value);
  return Number.isInteger(num) ? String(num) : num.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
}

function ratingClass(value) {
  if (value >= 100) return "rating-pill max";
  if (value >= 95) return "rating-pill elite";
  return "rating-pill";
}

async function requestJson(url, options) {
  const response = await fetch(url, options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = data.detail || `请求失败 ${response.status}`;
    throw new Error(message);
  }
  return data;
}

function fillSelect(select, values, allLabel) {
  const current = select.value;
  select.innerHTML = "";
  const allOption = document.createElement("option");
  allOption.value = "";
  allOption.textContent = allLabel;
  select.appendChild(allOption);
  values.forEach((value) => {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = value;
    select.appendChild(option);
  });
  if ([...select.options].some((option) => option.value === current)) {
    select.value = current;
  }
}

function renderMeta() {
  const meta = state.meta;
  $("metaStrip").innerHTML = `
    <span>${meta.playable_total} 条可抽球员</span>
    <span>${meta.teams.length} 支球队</span>
    <span>${meta.rating_100} 名满分</span>
    <span>${meta.rating_95} 名 95+</span>
  `;
  fillSelect($("decadeSelect"), meta.playable_decades, "全部年代");
  fillSelect($("teamSelect"), meta.teams, "全部球队");
  fillSelect($("positionSelect"), meta.positions, "全部位置");
  decorateSortOptions();
  renderLineupRadar();
}

function updateTeamOptions() {
  const decade = $("decadeSelect").value;
  const teams = decade ? state.meta.teams_by_decade[decade] || [] : state.meta.teams;
  fillSelect($("teamSelect"), teams, "全部球队");
}

function buildQuery() {
  const params = new URLSearchParams();
  const fields = [
    ["name", $("nameInput").value.trim()],
    ["team", $("teamSelect").value],
    ["decade", $("decadeSelect").value],
    ["position", $("positionSelect").value],
    ["sort", $("sortSelect").value],
    ["order", state.order],
  ];
  fields.forEach(([key, value]) => {
    if (value) params.set(key, value);
  });
  const teamDetailMode = $("detailsToggle").checked && $("teamSelect").value && $("decadeSelect").value;
  state.limit = teamDetailMode ? 500 : Number($("limitSelect").value || 50);
  state.details = $("detailsToggle").checked;
  params.set("limit", String(state.limit));
  params.set("offset", String(state.offset));
  params.set("details", state.details ? "true" : "false");
  params.set("include_1950s", $("include1950sToggle").checked ? "true" : "false");
  return params;
}

async function loadPlayers(resetOffset = false) {
  if (resetOffset) state.offset = 0;
  const params = buildQuery();
  const data = await requestJson(`/api/players?${params.toString()}`);
  state.rows = data.rows;
  state.total = data.total;
  renderTable();
  renderPager();
  const rangeStart = state.total === 0 ? 0 : state.offset + 1;
  const rangeEnd = Math.min(state.offset + state.rows.length, state.total);
  $("resultHint").textContent = `共 ${state.total} 条，当前 ${rangeStart}-${rangeEnd}`;
}

function baseColumns() {
  return [
    ["rank", "#"],
    ["rating", "评分", "rating"],
    ["total", "三项和", "total"],
    ["name", "姓名"],
    ["english", "英文名"],
    ["team", "队"],
    ["era", "年代"],
    ["positions", "位置"],
    ["pts", "PTS", "pts"],
    ["reb", "REB", "reb"],
    ["ast", "AST", "ast"],
    ["stl", "STL", "stl"],
    ["blk", "BLK", "blk"],
  ];
}

function detailColumns() {
  return [
    ["raw_rating", "原始", "raw"],
    ["base_pos", "计权"],
    ["base_score", "基础", "base"],
    ["pts_score", "PTS分", "pts"],
    ["reb_score", "REB分", "reb"],
    ["ast_score", "AST分", "ast"],
    ["stl_score", "STL分", "stl"],
    ["blk_score", "BLK分", "blk"],
    ["versatility", "多位置"],
    ["missing_stats", "缺失"],
  ];
}

function renderColumnHeader([, label, termKey]) {
  return `<th>${termKey ? termLabel(termKey, label) : escapeHtml(label)}</th>`;
}

function decorateSortOptions() {
  const titles = {
    total: TERM_MAP.total.title,
    pts: TERM_MAP.pts.title,
    reb: TERM_MAP.reb.title,
    ast: TERM_MAP.ast.title,
    stl: TERM_MAP.stl.title,
    blk: TERM_MAP.blk.title,
  };
  Object.entries(titles).forEach(([value, title]) => {
    const option = $(`sortSelect`).querySelector(`option[value="${value}"]`);
    if (option) option.title = title;
  });
}

function renderTable() {
  const columns = state.details ? [...baseColumns(), ...detailColumns()] : baseColumns();
  const table = $("playersTable");
  table.querySelector("thead").innerHTML = `
    <tr>
      ${columns.map(renderColumnHeader).join("")}
      <th>操作</th>
    </tr>
  `;
  const tbody = table.querySelector("tbody");
  if (!state.rows.length) {
    tbody.innerHTML = `<tr><td colspan="${columns.length + 1}">没有找到匹配球员</td></tr>`;
    return;
  }
  tbody.innerHTML = state.rows
    .map((row, index) => {
      const globalRank = state.offset + index + 1;
      const cells = columns
        .map(([key]) => {
          if (key === "rank") return `<td class="mono">${globalRank}</td>`;
          if (key === "rating") return `<td><span class="${ratingClass(Number(row.rating))}">${numberText(row.rating)}</span></td>`;
          if (key === "name") return `<td class="name-cell">${escapeHtml(row.name)}</td>`;
          return `<td>${escapeHtml(numberText(row[key]))}</td>`;
        })
        .join("");
      const selected = row.id === state.selectedId ? "selected" : "";
      return `
        <tr class="${selected}" data-player-id="${row.id}">
          ${cells}
          <td><button type="button" data-action="inspect" data-id="${row.id}">查看</button></td>
        </tr>
      `;
    })
    .join("");
}

function renderPager() {
  const start = state.total === 0 ? 0 : state.offset + 1;
  const end = Math.min(state.offset + state.limit, state.total);
  $("pageLabel").textContent = `${start}-${end} / ${state.total}`;
  $("prevBtn").disabled = state.offset <= 0;
  $("nextBtn").disabled = state.offset + state.limit >= state.total;
}

async function inspectPlayer(playerId) {
  const row = await requestJson(`/api/players/${encodeURIComponent(playerId)}`);
  state.selectedId = playerId;
  state.selectedPlayer = row;
  renderTable();
  renderPlayerDetail(row);
}

function radarCap(modeKey, stat) {
  const cap = state.meta?.radar_caps?.[RADAR_MODES[modeKey].capKey]?.[stat];
  const fallback = DEFAULT_RADAR_CAPS[modeKey]?.[stat] || 1;
  return Math.max(numericValue(cap) || fallback, 1);
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function radarAverage(players, modeKey) {
  const mode = RADAR_MODES[modeKey];
  return STAT_KEYS.map((stat) => {
    const total = players.reduce((sum, player) => sum + mode.valueFor(player, stat), 0);
    const value = players.length ? total / players.length : 0;
    const cap = radarCap(modeKey, stat);
    return {
      stat,
      value,
      cap,
      ratio: clamp(value / cap, 0, 1),
    };
  });
}

function radarPoint(center, radius, ratio, index) {
  const angle = -Math.PI / 2 + (index * 2 * Math.PI) / STAT_KEYS.length;
  return {
    x: center + Math.cos(angle) * radius * ratio,
    y: center + Math.sin(angle) * radius * ratio,
  };
}

function pointString(points) {
  return points.map((point) => `${point.x.toFixed(2)},${point.y.toFixed(2)}`).join(" ");
}

function radarValueText(value, modeKey) {
  const suffix = RADAR_MODES[modeKey].suffix;
  if (modeKey === "ratio") return `${numberText(value)}${suffix}`;
  return numberText(value);
}

function renderRadarPanel(title, players, radarId) {
  const activePlayers = players.filter(Boolean);
  const modeKey = state.radarMode;
  const mode = RADAR_MODES[modeKey];
  if (!activePlayers.length) {
    return `
      <div class="radar-card empty-radar" id="${radarId}">
        <div class="radar-head">
          <strong>${escapeHtml(title)}</strong>
          <span>${escapeHtml(mode.label)}</span>
        </div>
        <p>选择球员后显示 ${STAT_KEYS.map((stat) => TERM_MAP[stat].label).join(" / ")} 五维多边形。</p>
      </div>
    `;
  }

  const size = 260;
  const center = size / 2;
  const radius = 86;
  const labelRadius = 113;
  const data = radarAverage(activePlayers, modeKey);
  const grid = [0.25, 0.5, 0.75, 1]
    .map((level) => {
      const points = STAT_KEYS.map((_, index) => radarPoint(center, radius, level, index));
      return `<polygon points="${pointString(points)}"></polygon>`;
    })
    .join("");
  const axes = STAT_KEYS.map((stat, index) => {
    const end = radarPoint(center, radius, 1, index);
    const label = radarPoint(center, labelRadius, 1, index);
    const anchor = Math.abs(label.x - center) < 4 ? "middle" : label.x > center ? "start" : "end";
    const dy = label.y < center - 20 ? "-0.28em" : label.y > center + 20 ? "0.82em" : "0.32em";
    const titleText = termTitle(stat, mode.hint);
    return `
      <line x1="${center}" y1="${center}" x2="${end.x.toFixed(2)}" y2="${end.y.toFixed(2)}"></line>
      <text x="${label.x.toFixed(2)}" y="${label.y.toFixed(2)}" text-anchor="${anchor}" dy="${dy}">
        <title>${escapeHtml(titleText)}</title>${TERM_MAP[stat].label}
      </text>
    `;
  }).join("");
  const shapePoints = data.map((item, index) => radarPoint(center, radius, item.ratio, index));
  const valueDots = shapePoints
    .map((point, index) => {
      const item = data[index];
      return `<circle cx="${point.x.toFixed(2)}" cy="${point.y.toFixed(2)}" r="3.5"><title>${escapeHtml(termTitle(item.stat, `${mode.label} ${radarValueText(item.value, modeKey)}`))}</title></circle>`;
    })
    .join("");
  const values = data
    .map((item) => {
      const detail = `${mode.label} ${radarValueText(item.value, modeKey)}`;
      return `
        <span title="${escapeHtml(termTitle(item.stat, detail))}">
          <strong>${TERM_MAP[item.stat].label}</strong>${radarValueText(item.value, modeKey)}
        </span>
      `;
    })
    .join("");

  return `
    <div class="radar-card" id="${radarId}">
      <div class="radar-head">
        <strong>${escapeHtml(title)}</strong>
        <span>${escapeHtml(mode.label)} · ${activePlayers.length} 人</span>
      </div>
      <svg class="radar-svg" viewBox="0 0 ${size} ${size}" role="img" aria-labelledby="${radarId}-title ${radarId}-desc">
        <title id="${radarId}-title">${escapeHtml(title)}</title>
        <desc id="${radarId}-desc">${escapeHtml(mode.hint)}</desc>
        <g class="radar-grid">${grid}</g>
        <g class="radar-axis">${axes}</g>
        <polygon class="radar-shape" points="${pointString(shapePoints)}"></polygon>
        <g class="radar-dots">${valueDots}</g>
      </svg>
      <div class="radar-values">${values}</div>
    </div>
  `;
}

function selectedLineupPlayers() {
  return POSITIONS.map((slot) => state.lineup[slot]).filter(Boolean);
}

function renderLineupRadar() {
  const target = $("lineupRadar");
  if (!target) return;
  target.innerHTML = renderRadarPanel("阵容维度", selectedLineupPlayers(), "lineupRadarChart");
}

function updateRadarMode(modeKey) {
  if (!RADAR_MODES[modeKey]) return;
  state.radarMode = modeKey;
  $("radarModeHint").textContent = RADAR_MODES[modeKey].hint;
  document.querySelectorAll("[data-radar-mode]").forEach((button) => {
    button.classList.toggle("active", button.dataset.radarMode === modeKey);
    button.setAttribute("aria-pressed", button.dataset.radarMode === modeKey ? "true" : "false");
  });
  if (state.selectedPlayer) renderPlayerDetail(state.selectedPlayer);
  renderLineupRadar();
}

function renderPlayerDetail(row) {
  $("selectedBadge").textContent = `${row.team} ${row.era}`;
  const positions = String(row.positions || "").split("/").filter(Boolean);
  const alreadyUsed = Object.values(state.lineup).some((player) => player && player.id === row.id);
  const slotButtons = POSITIONS.map((slot) => {
    const eligible = positions.includes(slot);
    const occupied = Boolean(state.lineup[slot]);
    const disabled = !eligible || occupied || alreadyUsed ? "disabled" : "";
    const label = alreadyUsed ? "已在阵容" : occupied ? `${slot}已占` : slot;
    return `<button type="button" data-action="put-slot" data-slot="${slot}" ${disabled}>${label}</button>`;
  }).join("");
  $("playerDetail").innerHTML = `
    <div class="detail-name">${escapeHtml(row.name)}</div>
    <div class="detail-sub">${escapeHtml(row.english)} · ${escapeHtml(row.team)} · ${escapeHtml(row.era)} · ${escapeHtml(row.positions)}</div>
    <div class="score-board">
      <div><strong>${numberText(row.rating)}</strong><span>${termLabel("rating", "封顶评分")}</span></div>
      <div><strong>${numberText(row.raw_rating)}</strong><span>${termLabel("raw", "原始评分")}</span></div>
      <div><strong>${numberText(row.total)}</strong><span>${termLabel("total", "三项和")}</span></div>
    </div>
    ${renderRadarPanel("单球员维度", [row], "playerRadarChart")}
    ${formulaLine("基础分", row.base_score, "base")}
    ${formulaLine("PTS贡献", row.pts_score, "pts")}
    ${formulaLine("REB贡献", row.reb_score, "reb")}
    ${formulaLine("AST贡献", row.ast_score, "ast")}
    ${formulaLine("STL贡献", row.stl_score, "stl")}
    ${formulaLine("BLK贡献", row.blk_score, "blk")}
    ${formulaLine("多位置加成", row.versatility)}
    ${formulaLine("无形加成", row.intangible)}
    ${formulaLine("缺失项", row.missing_stats)}
    <div class="slot-buttons">${slotButtons}</div>
  `;
}

function formulaLine(label, value, termKey = null) {
  const content = termKey ? termLabel(termKey, label, "评分明细") : escapeHtml(label);
  return `<div class="formula-row"><span>${content}</span><strong>${escapeHtml(numberText(value))}</strong></div>`;
}

function renderLineup() {
  $("lineupSlots").innerHTML = POSITIONS.map((slot) => {
    const player = state.lineup[slot];
    if (!player) {
      return `
        <div class="lineup-slot">
          <span class="slot-tag">${slot}</span>
          <div class="slot-player"><strong>空位</strong><span>选择可打 ${slot} 的球员</span></div>
          <button type="button" disabled>移除</button>
        </div>
      `;
    }
    return `
      <div class="lineup-slot">
        <span class="slot-tag">${slot}</span>
        <div class="slot-player">
          <strong>${escapeHtml(player.name)}</strong>
          <span>${escapeHtml(player.team)} ${escapeHtml(player.era)} · 评分 ${numberText(player.rating)}</span>
        </div>
        <button type="button" data-action="remove-slot" data-slot="${slot}">移除</button>
      </div>
    `;
  }).join("");
  renderLineupRadar();
}

async function putSelectedInSlot(slot) {
  if (!state.selectedPlayer) return;
  state.lineup[slot] = state.selectedPlayer;
  renderLineup();
  renderPlayerDetail(state.selectedPlayer);
  await simulateIfReady();
}

async function simulateIfReady() {
  state.simulation = null;
  const complete = POSITIONS.every((slot) => state.lineup[slot]);
  if (!complete) {
    const filled = POSITIONS.filter((slot) => state.lineup[slot]).length;
    $("simulationResult").className = "sim-result muted";
    $("simulationResult").textContent = `已填 ${filled}/5，填满后自动模拟。`;
    return;
  }
  const payload = { slots: {} };
  POSITIONS.forEach((slot) => {
    payload.slots[slot] = state.lineup[slot].id;
  });
  try {
    state.simulation = await requestJson("/api/simulate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    renderSimulation();
  } catch (error) {
    $("simulationResult").className = "sim-result muted";
    $("simulationResult").textContent = error.message;
  }
}

function renderSimulation() {
  const sim = state.simulation;
  $("simulationResult").className = "sim-result";
  $("simulationResult").innerHTML = `
    <div class="record">
      <strong>${sim.record}</strong>
      <span style="color:${sim.grade.color}">${sim.grade.grade} · ${sim.grade.label}</span>
    </div>
    <div class="sim-lines">
      <div>几何平均：${numberText(sim.geo_mean)}</div>
      <div>球队总评：${numberText(sim.team_ovr)}</div>
      <div>球员评分：${sim.ratings.map(numberText).join(" / ")}</div>
    </div>
  `;
}

function removeSlot(slot) {
  state.lineup[slot] = null;
  renderLineup();
  if (state.selectedPlayer) renderPlayerDetail(state.selectedPlayer);
  simulateIfReady();
}

function clearLineup() {
  POSITIONS.forEach((slot) => {
    state.lineup[slot] = null;
  });
  renderLineup();
  if (state.selectedPlayer) renderPlayerDetail(state.selectedPlayer);
  simulateIfReady();
}

function exportCurrentCsv() {
  if (!state.rows.length) {
    toast("当前没有可导出的数据");
    return;
  }
  const columns = Object.keys(state.rows[0]);
  const lines = [
    columns.join(","),
    ...state.rows.map((row) => columns.map((key) => csvCell(row[key])).join(",")),
  ];
  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "nba-player-query.csv";
  link.click();
  URL.revokeObjectURL(url);
}

function csvCell(value) {
  const text = value === null || value === undefined ? "" : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

function bindEvents() {
  $("themeToggleBtn").addEventListener("click", toggleTheme);
  $("radarModeControl").addEventListener("click", (event) => {
    const target = event.target.closest("[data-radar-mode]");
    if (target) updateRadarMode(target.dataset.radarMode);
  });
  $("filterForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    await loadPlayers(true);
  });
  $("resetBtn").addEventListener("click", async () => {
    $("filterForm").reset();
    state.order = "desc";
    $("orderBtn").textContent = "降序";
    $("orderBtn").dataset.order = "desc";
    updateTeamOptions();
    await loadPlayers(true);
  });
  $("decadeSelect").addEventListener("change", updateTeamOptions);
  $("detailsToggle").addEventListener("change", () => loadPlayers(true));
  $("include1950sToggle").addEventListener("change", () => loadPlayers(true));
  $("orderBtn").addEventListener("click", async () => {
    state.order = state.order === "desc" ? "asc" : "desc";
    $("orderBtn").dataset.order = state.order;
    $("orderBtn").textContent = state.order === "desc" ? "降序" : "升序";
    await loadPlayers(true);
  });
  $("prevBtn").addEventListener("click", () => {
    state.offset = Math.max(0, state.offset - state.limit);
    loadPlayers(false);
  });
  $("nextBtn").addEventListener("click", () => {
    state.offset += state.limit;
    loadPlayers(false);
  });
  $("exportBtn").addEventListener("click", exportCurrentCsv);
  $("clearLineupBtn").addEventListener("click", clearLineup);
  $("playersTable").addEventListener("click", async (event) => {
    const target = event.target.closest("[data-action='inspect'], tr[data-player-id]");
    if (!target) return;
    const playerId = target.dataset.id || target.dataset.playerId;
    if (playerId) await inspectPlayer(playerId);
  });
  $("playerDetail").addEventListener("click", async (event) => {
    const target = event.target.closest("[data-action='put-slot']");
    if (target) await putSelectedInSlot(target.dataset.slot);
  });
  $("lineupSlots").addEventListener("click", (event) => {
    const target = event.target.closest("[data-action='remove-slot']");
    if (target) removeSlot(target.dataset.slot);
  });
}

async function init() {
  initTheme();
  bindEvents();
  updateRadarMode(state.radarMode);
  renderLineup();
  state.meta = await requestJson("/api/meta");
  renderMeta();
  await loadPlayers(true);
}

init().catch((error) => {
  console.error(error);
  toast(error.message);
});
