const POSITIONS = ["PG", "SG", "SF", "PF", "C"];

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
};

const $ = (id) => document.getElementById(id);

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
    ["rating", "评分"],
    ["total", "三项和"],
    ["name", "姓名"],
    ["english", "英文名"],
    ["team", "队"],
    ["era", "年代"],
    ["positions", "位置"],
    ["pts", "PTS"],
    ["reb", "REB"],
    ["ast", "AST"],
    ["stl", "STL"],
    ["blk", "BLK"],
  ];
}

function detailColumns() {
  return [
    ["raw_rating", "原始"],
    ["base_pos", "计权"],
    ["base_score", "基础"],
    ["pts_score", "PTS分"],
    ["reb_score", "REB分"],
    ["ast_score", "AST分"],
    ["stl_score", "STL分"],
    ["blk_score", "BLK分"],
    ["versatility", "多位置"],
    ["missing_stats", "缺失"],
  ];
}

function renderTable() {
  const columns = state.details ? [...baseColumns(), ...detailColumns()] : baseColumns();
  const table = $("playersTable");
  table.querySelector("thead").innerHTML = `
    <tr>
      ${columns.map(([, label]) => `<th>${label}</th>`).join("")}
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
          if (key === "name") return `<td class="name-cell">${row.name}</td>`;
          return `<td>${numberText(row[key])}</td>`;
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
    <div class="detail-name">${row.name}</div>
    <div class="detail-sub">${row.english} · ${row.team} · ${row.era} · ${row.positions}</div>
    <div class="score-board">
      <div><strong>${numberText(row.rating)}</strong><span>封顶评分</span></div>
      <div><strong>${numberText(row.raw_rating)}</strong><span>原始评分</span></div>
      <div><strong>${numberText(row.total)}</strong><span>三项和</span></div>
    </div>
    ${formulaLine("基础分", row.base_score)}
    ${formulaLine("PTS贡献", row.pts_score)}
    ${formulaLine("REB贡献", row.reb_score)}
    ${formulaLine("AST贡献", row.ast_score)}
    ${formulaLine("STL贡献", row.stl_score)}
    ${formulaLine("BLK贡献", row.blk_score)}
    ${formulaLine("多位置加成", row.versatility)}
    ${formulaLine("无形加成", row.intangible)}
    ${formulaLine("缺失项", row.missing_stats)}
    <div class="slot-buttons">${slotButtons}</div>
  `;
}

function formulaLine(label, value) {
  return `<div class="formula-row"><span>${label}</span><strong>${numberText(value)}</strong></div>`;
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
          <strong>${player.name}</strong>
          <span>${player.team} ${player.era} · 评分 ${numberText(player.rating)}</span>
        </div>
        <button type="button" data-action="remove-slot" data-slot="${slot}">移除</button>
      </div>
    `;
  }).join("");
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
  bindEvents();
  renderLineup();
  state.meta = await requestJson("/api/meta");
  renderMeta();
  await loadPlayers(true);
}

init().catch((error) => {
  console.error(error);
  toast(error.message);
});
