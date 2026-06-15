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
    const settledRecommendations = getSettledMatchRecommendationSettlements(matches);
    const hitRecommendations = settledRecommendations.filter(
      (settlement) => settlement.status === "hit",
    );
    const stakePerUnit = Number(config.stakePerUnit || 2);
    const completedMatches = matches.filter(
      (match) => getMatchStatus(match).key === "completed",
    ).length;
    const totalUnits = [...matchRecommendationBets, ...championBets].reduce(
      (sum, bet) => sum + Number(bet.units || 0),
      0,
    );
    const totalStakeAmount = totalUnits * stakePerUnit;
    const settledStakeAmount = settledRecommendations.reduce(
      (sum, settlement) => sum + settlement.stakeAmount,
      0,
    );
    const netAmount = settledRecommendations.reduce(
      (sum, settlement) => sum + settlement.profitAmount,
      0,
    );

    text("#totalMatches", matches.length);
    text("#completedMatches", completedMatches);
    text("#dataMode", state.source);
    text(
      "#hitRate",
      settledRecommendations.length
        ? `${Math.round((hitRecommendations.length / settledRecommendations.length) * 100)}%`
        : "--",
    );
    text(
      "#hitRateDetail",
      settledRecommendations.length
        ? `${hitRecommendations.length} / ${settledRecommendations.length}`
        : "等待赛果",
    );
    text("#settledTips", settledRecommendations.length);
    text("#hitTips", hitRecommendations.length);
    text("#totalUnits", formatCurrency(totalStakeAmount));
    text("#totalUnitsDetail", `${totalUnits} 注`);
    text("#netUnits", formatSignedCurrency(netAmount));
    text(
      "#roi",
      settledStakeAmount ? `${((netAmount / settledStakeAmount) * 100).toFixed(1)}%` : "--",
    );

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
    const bets = [...(config.matchRecommendationBets || [])].sort((a, b) =>
      compareBetsByDisplayPriority(a, b, matches),
    );
    let parlayGroupNumber = 0;
    const displayItems = bets.flatMap((bet, betIndex) => {
      const isParlay = Array.isArray(bet.legs) && bet.legs.length > 0;
      if (isParlay) parlayGroupNumber += 1;
      return getTipDisplayItems(bet, betIndex, matches, isParlay ? parlayGroupNumber : null);
    });
    const container = query("#tipCards");
    container.innerHTML = displayItems.map((item) => renderTipCard(item, matches)).join("");
    container.scrollTop = 0;
  }

  function getTipDisplayItems(bet, betIndex, matches, parlayGroupNumber) {
    const legs = Array.isArray(bet.legs) && bet.legs.length > 0 ? bet.legs : [bet];
    return legs.map((leg, legIndex) => ({
      bet,
      leg,
      betIndex,
      parlayGroupNumber,
      legIndex,
      legCount: legs.length,
      match: findMatchForBet(matches, leg),
      isParlay: legs.length > 1,
    }));
  }

  function renderTipCard(item, matches) {
    const { bet, leg, match, isParlay, legIndex, legCount, parlayGroupNumber } = item;
    const settlement = settleMatchRecommendation(bet, matches);
    const toneClass = isParlay ? `parlay-tone-${(parlayGroupNumber - 1) % 6}` : "";
    const positionClass = isParlay
      ? legIndex === 0
        ? "parlay-start"
        : legIndex === legCount - 1
          ? "parlay-end"
          : "parlay-middle"
      : "";
    const oddsLabel = isParlay
      ? `${formatOdds(leg.odds)} / 串${formatOdds(getBetOdds(bet))}`
      : formatOdds(leg.odds || getBetOdds(bet));

    return `
      <article class="tip-card ${settlement.className} ${
        isParlay ? "parlay-card" : "single-card"
      } ${toneClass} ${positionClass}">
        <div class="tip-card-head">
          <span class="tip-mode ${isParlay ? "parlay" : "single"}">${
            isParlay ? `串关 ${String(parlayGroupNumber).padStart(2, "0")}` : "单关"
          }</span>
          <span class="tip-count">${isParlay ? `${legIndex + 1}/${legCount}` : "1/1"}</span>
        </div>
        <div class="tip-teams">${renderBetTeams(leg)}</div>
        <dl>
          <div>
            <dt>类型</dt>
            <dd>${escapeHtml(leg.market || bet.market || "场次推荐")}</dd>
          </div>
          <div>
            <dt>选择</dt>
            <dd>${escapeHtml(leg.selection || "-")}</dd>
          </div>
          <div>
            <dt>赔率</dt>
            <dd>${escapeHtml(oddsLabel)}</dd>
          </div>
          <div>
            <dt>阶段</dt>
            <dd>${escapeHtml(getBetStageLabel(leg, match, matches))}</dd>
          </div>
          <div>
            <dt>${isParlay ? "组注数" : "注数"}</dt>
            <dd>${escapeHtml(bet.units)} 注</dd>
          </div>
        </dl>
        <div class="tip-result">${escapeHtml(
          isParlay ? `串关 · ${settlement.resultLabel}` : settlement.resultLabel,
        )}</div>
      </article>
    `;
  }

  function renderResults(matches) {
    const completed = getSettledMatchRecommendationSettlements(matches).sort(
      (a, b) => b.sortTime - a.sortTime,
    );

    query("#resultRows").innerHTML = completed
      .map(
        (settlement) => `
          <tr>
            <td>${escapeHtml(settlement.dateLabel)}</td>
            <td>${escapeHtml(settlement.stageLabel)}</td>
            <td>${settlement.matchLabel}</td>
            <td>${escapeHtml(settlement.selectionLabel)}</td>
            <td>${escapeHtml(settlement.oddsLabel)}</td>
            <td><span class="match-score">${escapeHtml(settlement.scoreLabel)}</span></td>
            <td><span class="result-pill ${settlement.className}">${escapeHtml(settlement.label)}</span></td>
            <td><span class="profit ${settlement.className}">${escapeHtml(settlement.profitLabel)}</span></td>
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
              <b>${escapeHtml(formatOdds(bet.odds))}</b>
              <em>${escapeHtml(bet.units)}注</em>
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

  function renderBetTeams(bet) {
    if (Array.isArray(bet.legs) && bet.legs.length > 0) {
      return `
        <div class="tip-leg-list">
          ${bet.legs
            .map(
              (leg) => `
                <div class="tip-leg">
                  ${betTeam(leg.team1, leg.team1Label)}
                  <span>vs</span>
                  ${betTeam(leg.team2, leg.team2Label)}
                  <em>${escapeHtml(
                    `${leg.selection || ""}${leg.odds ? ` @${formatOdds(leg.odds)}` : ""}`,
                  )}</em>
                </div>
              `,
            )
            .join("")}
        </div>
      `;
    }
    return `
      ${betTeam(bet.team1, bet.team1Label)}
      <span>vs</span>
      ${betTeam(bet.team2, bet.team2Label)}
    `;
  }

  function getBetStageLabel(bet, match, matches) {
    if (Array.isArray(bet.legs) && bet.legs.length > 0) {
      const legMatches = bet.legs.map((leg) => findMatchForBet(matches, leg));
      if (legMatches.every((legMatch) => legMatch?.group)) return "小组赛";
      return bet.market || "串关";
    }
    if (match?.group) return `${match.group.replace("Group ", "")} 组`;
    return roundName(match?.round || bet.round || "-");
  }

  function getBetStatusLabel(bet, matches) {
    return settleMatchRecommendation(bet, matches).label;
  }

  function getSettledMatchRecommendationSettlements(matches) {
    const bets = config.matchRecommendationBets || [];
    return bets
      .map((bet) => settleMatchRecommendation(bet, matches))
      .filter(
        (settlement) =>
          settlement.status === "hit" || settlement.status === "miss",
      );
  }

  function settleMatchRecommendation(bet, matches) {
    const legMatches = getBetLegMatches(bet, matches);
    const allFound = legMatches.every(({ match }) => match);
    if (!allFound) {
      return buildBetSettlement(bet, legMatches, "pending", "待赛果", "pending");
    }

    const statuses = legMatches.map(({ match }) => getMatchStatus(match));
    if (statuses.some((status) => status.key === "live")) {
      return buildBetSettlement(bet, legMatches, "live", "正在比赛", "pending");
    }
    if (!statuses.every((status) => status.key === "completed")) {
      return buildBetSettlement(bet, legMatches, "pending", "待赛果", "pending");
    }

    const resolutions = legMatches.map(({ leg, match }) =>
      getRecommendationLegResolution(leg, match),
    );
    const unresolved = resolutions.find((resolution) => resolution.status === "unresolved");
    if (unresolved) {
      return buildBetSettlement(bet, legMatches, "pending", unresolved.label, "pending");
    }

    const hit = resolutions.every((resolution) => resolution.status === "hit");
    return buildBetSettlement(
      bet,
      legMatches,
      hit ? "hit" : "miss",
      hit ? "命中" : "未命中",
      hit ? "hit" : "miss",
    );
  }

  function buildBetSettlement(bet, legMatches, status, label, className) {
    const matches = legMatches.map(({ match }) => match).filter(Boolean);
    const firstMatch = matches[0];
    const odds = getBetOdds(bet);
    const stakeAmount = Number(bet.units || 0) * Number(config.stakePerUnit || 2);
    const payoutAmount = status === "hit" ? stakeAmount * odds : 0;
    const profitAmount =
      status === "hit" ? payoutAmount - stakeAmount : status === "miss" ? -stakeAmount : 0;
    const resultLabel =
      status === "hit" || status === "miss"
        ? `${label} ${formatSignedCurrency(profitAmount)}`
        : label;
    const stageLabel =
      legMatches.length > 1
        ? bet.market || "串关"
        : getBetStageLabel(bet, firstMatch, matches);
    const matchLabel = legMatches
      .map(({ leg, match }) => {
        const team1Name = leg.team1 || match?.team1 || "TBD";
        const team2Name = leg.team2 || match?.team2 || "TBD";
        return `${betTeam(team1Name, leg.team1Label)} <b>vs</b> ${betTeam(
          team2Name,
          leg.team2Label,
        )}`;
      })
      .join('<span class="result-separator"> / </span>');
    return {
      bet,
      status,
      label,
      resultLabel,
      className,
      stageLabel,
      matchLabel,
      selectionLabel: bet.selection || "-",
      odds,
      oddsLabel: formatOdds(odds),
      stakeAmount,
      payoutAmount,
      profitAmount,
      profitLabel: status === "hit" || status === "miss" ? formatSignedCurrency(profitAmount) : "-",
      scoreLabel:
        legMatches
          .map(({ match }) => (match ? getRegularTimeScoreText(match) : ""))
          .filter(Boolean)
          .join(" / ") || "-",
      dateLabel:
        legMatches
          .map(({ leg, match }) => leg.date || match?.date)
          .filter(Boolean)
          .map(formatDate)
          .join(" / ") || "-",
      sortTime: matches.length
        ? Math.max(...matches.map((match) => getMatchStartTime(match) || 0), 0)
        : 0,
    };
  }

  function getBetOdds(bet) {
    if (Number(bet.odds) > 0) return Number(bet.odds);
    if (Array.isArray(bet.legs) && bet.legs.length > 0) {
      return bet.legs.reduce((product, leg) => product * Number(leg.odds || 1), 1);
    }
    return 1;
  }

  function getBetMatches(bet, matches) {
    return getBetLegMatches(bet, matches)
      .map(({ match }) => match)
      .filter(Boolean);
  }

  function compareBetsByDisplayPriority(a, b, matches) {
    const priorityA = getBetDisplayPriority(a, matches);
    const priorityB = getBetDisplayPriority(b, matches);
    if (priorityA.rank !== priorityB.rank) return priorityA.rank - priorityB.rank;
    return priorityA.time - priorityB.time;
  }

  function getBetDisplayPriority(bet, matches) {
    const legMatches = getBetMatches(bet, matches);
    const now = Date.now();
    const liveTimes = legMatches
      .filter((match) => getMatchStatus(match).key === "live")
      .map(getMatchStartTime)
      .filter(Number.isFinite);
    if (liveTimes.length) return { rank: 0, time: Math.min(...liveTimes) };

    const futureTimes = legMatches
      .map(getMatchStartTime)
      .filter((time) => Number.isFinite(time) && time >= now);
    if (futureTimes.length) return { rank: 1, time: Math.min(...futureTimes) };

    const awaitingTimes = legMatches
      .filter((match) => getMatchStatus(match).key === "awaiting-update")
      .map(getMatchStartTime)
      .filter(Number.isFinite);
    if (awaitingTimes.length) return { rank: 2, time: Math.min(...awaitingTimes) };

    const completedTimes = legMatches.map(getMatchStartTime).filter(Number.isFinite);
    if (completedTimes.length) {
      return { rank: 3, time: -Math.max(...completedTimes) };
    }
    return { rank: 4, time: Number.MAX_SAFE_INTEGER };
  }

  function getBetLegMatches(bet, matches) {
    const legs = Array.isArray(bet.legs) && bet.legs.length > 0 ? bet.legs : [bet];
    return legs.map((leg) => ({ leg, match: findMatchForBet(matches, leg) }));
  }

  function getRecommendationLegResolution(leg, match) {
    const score = getRegularTimeScore(match);
    const selection = String(leg.selection || "").trim();
    if (!score || !selection) return { status: "unresolved", label: "待赛果" };

    const scorePick = selection.match(/^(\d+)\s*[:：-]\s*(\d+)$/);
    if (scorePick) {
      return buildLegResolution(
        Number(scorePick[1]) === score[0] && Number(scorePick[2]) === score[1],
      );
    }

    const totalGoalsPick = selection.match(/^总进\s*(\d+)\s*球$/);
    if (totalGoalsPick) {
      return buildLegResolution(score[0] + score[1] === Number(totalGoalsPick[1]));
    }

    if (leg.requiresHandicap || selection.startsWith("让")) {
      const handicap = getLegHandicap(leg);
      if (!Number.isFinite(handicap)) {
        return { status: "unresolved", label: "待盘口" };
      }
      const handicapSelection = selection.replace(/^让球?/, "");
      return buildLegResolution(getOutcomeCode([score[0] + handicap, score[1]]) === handicapSelection);
    }

    const otherScoreResolution = getOtherScoreResolution(selection, score);
    if (otherScoreResolution) return otherScoreResolution;

    if (leg.requiresMarketDefinition) {
      return { status: "unresolved", label: "待规则" };
    }

    const halfFullPick = selection.match(/^(胜|平|负)(胜|平|负)$/);
    if (halfFullPick) {
      const halfScore = getHalfTimeScore(match);
      if (!halfScore) return { status: "unresolved", label: "待半场" };
      return buildLegResolution(
        Boolean(halfScore) &&
          getOutcomeCode(halfScore) === halfFullPick[1] &&
          getOutcomeCode(score) === halfFullPick[2],
      );
    }

    if (selection === "胜" || selection === "平" || selection === "负") {
      return buildLegResolution(getOutcomeCode(score) === selection);
    }

    if (selection.endsWith("胜")) {
      if (selection.includes(leg.team1Label || leg.team1)) return buildLegResolution(score[0] > score[1]);
      if (selection.includes(leg.team2Label || leg.team2)) return buildLegResolution(score[1] > score[0]);
    }

    if (selection.endsWith("负")) {
      if (selection.includes(leg.team1Label || leg.team1)) return buildLegResolution(score[0] < score[1]);
      if (selection.includes(leg.team2Label || leg.team2)) return buildLegResolution(score[1] < score[0]);
    }

    return { status: "unresolved", label: "待规则" };
  }

  function buildLegResolution(hit) {
    return { status: hit ? "hit" : "miss", label: hit ? "命中" : "未命中" };
  }

  function getLegHandicap(leg) {
    if (leg.handicap !== undefined && leg.handicap !== null && leg.handicap !== "") {
      return Number(leg.handicap);
    }
    return Number(config.handicapMap?.[leg.team1]);
  }

  function getOtherScoreResolution(selection, score) {
    const scoreText = `${score[0]}:${score[1]}`;
    const listedHomeWins = new Set([
      "1:0",
      "2:0",
      "2:1",
      "3:0",
      "3:1",
      "3:2",
      "4:0",
      "4:1",
      "4:2",
      "5:0",
      "5:1",
      "5:2",
    ]);
    const listedDraws = new Set(["0:0", "1:1", "2:2", "3:3"]);
    const listedAwayWins = new Set([
      "0:1",
      "0:2",
      "1:2",
      "0:3",
      "1:3",
      "2:3",
      "0:4",
      "1:4",
      "2:4",
      "0:5",
      "1:5",
      "2:5",
    ]);

    if (selection === "胜其它") {
      return buildLegResolution(score[0] > score[1] && !listedHomeWins.has(scoreText));
    }
    if (selection === "平其它") {
      return buildLegResolution(score[0] === score[1] && !listedDraws.has(scoreText));
    }
    if (selection === "负其它") {
      return buildLegResolution(score[0] < score[1] && !listedAwayWins.has(scoreText));
    }
    return null;
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

  function getHalfTimeScore(match) {
    const candidate = match.score?.ht;
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
    return null;
  }

  function getOutcomeCode(score) {
    if (!score) return "";
    if (score[0] > score[1]) return "胜";
    if (score[0] < score[1]) return "负";
    return "平";
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

  function formatOdds(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return "-";
    return Number.isInteger(number) ? String(number) : number.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
  }

  function formatCurrency(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return "¥0";
    return `¥${formatAmount(number)}`;
  }

  function formatSignedCurrency(value) {
    const number = Number(value);
    if (!Number.isFinite(number) || number === 0) return "¥0";
    return `${number > 0 ? "+" : "-"}¥${formatAmount(Math.abs(number))}`;
  }

  function formatAmount(value) {
    return Number(value.toFixed(2)).toLocaleString("zh-CN", {
      minimumFractionDigits: Number.isInteger(Number(value.toFixed(2))) ? 0 : 2,
      maximumFractionDigits: 2,
    });
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
