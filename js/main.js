(function () {
  const config = window.CUP_SITE_CONFIG;
  const state = {
    schedule: null,
    source: "Loading",
  };

  document.addEventListener("DOMContentLoaded", init);

  async function init() {
    try {
      const loaded = await loadSchedule();
      state.schedule = loaded.data;
      state.source = loaded.source;
    } catch (error) {
      renderError(error);
      return;
    }

    renderAll();
    window.setInterval(refreshSchedule, config.refreshIntervalMs || 60000);
  }

  async function refreshSchedule() {
    try {
      const response = await fetchWithTimeout(config.remoteScheduleUrl, 5000);
      if (!response.ok) {
        throw new Error(`remote status ${response.status}`);
      }
      state.schedule = await response.json();
      state.source = "OpenFootball API";
    } catch {
      // Keep the last loaded schedule when a background refresh fails.
    }
    renderAll();
  }

  async function loadSchedule() {
    try {
      const response = await fetchWithTimeout(config.remoteScheduleUrl, 5000);
      if (!response.ok) {
        throw new Error(`remote status ${response.status}`);
      }
      return { source: "OpenFootball API", data: await response.json() };
    } catch {
      const fallback = await fetch(config.localScheduleUrl, { cache: "no-store" });
      if (!fallback.ok) {
        throw new Error("本地赛程数据加载失败");
      }
      return { source: "Local Fallback", data: await fallback.json() };
    }
  }

  async function fetchWithTimeout(url, timeoutMs) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(url, {
        cache: "no-store",
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
  }

  function renderAll() {
    const matches = state.schedule.matches;
    const matchRecommendationBets = config.matchRecommendationBets || [];
    const championBets = config.championBets || [];
    const completedMatches = matches.filter(
      (match) => getMatchStatus(match).key === "completed",
    ).length;
    const totalUnits = [...matchRecommendationBets, ...championBets].reduce(
      (sum, bet) => sum + Number(bet.units || 0),
      0,
    );

    text("#totalMatches", matches.length);
    text("#completedMatches", completedMatches);
    text("#dataMode", state.source);
    text("#hitRate", "--");
    text("#hitRateDetail", "等待赛果");
    text("#settledTips", getSettledMatchRecommendationCount(matches));
    text("#hitTips", 0);
    text("#totalUnits", totalUnits);
    text("#netUnits", "--");
    text("#roi", "--");

    renderGroupSchedule(matches);
    renderBracket(matches);
    renderTips(matches);
    renderResults(matches);
    renderChampionPicks();
  }

  function renderGroupSchedule(matches) {
    const container = query("#groupSchedule");
    const groups = groupBy(
      matches.filter((match) => match.group),
      (match) => match.group,
    );

    container.innerHTML = Object.entries(groups)
      .map(([group, groupMatches]) => {
        const groupLetter = group.replace("Group ", "");
        return `
          <article class="group-card">
            <div class="group-title">
              <strong>${escapeHtml(groupLetter)} 组</strong>
              <span>${groupMatches.length} 场</span>
            </div>
            <div class="match-list">
              ${groupMatches.map((match) => renderMatchRow(match)).join("")}
            </div>
          </article>
        `;
      })
      .join("");
  }

  function renderMatchRow(match) {
    return `
      <div class="match-row">
        <span class="team-pair">${team(match.team1)} <b>vs</b> ${team(match.team2)}</span>
        <span class="match-meta">${renderMatchState(match)}</span>
      </div>
    `;
  }

  function renderBracket(matches) {
    const container = query("#bracketBoard");
    const knockout = matches.filter((match) => !match.group);
    const grouped = groupBy(knockout, (match) => match.round);
    const roundOrder = [
      "Round of 32",
      "Round of 16",
      "Quarter-final",
      "Semi-final",
      "Match for third place",
      "Final",
    ];

    container.innerHTML = roundOrder
      .map((round) => {
        const roundMatches = grouped[round] || [];
        return `
          <section class="bracket-column">
            <h3>${roundName(round)}</h3>
            ${roundMatches
              .map(
                (match) => `
                  <div class="bracket-match">
                    <div class="bracket-team-line">
                      <span>${team(match.team1)}</span>
                      <span class="bracket-state">${renderMatchState(match)}</span>
                    </div>
                    <small>${formatDate(match.date)} · ${escapeHtml(match.ground || "TBD")}</small>
                    <span>${team(match.team2)}</span>
                  </div>
                `,
              )
              .join("")}
          </section>
        `;
      })
      .join("");
  }

  function renderTips(matches) {
    const bets = config.matchRecommendationBets || [];
    query("#tipCards").innerHTML = bets
      .map(
        (bet) => {
          const match = findMatchForBet(matches, bet);
          return `
          <article class="tip-card pending">
            <div class="tip-teams">
              ${team(bet.team1 || match?.team1 || "TBD")}
              <span> vs </span>
              ${team(bet.team2 || match?.team2 || "TBD")}
            </div>
            <dl>
              <div>
                <dt>类型</dt>
                <dd>${escapeHtml(bet.market || "场次推荐")}</dd>
              </div>
              <div>
                <dt>选择</dt>
                <dd>${escapeHtml(bet.selection || "-")}</dd>
              </div>
              <div>
                <dt>阶段</dt>
                <dd>${escapeHtml(match?.group ? `${match.group.replace("Group ", "")} 组` : roundName(match?.round || bet.round || "-"))}</dd>
              </div>
              <div>
                <dt>注数</dt>
                <dd>${escapeHtml(bet.units)} 注</dd>
              </div>
            </dl>
            <div class="tip-result">待赛果</div>
          </article>
        `;
        },
      )
      .join("");
  }

  function renderResults(matches) {
    const completed = matches
      .filter(
        (match) =>
          getMatchStatus(match).key === "completed" &&
          getRegularTimeScore(match),
      )
      .sort((a, b) => (getMatchStartTime(b) || 0) - (getMatchStartTime(a) || 0));

    query("#resultRows").innerHTML = completed
      .map(
        (match) => `
          <tr>
            <td>${formatDate(match.date)}</td>
            <td>${escapeHtml(match.group ? `${match.group.replace("Group ", "")} 组` : roundName(match.round))}</td>
            <td>${team(match.team1)} <b>vs</b> ${team(match.team2)}</td>
            <td><span class="match-score">${escapeHtml(getRegularTimeScoreText(match))}</span></td>
            <td><span class="result-pill settled">${escapeHtml(getRegularTimeResult(match))}</span></td>
          </tr>
        `,
      )
      .join("");
  }

  function renderChampionPicks() {
    const bets = config.championBets || [];
    query("#championPicks").innerHTML = bets
      .map(
        (bet, index) => `
          <article class="champion-row">
            <div>
              <span class="champion-flag">${index + 1}</span>
              <strong>${escapeHtml(bet.championLabel || bet.champion)}</strong>
              <small>${escapeHtml(bet.runnerUpLabel || bet.runnerUp)} 亚军</small>
            </div>
            <div class="champion-odds">
              <span>${betTeam(bet.champion, bet.championLabel)} / ${betTeam(
                bet.runnerUp,
                bet.runnerUpLabel,
              )}</span>
              <b>${escapeHtml(bet.units)}</b>
              <em>注</em>
            </div>
          </article>
        `,
      )
      .join("");
  }

  function team(name) {
    if (!name) return "TBD";
    const flagCode = config.flagCodeMap?.[name];
    if (flagCode) {
      return `<span class="team"><img class="flag" src="assets/flags/${flagCode}.svg" alt="" loading="lazy" />${escapeHtml(name)}</span>`;
    }
    const fallback = /^[WL]\d+|^[123][A-L]/.test(name) ? "🏆" : "⚽";
    return `<span class="team"><span class="flag-fallback" aria-hidden="true">${fallback}</span>${escapeHtml(name)}</span>`;
  }

  function betTeam(name, label) {
    const flagCode = config.flagCodeMap?.[name];
    const displayName = label || name;
    if (flagCode) {
      return `<span class="team"><img class="flag" src="assets/flags/${flagCode}.svg" alt="" loading="lazy" />${escapeHtml(displayName)}</span>`;
    }
    return `<span class="team"><span class="flag-fallback" aria-hidden="true">◎</span>${escapeHtml(displayName)}</span>`;
  }

  function getSettledMatchRecommendationCount(matches) {
    const bets = config.matchRecommendationBets || [];
    return bets.filter((bet) => {
      const match = findMatchForBet(matches, bet);
      return match && getMatchStatus(match).key === "completed";
    }).length;
  }

  function findMatchForBet(matches, bet) {
    if (bet.matchId) {
      return matches.find((match) => String(match.num || match.id) === String(bet.matchId));
    }
    return matches.find(
      (match) =>
        (!bet.date || match.date === bet.date) &&
        match.team1 === bet.team1 &&
        match.team2 === bet.team2,
    );
  }

  function roundName(round) {
    const map = {
      "Round of 32": "32 强",
      "Round of 16": "16 强",
      "Quarter-final": "8 强",
      "Quarter-finals": "8 强",
      "Semi-final": "半决赛",
      "Semi-finals": "半决赛",
      "Match for third place": "季军赛",
      "Third place": "季军赛",
      Final: "决赛",
    };
    return map[round] || round;
  }

  function getMatchStatus(match) {
    const rawStatus = String(match.status || "").toLowerCase();
    if (/live|playing|in.?progress/.test(rawStatus)) {
      return { key: "live", label: "正在比赛", className: "live" };
    }
    if (
      /finished|completed|ended|final/.test(rawStatus) ||
      getRegularTimeScore(match)
    ) {
      return { key: "completed", label: "等待比分", className: "settled" };
    }

    const startTime = getMatchStartTime(match);
    if (!startTime || Date.now() < startTime) {
      return { key: "scheduled", label: "未开赛", className: "pending" };
    }
    if (Date.now() < startTime + 3 * 60 * 60 * 1000) {
      return { key: "live", label: "正在比赛", className: "live" };
    }
    return { key: "awaiting-update", label: "等待数据", className: "update" };
  }

  function getMatchStartTime(match) {
    const dateParts = String(match.date || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
    const timeParts = String(match.time || "").match(
      /^(\d{1,2}):(\d{2})\s*UTC([+-]\d{1,2})?/i,
    );
    if (!dateParts || !timeParts) return null;

    const [, year, month, day] = dateParts;
    const [, hour, minute, offsetText] = timeParts;
    const utcOffset = Number(offsetText || 0);
    return Date.UTC(
      Number(year),
      Number(month) - 1,
      Number(day),
      Number(hour) - utcOffset,
      Number(minute),
    );
  }

  function renderMatchState(match) {
    const status = getMatchStatus(match);
    const score = getRegularTimeScoreText(match);
    if (status.key === "completed" && score) {
      return `<span class="match-score" aria-label="常规时间比分">${escapeHtml(score)}</span>`;
    }
    return `<span class="status ${status.className}">${status.label}</span>`;
  }

  function getRegularTimeScore(match) {
    const candidate = match.score?.ft || match.score;
    if (
      Array.isArray(candidate) &&
      candidate.length >= 2 &&
      candidate[0] !== null &&
      candidate[0] !== undefined &&
      candidate[1] !== null &&
      candidate[1] !== undefined
    ) {
      return [Number(candidate[0]), Number(candidate[1])];
    }
    if (typeof candidate === "string" && candidate.trim()) {
      const values = candidate.match(/\d+/g);
      if (values?.length >= 2) {
        return [Number(values[0]), Number(values[1])];
      }
    }
    return null;
  }

  function getRegularTimeScoreText(match) {
    const score = getRegularTimeScore(match);
    return score ? `${score[0]} - ${score[1]}` : "";
  }

  function getRegularTimeResult(match) {
    const score = getRegularTimeScore(match);
    if (!score || score[0] === score[1]) return "平局";
    return score[0] > score[1] ? `${match.team1} 胜` : `${match.team2} 胜`;
  }

  function groupBy(items, getKey) {
    return items.reduce((result, item) => {
      const key = getKey(item);
      if (!result[key]) result[key] = [];
      result[key].push(item);
      return result;
    }, {});
  }

  function formatDate(value) {
    const date = new Date(`${value}T00:00:00`);
    return `${String(date.getMonth() + 1).padStart(2, "0")}-${String(
      date.getDate(),
    ).padStart(2, "0")}`;
  }

  function text(selector, value) {
    query(selector).textContent = value;
  }

  function query(selector) {
    const element = document.querySelector(selector);
    if (!element) throw new Error(`missing element ${selector}`);
    return element;
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function renderError(error) {
    document.body.innerHTML = `
      <main class="error-screen">
        <h1>数据加载失败</h1>
        <p>${escapeHtml(error instanceof Error ? error.message : String(error))}</p>
      </main>
    `;
  }
})();
