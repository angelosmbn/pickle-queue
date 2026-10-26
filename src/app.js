import {
  addPlayer, cancelProposedMatch, createCustomMatch, createSession, editQueuedMatch, endSession, generateMatches, getStatistics,
  editCompletedScore, getStrategyName, pauseSession, pauseMatch, recordResultAndGenerate, removePlayer, resumeMatch, resumeSession, setPlayerAvailability, stopMatch,
  skillName, startMatch, startSession, updateOrganizerDetails, updatePlayer, SKILLS, matchFairness
} from "./domain.js";
import { clearSession, loadSession, saveSession } from "./persistence.js";

const app = document.querySelector("#app");
const resultDialog = document.querySelector("#result-dialog");
const resultForm = document.querySelector("#result-form");
const matchDialog = document.querySelector("#match-dialog");
const matchForm = document.querySelector("#match-form");
const playerDialog = document.querySelector("#player-dialog");
const playerForm = document.querySelector("#player-form");
const organizerDialog = document.querySelector("#organizer-dialog");
const organizerForm = document.querySelector("#organizer-form");
const feedbackDialog = document.querySelector("#feedback-dialog");
const feedbackForm = document.querySelector("#feedback-form");
let session;
let notice = "";
let addFormOpen = false;
let pendingSessionAction;

try {
  session = loadSession();
} catch (error) {
  notice = error.message;
}

function persist() {
  if (session) saveSession(session);
}

function render() {
  if (!session) {
    app.innerHTML = `
      <section class="welcome">
        <div class="welcome-mark">PQ</div>
        <p class="eyebrow">YOUR CLUB, IN GOOD ROTATION</p>
        <h1>Make every court<br>feel like <em>your court.</em></h1>
        <p class="welcome-copy">Fair, easy-to-run pickleball sessions—without a clipboard full of matchups.</p>
        ${notice ? `<p class="notice notice-error" role="alert">${escapeHtml(notice)}</p>` : ""}
        <form id="create-form" class="setup-card">
        <p class="privacy-note">Organizer details are required for session reports. Your club name is optional.</p>
        <label class="field-label" for="organizer-name">Your name</label>
        <input id="organizer-name" name="organizerName" class="text-input" required maxlength="70" autocomplete="name" placeholder="Organizer name">
        <label class="field-label" for="organizer-contact">Contact number</label>
        <input id="organizer-contact" name="contactNumber" class="text-input" type="tel" required minlength="7" maxlength="25" autocomplete="tel" placeholder="Your phone number">
        <label class="field-label" for="organizer-club">Club name <span class="muted">(optional)</span></label>
        <input id="organizer-club" name="clubName" class="text-input" maxlength="80" autocomplete="organization" placeholder="Club or group name">
        <label class="field-label" for="court-name">Court / venue name</label>
        <input id="court-name" name="courtName" class="text-input" required maxlength="80" autocomplete="off" placeholder="e.g. Loyloy Pickleball Court">
        <hr class="form-divider">
        <label class="field-label" for="session-name">Session name</label>
          <input id="session-name" name="name" class="text-input" required maxlength="70" placeholder="Saturday open play">
          <div class="form-grid">
            <div><label class="field-label" for="session-date">Date</label><input id="session-date" name="date" type="date" class="text-input" value="${new Date().toISOString().slice(0, 10)}"></div>
            <div><label class="field-label" for="session-courts">Courts</label><input id="session-courts" name="courts" type="number" min="1" max="12" value="2" class="text-input"></div>
          </div>
          <div class="form-grid">
            <div><label class="field-label" for="session-format">Game format</label><select id="session-format" name="format" class="text-input"><option value="doubles">Doubles</option><option value="singles">Singles</option></select></div>
            <div><label class="field-label" for="session-strategy">Queue strategy</label><select id="session-strategy" name="strategy" class="text-input">${strategyOptions("fair")}</select></div>
          </div>
          <label class="field-label" for="session-notes">Notes <span class="muted">(optional)</span></label>
          <textarea id="session-notes" name="notes" class="text-input" rows="2" maxlength="240" placeholder="Anything players should know?"></textarea>
          <button class="button button-primary button-wide" type="submit">Create session <span aria-hidden="true">→</span></button>
          <p class="privacy-note">Saved on this device only. No account required.</p>
        </form>
      </section>`;
    return;
  }
  const stats = getStatistics(session);
  const active = session.players.filter((player) => player.status === "active").length;
  const playingIds = new Set(session.matches.filter((match) => match.status === "inProgress").flatMap((match) => match.playerIds));
  const pausedIds = new Set(session.matches.filter((match) => match.status === "inProgress" && match.pausedAt).flatMap((match) => match.playerIds));
  const proposedIds = new Set(session.matches.filter((match) => match.status === "proposed").flatMap((match) => match.playerIds));
  const waiting = session.players.filter((player) => player.status === "active" && !playingIds.has(player.id) && !proposedIds.has(player.id));
  const liveMatches = session.matches.filter((match) => ["proposed", "inProgress"].includes(match.status));
  const activeCourts = session.matches.filter((match) => match.status === "inProgress").length;
  const completed = session.matches.filter((match) => match.status === "completed").slice().reverse();

  app.innerHTML = `
    <header class="topbar">
      <a class="brand" href="#" aria-label="PickleQueue ni Loyloy home"><span class="brand-mark">PQ</span><span>PickleQueue ni Loyloy</span></a>
      <div class="topbar-right">
        <span class="save-status"><span class="status-dot"></span> Saved on this device</span>
        ${session.status === "completed" ? '<span class="pill pill-done">Session complete</span>' : `<span class="pill pill-${session.status}">${titleCase(session.status)}</span>`}
      </div>
    </header>
    <div class="page">
      ${notice ? `<div class="notice ${notice.startsWith("Error:") ? "notice-error" : "notice-info"}" role="status">${escapeHtml(notice)}<button data-action="dismiss-notice" aria-label="Dismiss">×</button></div>` : ""}
      <section class="session-heading">
        <div>
          <p class="eyebrow">${session.date ? formatDate(session.date) : "PICKLEBALL SESSION"} ${session.notes ? `· ${escapeHtml(session.notes)}` : ""}</p>
          <h1>${escapeHtml(session.name)}</h1>
          <p class="session-meta">${escapeHtml(session.courtName || "Court name not set")} <span>·</span> ${session.courts} ${plural(session.courts, "court")} <span>·</span> ${titleCase(session.format)} <span>·</span> ${getStrategyName(session.strategy)}</p>
        </div>
        <div class="session-actions">${sessionControls()}</div>
      </section>
      <section class="stat-strip" aria-label="Session overview">
        <div class="stat"><span class="stat-label">Players here</span><strong>${active}<small> / ${session.players.length}</small></strong><span class="stat-caption">${session.players.filter((player) => player.status === "resting").length} resting</span></div>
        <div class="stat"><span class="stat-label">Games played</span><strong>${stats.completedGames}</strong><span class="stat-caption">${session.format} format</span></div>
        <div class="stat"><span class="stat-label">Waiting</span><strong>${waiting.length}</strong><span class="stat-caption">${liveMatches.filter((match) => match.status === "inProgress").length} courts in play</span></div>
        <div class="stat stat-queue"><span class="stat-label">Queue style</span><strong>${getStrategyName(session.strategy)}</strong><span class="stat-caption">${session.settings.rotatePartners ? "Rotating partners" : "Partner rotation off"}</span></div>
      </section>
      <div class="dashboard-grid">
        <section class="panel roster-panel">
          <div class="panel-heading">
            <div><p class="eyebrow">THE LINEUP</p><h2>Players <span class="count-badge">${session.players.length}</span></h2></div>
            <button class="button button-quiet button-small" data-action="toggle-add" ${session.status === "completed" ? "disabled" : ""}>＋ Add player</button>
          </div>
          <form id="add-player-form" class="add-player-form ${addFormOpen ? "" : "hidden"}">
            <input class="text-input" name="name" required maxlength="50" placeholder="Player name" aria-label="Player name" ${session.status === "completed" ? "disabled" : ""}>
            <select class="text-input" name="skill" aria-label="Skill level" ${session.status === "completed" ? "disabled" : ""}>${skillOptions(3)}</select>
            <button class="button button-primary button-small" type="submit" ${session.status === "completed" ? "disabled" : ""}>Add</button>
          </form>
          <div class="roster-list">
            ${session.players.length ? session.players.map((player) => playerRow(player, playingIds, proposedIds, pausedIds)).join("") : '<div class="empty-state"><span class="empty-icon">♧</span><strong>Your lineup starts here</strong><span>Add players to get the session going.</span></div>'}
          </div>
          ${session.status === "draft" ? '<p class="panel-hint">Add at least 2 players for singles or 4 for doubles, then start.</p>' : ""}
        </section>
        <section class="panel matches-panel">
          <div class="panel-heading">
            <div><p class="eyebrow">ON THE COURTS</p><h2>Live queue <span class="count-badge">${liveMatches.length}</span></h2></div>
            ${session.status === "active" ? '<div class="queue-actions"><button class="button button-quiet button-small" data-action="create-custom">＋ Custom match</button><button class="button button-secondary button-small" data-action="generate">↻ Generate</button></div>' : ""}
          </div>
          <div class="match-list">
            ${liveMatches.length ? liveMatches.map(matchCard).join("") :
              `<div class="empty-state"><span class="empty-icon">⌁</span><strong>${session.status === "active" ? "Ready for the next game?" : "No games on court"}</strong><span>${session.status === "active" ? "Generate a fair set of matches for the open courts." : "Your proposed and in-progress games will show here."}</span>${session.status === "active" ? '<button class="button button-primary button-small" data-action="generate">Generate matches</button>' : ""}</div>`}
          </div>
          <section class="waiting-section">
            <div class="waiting-heading"><span class="eyebrow">AVAILABLE NEXT</span><span class="count-badge">${waiting.length}</span></div>
            <div class="waiting-cards">${waiting.length ? waiting.map(waitingCard).join("") : '<span class="muted">No unassigned players waiting</span>'}</div>
          </section>
        </section>
      </div>
      <section class="panel settings-panel">
        <div class="panel-heading settings-heading">
          <div><p class="eyebrow">MAKE IT YOURS</p><h2>Queue settings</h2></div>
          <span class="muted settings-intro">Changes apply to future matches</span>
        </div>
        <div class="settings-grid">
          <label class="setting-field"><span>Queue strategy ${settingHelp("Balanced fair play balances skill, participation, and variety. Skill-based favors similar player skill. Win-rate based gives more weight to recorded results. Casual / mixed favors variety and a relaxed mix. These are priorities, not guarantees.")}<small>How should matchups be balanced?</small></span><select class="text-input" data-setting="strategy" ${session.status === "completed" ? "disabled" : ""}>${strategyOptions(session.strategy)}</select></label>
          <label class="setting-field"><span>Courts ${settingHelp("Set how many courts are available for this session. The queue will not schedule more simultaneous games than this number.")}<small>Available playing courts</small></span><input class="text-input short-input" data-setting="courts" type="number" min="1" max="12" value="${session.courts}" ${session.status === "completed" ? "disabled" : ""}></label>
          <label class="setting-toggle"><input type="checkbox" data-setting="rotatePartners" ${session.settings.rotatePartners ? "checked" : ""} ${session.status === "completed" ? "disabled" : ""}><span><b>Rotate partners ${settingHelp("When enabled, the queue favors pairing players with new teammates. It is a preference, so repeats can still happen when the available lineup is limited.")}</b><small>Avoid pairing the same teammates repeatedly</small></span></label>
          <label class="setting-toggle"><input type="checkbox" data-setting="prioritizeWaiting" ${session.settings.prioritizeWaiting ? "checked" : ""} ${session.status === "completed" ? "disabled" : ""}><span><b>Prioritize waiting ${settingHelp("When enabled, players who have waited longer receive more weight when the queue chooses among possible matches.")}</b><small>Give longer-waiting players a fair turn</small></span></label>
          <label class="setting-toggle"><input type="checkbox" data-setting="allowConsecutiveGames" ${session.settings.allowConsecutiveGames ? "checked" : ""} ${session.status === "completed" ? "disabled" : ""}><span><b>Allow back-to-back games ${settingHelp("When enabled, players may play consecutive rotations up to the Rest after limit. When disabled, a player who just finished a game must sit out the next rotation.")}</b><small>When off, a player sits out one completed rotation</small></span></label>
          <label class="setting-field"><span>Rest after ${settingHelp("Choose the maximum consecutive games before a player is left out of the next generated rotation. This limit applies when back-to-back games are allowed.")}<small>Consecutive games before a rest rotation</small></span><input class="text-input short-input" data-setting="restAfterConsecutiveGames" type="number" min="1" max="8" value="${session.settings.restAfterConsecutiveGames}" ${session.status === "completed" ? "disabled" : ""}></label>
          <label class="setting-field"><span>Performance influence ${settingHelp("Choose how much recorded wins and losses influence matchup balance: Low uses a small adjustment, Balanced uses the standard adjustment, and High gives results more weight. Results never change a player's skill rating.")}<small>How much recent results affect balance</small></span><select class="text-input" data-setting="performanceInfluence" ${session.status === "completed" ? "disabled" : ""}><option value="0.25" ${session.settings.performanceInfluence === 0.25 ? "selected" : ""}>Low</option><option value="0.5" ${session.settings.performanceInfluence === 0.5 ? "selected" : ""}>Balanced</option><option value="1" ${session.settings.performanceInfluence === 1 ? "selected" : ""}>High</option></select></label>
          <label class="setting-field"><span>Ranked after ${settingHelp("A player needs at least this many completed games before they qualify for a leaderboard rank. Their games and results still appear before they qualify.")}<small>Minimum completed games</small></span><input class="text-input short-input" data-setting="minimumRankedGames" type="number" min="1" max="50" value="${session.settings.minimumRankedGames}" ${session.status === "completed" ? "disabled" : ""}></label>
          <label class="setting-field"><span>Game to ${settingHelp("Set the winning score target. With Allow deuce off, the winner must finish on this exact score. With it on, play continues past the target until a team leads by 2.")}<small>Winning score target</small></span><input class="text-input short-input" data-setting="scoringTo" type="number" min="1" max="99" value="${session.settings.scoringTo ?? 11}" ${session.status === "completed" ? "disabled" : ""}></label>
          <label class="setting-toggle"><input type="checkbox" data-setting="allowDeuce" ${session.settings.allowDeuce !== false ? "checked" : ""} ${session.status === "completed" ? "disabled" : ""}><span><b>Allow deuce ${settingHelp("When on, a team must reach the target and win by at least 2 points, so play can continue past the target. When off, the winner must score exactly the target and the other team must be below it.")}</b><small>Require a 2-point lead and continue past the target</small></span></label>
        </div>
        <details class="fairness-note"><summary>How does the queue choose matches?</summary><p>It rejects unavailable or duplicate players first, then scores feasible match sets for team skill balance, sample-smoothed results, equal participation, waiting time, and partner/opponent variety. The chosen strategy changes those priorities. When the preferred skill gap cannot be met, the best available match is flagged rather than silently presented as perfect.</p><p>Recorded point margins are only a small supplementary signal when the same team combination has played before. A doubles score is treated as a team result—not as proof about an individual player's ability—and never changes skill ratings.</p><p>Scores are guidance, not a guarantee of fair play. Match generation is deterministic for the current player history and prioritizes sets of matches across all open courts.</p></details>
      </section>
      <section class="panel leaderboard-panel">
        <div class="panel-heading"><div><p class="eyebrow">RESULTS SO FAR</p><h2>Leaderboard</h2></div><span class="muted">Ranked by win rate · ${session.settings.minimumRankedGames}+ games to qualify</span></div>
        ${leaderboardTable(stats.players, true)}
      </section>
      ${completed.length ? `<section class="panel history-panel"><div class="panel-heading"><div><p class="eyebrow">THE RECORD</p><h2>Game history</h2></div><span class="muted">${completed.length} completed</span></div><div class="history-list">${completed.slice(0, 8).map(historyRow).join("")}</div></section>` : ""}
      ${session.status === "completed" ? `<section class="panel final-panel"><p class="eyebrow">SESSION SUMMARY</p><h2>That's a wrap.</h2><p>${stats.completedGames} games played · ${session.players.length} players · average ${stats.averageGames.toFixed(1)} games per player.</p>${session.feedback ? '<p class="feedback-confirmation">Feedback submitted. It is included in the final email report.</p>' : '<p class="feedback-required">Required: submit feedback to email the final report.</p>'}<button class="button button-secondary" data-action="email-session-report">${session.feedback ? "Email final report" : "Submit feedback & email report"}</button>${session.feedback ? ' <button class="button button-quiet" data-action="new-session">Start a new session</button>' : ""}</section>` : ""}
      <footer class="page-footer">PickleQueue ni Loyloy <span>·</span> Fair play, better rotations.</footer>
    </div>`;
}

function sessionControls() {
  if (session.status === "draft") {
    const needed = session.format === "doubles" ? 4 : 2;
    const available = session.players.filter((player) => player.status === "active").length;
    return `<button class="button button-primary" data-action="start-session" ${available < needed ? "disabled" : ""}>Start session <span aria-hidden="true">→</span></button>`;
  }
  if (session.status === "active") return '<button class="button button-quiet" data-action="email-session-report">Email update</button><button class="button button-quiet" data-action="pause-session">Pause session</button><button class="button button-danger-quiet" data-action="end-session">End session</button>';
  if (session.status === "paused") return '<button class="button button-primary" data-action="resume-session">Resume session</button><button class="button button-danger-quiet" data-action="end-session">End session</button>';
  return "";
}

function playerRow(player, playingIds, proposedIds, pausedIds) {
  const status = playingIds.has(player.id) ? pausedIds.has(player.id) ? "paused" : "playing" : proposedIds.has(player.id) ? "queued" : player.status;
  const statusLabel = status === "playing" && player.status !== "active"
    ? `${titleCase(player.status)} · Playing`
    : status === "paused" ? "Paused" : titleCase(status);
  return `<article class="player-row player-row-${player.status}">
    <div class="avatar avatar-${player.skill}">${initials(player.name)}</div>
    <div class="player-main"><strong>${escapeHtml(player.name)}</strong><span>${skillName(player.skill)} <span class="middot">·</span> ${player.games} ${plural(player.games, "game")}</span></div>
    <span class="player-status status-${status}">${statusLabel}</span>
    <div class="player-actions">
      <button class="icon-button" data-action="edit-player" data-id="${player.id}" title="Edit ${escapeHtml(player.name)}" aria-label="Edit ${escapeHtml(player.name)}">✎</button>
      ${player.status === "active" ? `<button class="icon-button" data-action="rest-player" data-id="${player.id}" title="Put ${escapeHtml(player.name)} on break" aria-label="Put ${escapeHtml(player.name)} on break">Ⅱ</button>` : ""}
      ${player.status === "resting" ? `<button class="icon-button return-button" data-action="return-player" data-id="${player.id}" title="Return ${escapeHtml(player.name)} to queue" aria-label="Return ${escapeHtml(player.name)} to queue">↗</button>` : ""}
      ${player.status !== "unavailable" && player.status !== "resting" && !playingIds.has(player.id) ? `<button class="icon-button" data-action="unavailable-player" data-id="${player.id}" title="Mark unavailable" aria-label="Mark ${escapeHtml(player.name)} unavailable">⊘</button>` : ""}
      ${player.status === "unavailable" ? `<button class="icon-button return-button" data-action="return-player" data-id="${player.id}" title="Return to queue" aria-label="Return ${escapeHtml(player.name)} to queue">↗</button>` : ""}
      ${player.games === 0 && !playingIds.has(player.id) && session.status !== "completed" ? `<button class="icon-button" data-action="remove-player" data-id="${player.id}" title="Remove ${escapeHtml(player.name)}" aria-label="Remove ${escapeHtml(player.name)}">×</button>` : ""}
    </div>
  </article>`;
}

function matchCard(match) {
  const teams = match.teams.map((team) => team.map((id) => session.players.find((player) => player.id === id)).filter(Boolean));
  const score = Number.isInteger(match.scoreA) && Number.isInteger(match.scoreB) ? `${match.scoreA} – ${match.scoreB}` : match.score || "";
  const activeCourts = session.matches.filter((entry) => entry.status === "inProgress").length;
  const timer = match.status === "inProgress"
    ? `<span class="match-timer" data-started-at="${escapeHtml(match.startedAt ?? "")}" data-paused-at="${escapeHtml(match.pausedAt ?? "")}" data-total-paused="${Number(match.totalPausedMs ?? 0)}" aria-label="Game duration" aria-live="off">${formatElapsed(match.startedAt, match.pausedAt, match.totalPausedMs)}</span>`
    : "";
  const canStart = session.status === "active" && activeCourts < session.courts &&
    match.playerIds.every((id) => session.players.find((player) => player.id === id)?.status === "active");
  return `<article class="match-card ${match.status === "inProgress" ? "match-playing" : ""} ${match.pausedAt ? "match-paused" : ""}">
    <div class="match-top"><div class="court-label"><span class="court-icon">▦</span> ${match.status === "inProgress" ? `Court ${match.court}` : "Waiting for court"} ${match.kind === "custom" ? '<span class="custom-badge">CUSTOM</span>' : ""}</div><span class="match-status">${match.status === "inProgress" ? `${match.pausedAt ? "PAUSED" : "IN PLAY"} · LOCKED ${timer}` : "QUEUED"}</span></div>
    <div class="teams">${teams.map((team, index) => `<div class="team"><span class="team-label">TEAM ${index ? "B" : "A"}${match.status === "completed" && match.winnerTeam === index ? " · WINNER" : ""}</span>${team.map(playerMatchLine).join("")}</div>${index === 0 ? '<span class="vs">VS</span>' : ""}`).join("")}</div>
    ${score ? `<div class="match-score">${escapeHtml(score)}</div>` : ""}
    ${match.warning ? `<div class="match-warning" title="${escapeHtml(match.reason)}">⚠ Skill balance trade-off <span class="warning-help">${escapeHtml(match.reason)}</span></div>` : `<p class="match-reason">${escapeHtml(match.reason)}</p>`}
    ${match.status === "proposed" && session.status === "active" && activeCourts >= session.courts ? '<p class="match-reason">All courts are occupied. This match will wait for a court to open.</p>' : ""}
    <div class="match-actions">${match.status === "proposed" ? `${session.status === "active" ? `<button class="button button-primary button-small" data-action="start-match" data-id="${match.id}" title="${canStart ? "Start this game" : "All courts are occupied."}" ${canStart ? "" : "disabled"}>Start game</button>` : ""}<button class="button button-quiet button-small" data-action="edit-match" data-id="${match.id}" ${session.status !== "active" ? "disabled" : ""}>Edit match</button><button class="button button-quiet button-small" data-action="cancel-match" data-id="${match.id}">Remove</button>` : match.status === "inProgress" ? `${match.pausedAt ? `<button class="button button-primary button-small" data-action="resume-game" data-id="${match.id}">Resume</button>` : `<button class="button button-quiet button-small" data-action="pause-game" data-id="${match.id}">Pause</button>`}<button class="button button-danger-quiet button-small" data-action="stop-game" data-id="${match.id}">Stop</button>${match.pausedAt ? "" : `<button class="button button-primary button-small" data-action="record-result" data-id="${match.id}">Record score</button>`}` : ""}</div>
  </article>`;
}

function historyRow(match) {
  const sides = match.teams.map((team) => team.map((id) => session.players.find((player) => player.id === id)?.name ?? "Player").join(" + "));
  return `<div class="history-row"><span class="history-court">C${match.court}</span><span>${escapeHtml(sides[0])} <b class="history-vs">vs</b> ${escapeHtml(sides[1])}${match.kind === "custom" ? '<span class="custom-badge">CUSTOM</span>' : ""}</span><strong>${escapeHtml(sides[match.winnerTeam])} won</strong><span class="history-score">${escapeHtml(Number.isInteger(match.scoreA) ? `${match.scoreA} – ${match.scoreB}` : match.score || "—")}</span><button class="icon-button history-edit" data-action="edit-score" data-id="${match.id}" aria-label="Edit score">✎</button></div>`;
}

function playerMatchLine(player) {
  const winRate = player.games ? `${((player.wins / player.games) * 100).toFixed(0)}%` : "N/A";
  return `<div class="match-player"><strong>${escapeHtml(player.name)}</strong><span>${skillName(player.skill)} · ${winRate} win rate</span><small>${player.wins}W / ${player.games} ${plural(player.games, "game")}</small></div>`;
}

function waitingCard(player) {
  const winRate = player.games ? `${((player.wins / player.games) * 100).toFixed(0)}%` : "N/A";
  const minutes = player.waitSince ? Math.max(0, Math.floor((Date.now() - player.waitSince) / 60000)) : 0;
  return `<article class="waiting-card"><div class="avatar avatar-${player.skill}">${initials(player.name)}</div><div class="waiting-player-info"><strong>${escapeHtml(player.name)}</strong><span>${skillName(player.skill)} · ${winRate} · ${player.wins}W/${player.games}G</span><small>Waiting ${minutes} min · Available</small></div><button class="icon-button" data-action="rest-player" data-id="${player.id}" title="Put ${escapeHtml(player.name)} on break" aria-label="Put ${escapeHtml(player.name)} on break">Ⅱ</button></article>`;
}

function leaderboardTable(players, compact) {
  if (!players.length) return '<div class="empty-state compact-empty"><strong>No players yet</strong><span>Add players to see session stats.</span></div>';
  return `<div class="table-wrap"><table><thead><tr><th>Rank</th><th>Player</th><th>Skill</th><th>Games</th><th>W–L</th><th>Win rate</th></tr></thead><tbody>
    ${players.map((player) => `<tr><td>${player.rank ? `<span class="rank-number">${player.rank < 4 ? ["", "①", "②", "③"][player.rank] : player.rank}</span>` : '<span class="unranked">—</span>'}</td><td><strong>${escapeHtml(player.name)}</strong>${!player.rank ? '<span class="sample-tag">Not ranked yet</span>' : ""}</td><td>${skillName(player.skill)}</td><td>${player.games}</td><td>${player.wins}–${player.losses}</td><td>${player.winRate === null ? "—" : `${player.winRate.toFixed(0)}%`}${player.games > 0 && player.games < session.settings.minimumRankedGames ? `<span class="sample-tag">${player.games} of ${session.settings.minimumRankedGames} games</span>` : ""}</td></tr>`).join("")}
  </tbody></table></div>${compact && players.some((player) => player.games > 0 && player.games < session.settings.minimumRankedGames) ? '<p class="table-note">A high win rate from only a few games is not a reliable ranking.</p>' : ""}`;
}

function strategyOptions(selected) {
  return [["fair", "Balanced fair play"], ["skill", "Skill-based"], ["wins", "Win-rate based"], ["casual", "Casual / mixed"]]
    .map(([value, label]) => `<option value="${value}" ${selected === value ? "selected" : ""}>${label}</option>`).join("");
}

function settingHelp(description) {
  const text = escapeHtml(description);
  return `<span class="setting-help" tabindex="0" role="img" aria-label="${text}" title="${text}"><span aria-hidden="true">i</span><span class="setting-tooltip" role="tooltip">${text}</span></span>`;
}

function skillOptions(selected) {
  return SKILLS.map(({ label, value }) => `<option value="${value}" ${Number(selected) === value ? "selected" : ""}>${label}</option>`).join("");
}

function showError(error) {
  notice = `Error: ${error.message}`;
  render();
}

function commit() {
  persist();
  notice = "";
  render();
}

function buildSessionReport(reportType) {
  const statistics = getStatistics(session);
  const statusName = reportType === "started" ? "Session started" : "Session ended";
  const organizer = session.organizer ?? {};
  const lines = [
    `PickleQueue ni Loyloy — ${statusName}`,
    "",
    `Organizer: ${organizer.name || "Not provided"}`,
    `Contact number: ${organizer.contactNumber || "Not provided"}`,
    `Club: ${organizer.clubName || "Not provided"}`,
    `Court / venue: ${session.courtName || "Not provided"}`,
    `Session: ${session.name}`,
    `Date: ${session.date || "Not set"}`,
    `Format: ${titleCase(session.format)}`,
    `Courts: ${session.courts}`,
    `Queue strategy: ${getStrategyName(session.strategy)}`,
    `Status: ${titleCase(session.status)}`,
    `Completed games: ${statistics.completedGames}`,
    `Players: ${session.players.length}`,
    "",
    "Player statistics:"
  ];
  statistics.players.forEach((player) => {
    const winRate = player.winRate === null ? "N/A" : `${player.winRate.toFixed(0)}%`;
    lines.push(`- ${player.name}: ${player.games} games, ${player.wins} wins, ${player.losses} losses, ${winRate} win rate`);
  });
  lines.push("", "Match history:");
  const matches = session.matches.filter((match) => ["completed", "proposed", "inProgress", "cancelled"].includes(match.status));
  if (!matches.length) lines.push("- No matches yet.");
  matches.forEach((match, index) => {
    const teams = match.teams.map((team) => team
      .map((id) => session.players.find((player) => player.id === id)?.name ?? "Unknown player")
      .join(" + "));
    const score = Number.isInteger(match.scoreA) && Number.isInteger(match.scoreB) ? ` (${match.scoreA}–${match.scoreB})` : "";
    lines.push(`- Game ${index + 1} · ${titleCase(match.status)}${match.court ? ` · Court ${match.court}` : ""}: ${teams[0]} vs ${teams[1]}${score}`);
  });
  if (reportType === "ended") {
    lines.push("", "Organizer feedback:", session.feedback || "Not submitted.");
  }
  return lines.join("\n");
}

async function emailSessionReport(reportType) {
  if (!session.organizer?.name || !session.organizer?.contactNumber || !session.courtName) {
    pendingSessionAction = `report:${reportType}`;
    openOrganizerDialog();
    return "";
  }
  try {
    const response = await fetch("/api/send-report", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        reportType,
        sessionName: session.name,
        report: buildSessionReport(reportType)
      })
    });
    if (response.status === 501) {
      throw new Error("Email reports are unavailable on the local static server. Deploy to Vercel or run the app with `vercel dev`.");
    }
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || `Email request failed (${response.status}).`);
    return "";
  } catch (error) {
    return `Session saved, but the email report could not be sent: ${error.message}`;
  }
}

function openOrganizerDialog() {
  organizerForm.reset();
  organizerForm.elements.name.value = session.organizer?.name ?? "";
  organizerForm.elements.contactNumber.value = session.organizer?.contactNumber ?? "";
  organizerForm.elements.clubName.value = session.organizer?.clubName ?? "";
  organizerForm.elements.courtName.value = session.courtName ?? "";
  organizerDialog.showModal();
  organizerForm.elements.name.focus();
}

async function sendReportAndNotify(reportType) {
  commit();
  const emailError = await emailSessionReport(reportType);
  if (emailError) {
    notice = emailError;
    render();
  } else if (!organizerDialog.open) {
    notice = `Session ${reportType} report emailed.`;
    render();
  }
}

app.addEventListener("submit", (event) => {
  event.preventDefault();
  const data = new FormData(event.target);
  try {
    if (event.target.id === "create-form") {
      session = createSession(Object.fromEntries(data.entries()));
      persist();
      notice = "";
      render();
    } else if (event.target.id === "add-player-form") {
      addPlayer(session, Object.fromEntries(data.entries()));
      addFormOpen = true;
      persist();
      notice = "";
      render();
      document.querySelector('#add-player-form [name="name"]').focus();
    }
  } catch (error) {
    showError(error);
  }
});

resultForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const data = new FormData(resultForm);
  try {
    if (resultForm.dataset.mode === "edit-score") {
      if (!confirm("Correct this completed score? The recorded winner and player statistics will be recalculated.")) return;
      editCompletedScore(session, data.get("matchId"), data.get("scoreA"), data.get("scoreB"));
    } else {
      recordResultAndGenerate(session, data.get("matchId"), data.get("scoreA"), data.get("scoreB"));
    }
    resultDialog.close();
    commit();
  } catch (error) {
    const message = document.querySelector("#score-rules");
    message.textContent = error.message;
    message.classList.add("notice-error");
  }
});

matchForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const data = new FormData(matchForm);
  const teamSize = session.format === "doubles" ? 2 : 1;
  const teams = [
    Array.from({ length: teamSize }, (_, index) => data.get(`teamA${index}`)),
    Array.from({ length: teamSize }, (_, index) => data.get(`teamB${index}`))
  ];
  try {
    if (matchForm.dataset.mode === "custom") {
      const selectedIds = teams.flat();
      const pulledCount = selectedIds.filter((playerId) =>
        session.matches.some((match) => match.status === "proposed" && match.playerIds.includes(playerId))).length;
      createCustomMatch(session, teams);
      notice = pulledCount
        ? `Custom match queued. ${pulledCount} queued ${plural(pulledCount, "player")} moved; their former match spots were backfilled.`
        : "Custom match queued.";
    } else {
      const result = editQueuedMatch(session, data.get("matchId"), teams);
      notice = result.exchanges.length
        ? `${result.exchanges.length} queued player ${plural(result.exchanges.length, "exchange")} applied.`
        : "Queued match updated.";
    }
    matchDialog.close();
    persist();
    render();
  } catch (error) {
    const message = document.querySelector("#match-fairness");
    message.textContent = error.message;
    message.classList.add("notice-error");
  }
});

playerForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const data = new FormData(playerForm);
  try {
    updatePlayer(session, data.get("playerId"), {
      name: data.get("name"),
      skill: data.get("skill")
    });
    playerDialog.close();
    commit();
  } catch (error) {
    const message = document.querySelector("#player-edit-error");
    message.textContent = error.message;
    message.classList.add("notice-error");
  }
});

playerForm.addEventListener("input", updatePlayerPreview);
playerForm.addEventListener("change", updatePlayerPreview);

organizerForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    updateOrganizerDetails(session, Object.fromEntries(new FormData(organizerForm)));
    organizerDialog.close();
    persist();
    const action = pendingSessionAction;
    pendingSessionAction = null;
    if (action === "start") {
      startSession(session);
      await sendReportAndNotify("started");
    } else if (action?.startsWith("report:")) {
      await sendReportAndNotify(action.slice("report:".length));
    } else {
      commit();
    }
  } catch (error) {
    showError(error);
  }
});
organizerForm.querySelector('[data-action="cancel-organizer"]').addEventListener("click", () => {
  pendingSessionAction = null;
  organizerDialog.close();
});

feedbackForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const feedback = new FormData(feedbackForm).get("feedback").trim();
  if (feedback.length < 3) {
    feedbackForm.elements.feedback.setCustomValidity("Please enter at least 3 characters of feedback.");
    feedbackForm.reportValidity();
    return;
  }
  feedbackForm.elements.feedback.setCustomValidity("");
  session.feedback = feedback;
  feedbackDialog.close();
  await sendReportAndNotify("ended");
});
feedbackForm.elements.feedback.addEventListener("input", () => {
  feedbackForm.elements.feedback.setCustomValidity("");
});

app.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-action]");
  if (!button) return;
  const { action, id } = button.dataset;
  try {
    if (action === "dismiss-notice") { notice = ""; render(); return; }
    if (action === "toggle-add") {
      addFormOpen = !addFormOpen;
      render();
      if (addFormOpen) document.querySelector('#add-player-form [name="name"]').focus();
      return;
    }
    let reportType = null;
    if (action === "start-session") {
      if (!session.organizer?.name || !session.organizer?.contactNumber || !session.courtName) {
        pendingSessionAction = "start";
        openOrganizerDialog();
        return;
      }
      startSession(session);
      reportType = "started";
    }
    if (action === "pause-session") pauseSession(session);
    if (action === "resume-session") resumeSession(session);
    if (action === "email-session-report") {
      reportType = session.status === "completed" ? "ended" : "started";
      if (reportType === "ended" && !session.feedback) {
        feedbackForm.reset();
        feedbackDialog.showModal();
        feedbackForm.elements.feedback.focus();
        return;
      }
    }
    if (action === "end-session") {
      const unfinished = session.matches.filter((match) => ["proposed", "inProgress"].includes(match.status)).length;
      const explanation = unfinished ? ` This will cancel ${unfinished} unfinished or proposed ${plural(unfinished, "game")} without recording results.` : "";
      if (!confirm(`End ${session.name}?${explanation}`)) return;
      endSession(session, { confirmUnfinished: true });
      session.feedback = "";
      commit();
      feedbackForm.reset();
      feedbackDialog.showModal();
      feedbackForm.elements.feedback.focus();
      return;
    }
    if (action === "generate") {
      const result = generateMatches(session);
      notice = result.matches.length ? (result.message || `${result.matches.length} fair ${plural(result.matches.length, "match")} proposed across the open courts.`) : result.message;
      commit();
      return;
    }
    if (action === "start-match") startMatch(session, id);
    if (action === "create-custom") openMatchEditor("custom");
    if (action === "edit-match") openMatchEditor("edit", id);
    if (action === "pause-game") pauseMatch(session, id);
    if (action === "resume-game") resumeMatch(session, id);
    if (action === "stop-game") {
      if (!confirm("Return this game to the editable queue without recording a score?")) return;
      stopMatch(session, id);
      notice = "Game returned to the queue without a score.";
    }
    if (action === "cancel-match") {
      if (!confirm("Remove this proposed game from the queue?")) return;
      cancelProposedMatch(session, id);
    }
    if (action === "rest-player") changeAvailability(id, "resting");
    if (action === "unavailable-player") changeAvailability(id, "unavailable");
    if (action === "return-player") setPlayerAvailability(session, id, "active");
    if (action === "remove-player") {
      const player = session.players.find((entry) => entry.id === id);
      if (!confirm(`Remove ${player.name} from this session?`)) return;
      removePlayer(session, id, { confirmRemoval: true });
    }
    if (action === "edit-player") {
      const player = session.players.find((entry) => entry.id === id);
      openPlayerEditor(player);
    }
    if (action === "record-result") openResult(id);
    if (action === "edit-score") openResult(id, true);
    if (action === "new-session") {
      if (!confirm("Start a new session? This will replace the saved session on this device.")) return;
      clearSession();
      session = null;
      notice = "";
      render();
      return;
    }
    if (reportType) {
      await sendReportAndNotify(reportType);
    } else {
      commit();
    }
  } catch (error) {
    showError(error);
  }
});

function changeAvailability(playerId, status) {
  const result = setPlayerAvailability(session, playerId, status);
  if (result.requiresConfirmation) {
    const player = session.players.find((entry) => entry.id === playerId);
    if (!confirm(`${player.name} is in a proposed game. Remove that proposed game and change their status?`)) return false;
    setPlayerAvailability(session, playerId, status, { confirmRemoval: true });
  }
  return result.changed || result.requiresConfirmation;
}

app.addEventListener("change", (event) => {
  const setting = event.target.dataset.setting;
  if (!setting) return;
  try {
    const value = event.target.type === "checkbox" ? event.target.checked :
      ["courts", "minimumRankedGames", "restAfterConsecutiveGames", "scoringTo"].includes(setting) ? Number(event.target.value) :
        setting === "performanceInfluence" ? Number(event.target.value) : event.target.value;
    if (setting === "courts" && (!Number.isInteger(value) || value < 1 || value > 12)) throw new Error("Choose between 1 and 12 courts.");
    if (setting === "minimumRankedGames" && (!Number.isInteger(value) || value < 1 || value > 50)) throw new Error("Minimum ranked games must be between 1 and 50.");
    if (setting === "restAfterConsecutiveGames" && (!Number.isInteger(value) || value < 1 || value > 8)) throw new Error("Rest rotation must be between 1 and 8 games.");
    if (setting === "scoringTo" && (!Number.isInteger(value) || value < 1 || value > 99)) throw new Error("Winning score target must be between 1 and 99.");
    if (setting === "courts" && value < session.matches.filter((match) => match.status === "inProgress").length) {
      throw new Error("Court count cannot be less than the number of active games.");
    }
    if (setting === "strategy" && !["draft", "active", "paused"].includes(session.status)) throw new Error("Queue strategy cannot be changed after the session.");
    if (setting === "courts") session.courts = value;
    else if (setting === "strategy") session.strategy = value;
    else session.settings[setting] = value;
    commit();
  } catch (error) {
    showError(error);
  }
});

function openResult(matchId, editing = false) {
  const match = session.matches.find((entry) => entry.id === matchId);
  const teamLabels = match.teams.map((team) => team.map((id) => session.players.find((player) => player.id === id)?.name ?? "Player").join(" + "));
  resultForm.dataset.mode = editing ? "edit-score" : "record-score";
  resultForm.elements.matchId.value = match.id;
  document.querySelector("#result-title").textContent = editing ? "Correct recorded score" : `Court ${match.court} result`;
  resultForm.elements.scoreA.value = Number.isInteger(match.scoreA) ? match.scoreA : "";
  resultForm.elements.scoreB.value = Number.isInteger(match.scoreB) ? match.scoreB : "";
  document.querySelector("#score-rules").textContent = session.settings.allowDeuce !== false
    ? `Winner must reach ${session.settings.scoringTo ?? 11} points and lead by at least 2.`
    : `Without deuce, the winner must score exactly ${session.settings.scoringTo ?? 11}; the other team must score less.`;
  document.querySelector("#score-rules").classList.remove("notice-error");
  document.querySelector("#score-a").previousElementSibling.textContent = `Team A · ${teamLabels[0]}`;
  document.querySelector("#score-b").previousElementSibling.textContent = `Team B · ${teamLabels[1]}`;
  resultDialog.showModal();
}

document.addEventListener("click", (event) => {
  if (event.target.closest('[data-action="close-result"]')) resultDialog.close();
  if (event.target.closest('[data-action="close-match"]')) matchDialog.close();
  if (event.target.closest('[data-action="close-player"]')) playerDialog.close();
});

function openPlayerEditor(player) {
  if (!player) throw new Error("This player could not be found.");
  playerForm.elements.playerId.value = player.id;
  playerForm.elements.name.value = player.name;
  playerForm.querySelectorAll('input[name="skill"]').forEach((option) => {
    option.checked = Number(option.value) === player.skill;
  });
  const error = document.querySelector("#player-edit-error");
  error.textContent = "";
  error.classList.remove("notice-error");
  updatePlayerPreview();
  playerDialog.showModal();
  playerForm.elements.name.focus();
  playerForm.elements.name.select();
}

function updatePlayerPreview() {
  const name = playerForm.elements.name.value.trim() || "Player name";
  const skill = Number(new FormData(playerForm).get("skill") ?? 3);
  const avatar = document.querySelector("#player-preview-avatar");
  avatar.className = `avatar avatar-${skill}`;
  avatar.textContent = initials(name) || "?";
  document.querySelector("#player-preview-name").textContent = name;
  document.querySelector("#player-preview-skill").textContent = skillName(skill);
}

function openMatchEditor(mode, matchId = "") {
  if (session.status !== "active") throw new Error("Resume the session before changing matches.");
  const editing = mode === "edit";
  const match = editing ? session.matches.find((entry) => entry.id === matchId) : null;
  if (editing && match?.status !== "proposed") throw new Error("Only queued matches can be edited.");
  const size = session.format === "doubles" ? 2 : 1;
  const existingTeams = match?.teams ?? [[], []];
  const inProgressIds = new Set(session.matches.filter((entry) => entry.status === "inProgress" && entry.id !== matchId).flatMap((entry) => entry.playerIds));
  const reserved = new Map();
  session.matches.filter((entry) => entry.status === "proposed" && entry.id !== matchId).forEach((entry) => {
    entry.playerIds.forEach((id) => reserved.set(id, entry));
  });
  matchForm.dataset.mode = mode;
  matchForm.elements.matchId.value = matchId;
  document.querySelector("#match-dialog-eyebrow").textContent = editing ? "EDIT QUEUED MATCH" : "ORGANIZER PICK";
  document.querySelector("#match-dialog-title").textContent = editing ? "Edit match" : `Create custom ${session.format} match`;
  document.querySelector("#match-player-fields").innerHTML = [0, 1].map((teamIndex) =>
    `<fieldset class="match-team-field"><legend>Team ${teamIndex ? "B" : "A"}</legend>${Array.from({ length: size }, (_, slot) => {
      const selected = existingTeams[teamIndex][slot] ?? "";
      const options = session.players.map((player) => {
        const reservation = reserved.get(player.id);
        const unavailable = player.status !== "active" || inProgressIds.has(player.id);
        const status = inProgressIds.has(player.id) ? " · Playing" : player.status !== "active" ? ` · ${titleCase(player.status)}` :
          reservation ? ` · Queued${reservation.kind === "custom" ? " custom — will be replaced" : " — will be swapped"}` : "";
        return `<option value="${player.id}" ${selected === player.id ? "selected" : ""} ${unavailable && selected !== player.id ? "disabled" : ""}>${escapeHtml(player.name)} — ${skillName(player.skill)} — ${player.games ? `${((player.wins / player.games) * 100).toFixed(0)}%` : "N/A"}${status}</option>`;
      }).join("");
      return `<label class="match-select-label">Player ${slot + 1}<select class="text-input match-select" name="team${teamIndex ? "B" : "A"}${slot}" required><option value="" disabled ${selected ? "" : "selected"}>Choose a player</option>${options}</select></label>`;
    }).join("")}</fieldset>`).join("");
  document.querySelector("#match-fairness").textContent = editing
    ? "Selecting a player from another queued match swaps them with the player leaving this match. Selecting someone from the other team moves them to the chosen side."
    : "You can select any active player, including someone queued elsewhere. Their queued spot is backfilled from the waiting lineup; the custom match is blocked if no replacement is available.";
  document.querySelector("#match-fairness").classList.remove("notice-error");
  const playerFields = document.querySelector("#match-player-fields");
  playerFields.querySelectorAll(".match-select").forEach((field) => { field.dataset.previousValue = field.value; });
  playerFields.onchange = (event) => {
    const changed = event.target.closest(".match-select");
    if (!changed) return;
    const duplicate = [...playerFields.querySelectorAll(".match-select")].find((field) => field !== changed && field.value === changed.value);
    if (duplicate) {
      const previousValue = changed.dataset.previousValue;
      duplicate.value = previousValue;
      duplicate.dataset.previousValue = previousValue;
    }
    changed.dataset.previousValue = changed.value;
    const fields = [...matchForm.querySelectorAll(".match-select")];
    const ids = fields.map((field) => field.value);
    const message = document.querySelector("#match-fairness");
    message.classList.remove("notice-error");
    if (ids.some((id) => !id) || new Set(ids).size !== ids.length) {
      message.textContent = "Select distinct players for every position.";
      return;
    }
    const fairness = matchFairness(session, [ids.slice(0, size), ids.slice(size)]);
    message.textContent = `Skill gap: ${fairness.skillGap.toFixed(1)} · ${fairness.warning ? "Outside preferred skill range." : "Within preferred skill range."}`;
  };
  matchDialog.showModal();
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
}
function initials(name) { return String(name).trim().split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase() ?? "").join(""); }
function titleCase(value) { return value.charAt(0).toUpperCase() + value.slice(1); }
function plural(count, word) { return `${word}${count === 1 ? "" : "s"}`; }
function formatDate(value) { return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeZone: "UTC" }).format(new Date(`${value}T12:00:00Z`)).toUpperCase(); }

render();
setInterval(updateMatchTimers, 1000);

function updateMatchTimers() {
  document.querySelectorAll(".match-timer").forEach((timer) => {
    timer.textContent = formatElapsed(timer.dataset.startedAt, timer.dataset.pausedAt, Number(timer.dataset.totalPaused));
  });
}

function formatElapsed(startedAt, pausedAt = "", totalPausedMs = 0) {
  const started = Date.parse(startedAt);
  if (!Number.isFinite(started)) return "Timer unavailable";
  const paused = pausedAt ? Date.parse(pausedAt) : Date.now();
  if (!Number.isFinite(paused)) return "Timer unavailable";
  const seconds = Math.max(0, Math.floor((paused - started - totalPausedMs) / 1000));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainder = seconds % 60;
  return hours
    ? `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`
    : `${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
}
