import {
  addPlayer, cancelProposedMatch, createCustomMatch, createSession, editQueuedMatch, endSession, generateMatches, getStatistics, importRestingPlayers,
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
const confirmDialog = document.querySelector("#confirm-dialog");
const confirmForm = document.querySelector("#confirm-form");
const toastNotification = document.querySelector("#toast-notification");
const toastMessage = document.querySelector("#toast-message");
const toastIndicator = document.querySelector("#toast-indicator");
let session;
let notice = "";
let validationNotice = "";
let displayedNotice = "";
let noticeTimeout;
let createFormOpen = false;
let addFormOpen = false;
let reclubImportOpen = false;
let importingReclub = false;
let rosterManagerOpen = false;
let rosterManagerFilter = "all";
let lineupSearch = "";
let rosterManagerSearch = "";
let selectedPlayerIds = new Set();
const defaultRosterPageSize = 6;
const paginationReservedSpace = 51;
let rosterPageSize = defaultRosterPageSize;
const waitingPageSize = 6;
let rosterPage = 0;
let waitingPage = 0;
let rosterAnchorIndexAfterResize = null;
let pendingSessionAction;
let resolveConfirmation;

try {
  session = loadSession();
} catch (error) {
  notice = `Error: ${error.message}`;
}

function persist() {
  if (session) saveSession(session);
}

function render() {
  updateToast();
  if (!session) {
    app.innerHTML = `
      <section class="welcome">
        <div class="welcome-mark">PQL</div>
        <p class="eyebrow">YOUR CLUB, IN GOOD ROTATION</p>
        <h1>Make every court<br>feel like <em>your court.</em></h1>
        <p class="welcome-copy">Fair, easy-to-run pickleball sessions—without a clipboard full of matchups.</p>
        ${createFormOpen ? `<form id="create-form" class="setup-card" novalidate>
        <label class="field-label" for="organizer-name">Your name</label>
        <input id="organizer-name" name="organizerName" class="text-input" required maxlength="70" autocomplete="name" placeholder="Organizer name">
        <label class="field-label" for="organizer-contact">Contact number</label>
        <input id="organizer-contact" name="contactNumber" class="text-input" type="tel" required minlength="7" maxlength="25" autocomplete="tel" placeholder="Your phone number">
        <label class="field-label" for="organizer-email">Email address</label>
        <input id="organizer-email" name="organizerEmail" class="text-input" type="email" required maxlength="254" autocomplete="email" placeholder="you@example.com">
        <label class="field-label" for="organizer-club">Club name <span class="muted">(optional)</span></label>
        <input id="organizer-club" name="clubName" class="text-input" maxlength="80" autocomplete="organization" placeholder="Club or group name">
        <label class="field-label" for="court-name">Court / venue name</label>
        <input id="court-name" name="courtName" class="text-input" required maxlength="80" autocomplete="off" placeholder="e.g. Loyloy Pickleball Court">
        <hr class="form-divider">
        <label class="field-label" for="session-name">Session name</label>
          <input id="session-name" name="name" class="text-input" required maxlength="70" placeholder="Saturday open play">
          <div class="form-grid session-date-courts-grid">
            <div><label class="field-label" for="session-date">Date</label><input id="session-date" type="text" name="date" class="text-input" inputmode="text" autocomplete="off" placeholder="M/D/YYYY" aria-describedby="session-date-hint" value="${formatSessionDateInput(new Date())}"></div>
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
        </form>` : '<button class="button button-primary welcome-start-button" type="button" data-action="show-create-form">Create or start a session <span aria-hidden="true">→</span></button>'}
      </section>`;
    return;
  }
  const stats = getStatistics(session);
  const active = session.players.filter((player) => player.status === "active").length;
  const playingIds = new Set(session.matches.filter((match) => match.status === "inProgress").flatMap((match) => match.playerIds));
  const pausedIds = new Set(session.matches.filter((match) => match.status === "inProgress" && match.pausedAt).flatMap((match) => match.playerIds));
  const proposedIds = new Set(session.matches.filter((match) => match.status === "proposed").flatMap((match) => match.playerIds));
  const waiting = sortPlayersByName(session.players.filter((player) =>
    player.status === "active" && !playingIds.has(player.id) && !proposedIds.has(player.id)));
  const alphabeticalPlayers = sortPlayersByName(session.players);
  const lineupPlayers = searchPlayers(alphabeticalPlayers, lineupSearch);
  const liveMatches = session.matches.filter((match) => ["proposed", "inProgress"].includes(match.status));
  const activeCourts = session.matches.filter((match) => match.status === "inProgress").length;
  const completed = session.matches.filter((match) => match.status === "completed").slice().reverse();
  const rosterPageCount = Math.max(1, Math.ceil(lineupPlayers.length / rosterPageSize));
  const waitingPageCount = Math.max(1, Math.ceil(waiting.length / waitingPageSize));
  rosterPage = Math.min(rosterPage, rosterPageCount - 1);
  waitingPage = Math.min(waitingPage, waitingPageCount - 1);
  const visiblePlayers = lineupPlayers.slice(rosterPage * rosterPageSize, (rosterPage + 1) * rosterPageSize);
  const visibleWaiting = waiting.slice(waitingPage * waitingPageSize, (waitingPage + 1) * waitingPageSize);
  const managerPlayers = searchPlayers(alphabeticalPlayers, rosterManagerSearch).filter((player) =>
    rosterManagerFilter === "all" ||
    managerPlayerStatus(player, playingIds, proposedIds, pausedIds) === rosterManagerFilter);
  const selectedPlayers = session.players.filter((player) => selectedPlayerIds.has(player.id));
  const selectedCanRest = selectedPlayers.filter((player) =>
    player.status === "active" && !playingIds.has(player.id));
  const selectedCanReturn = selectedPlayers.filter((player) =>
    ["resting", "unavailable"].includes(player.status));
  const selectedCanRemove = selectedPlayers.filter((player) =>
    player.games === 0 && !playingIds.has(player.id));
  const visibleSelectedCount = managerPlayers.filter((player) => selectedPlayerIds.has(player.id)).length;

  app.innerHTML = `
    <header class="topbar">
      <a class="brand" href="#" aria-label="PickleQueue ni Loyloy home"><span class="brand-mark">PQL</span><span>PickleQueue ni Loyloy</span></a>
      <div class="topbar-right">
        <span class="save-status"><span class="status-dot"></span> Saved on this device</span>
        ${session.status === "completed" ? '<span class="pill pill-done">Session complete</span>' : `<span class="pill pill-${session.status}">${titleCase(session.status)}</span>`}
      </div>
    </header>
    <div class="page">
      <section class="session-heading">
        <div>
          <p class="eyebrow">${session.date ? formatDate(session.date) : "PICKLEBALL SESSION"} ${session.notes ? `· ${escapeHtml(session.notes)}` : ""}</p>
          <h1>${escapeHtml(session.name)}</h1>
          <p class="session-meta">${escapeHtml(session.courtName || "Court name not set")} <span>·</span> ${session.courts} ${plural(session.courts, "court")} <span>·</span> ${titleCase(session.format)} <span>·</span> ${getStrategyName(session.strategy)}</p>
        </div>
        <div class="session-actions">${sessionControls()}</div>
      </section>
      ${session.status === "completed" ? `<section class="panel final-panel session-summary-panel"><div><p class="eyebrow">SESSION SUMMARY</p><h2>That's a wrap.</h2><p>${stats.completedGames} games played · ${session.players.length} players · average ${stats.averageGames.toFixed(1)} games per player.</p>${session.feedback ? `<p class="feedback-confirmation">Feedback submitted${session.feedbackRating ? ` · ${session.feedbackRating}/5 stars` : ""}.</p>` : '<p class="feedback-required">Submit the required feedback before starting a new session.</p>'}</div><div class="summary-actions">${session.feedback ? "" : '<button class="button button-feedback" data-action="submit-feedback">Submit feedback</button>'}<button class="button button-primary" data-action="new-session">Start New Session</button></div></section>` : ""}
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
            <div class="queue-actions">
              <button class="button button-quiet button-small" data-action="toggle-add" ${session.status === "completed" ? "disabled" : ""}>＋ Add player</button>
              <button class="button button-quiet button-small" data-action="toggle-reclub-import" ${session.status === "completed" ? "disabled" : ""}>Import Reclub</button>
            </div>
          </div>
          <div class="roster-content ${lineupPlayers.length > rosterPageSize ? "has-pagination" : ""}">
            <form id="add-player-form" class="add-player-form ${addFormOpen ? "" : "hidden"}" novalidate>
              <input class="text-input" name="name" required maxlength="50" placeholder="Player name" aria-label="Player name" ${session.status === "completed" ? "disabled" : ""}>
              <select class="text-input" name="skill" aria-label="Skill level" ${session.status === "completed" ? "disabled" : ""}>${skillOptions(3)}</select>
              <button class="button button-primary button-small" type="submit" ${session.status === "completed" ? "disabled" : ""}>Add</button>
            </form>
            <form id="reclub-import-form" class="reclub-import-form ${reclubImportOpen ? "" : "hidden"}" novalidate>
              <input id="reclub-event-url" class="text-input" name="eventUrl" type="url" required maxlength="2048" aria-label="Public Reclub event link" placeholder="https://reclub.co/m/EVENTCODE" ${session.status === "completed" || importingReclub ? "disabled" : ""}>
              <button class="button button-primary button-small" type="submit" ${session.status === "completed" || importingReclub ? "disabled" : ""}>${importingReclub ? "Importing…" : "Import confirmed"}</button>
            </form>
            <div class="roster-tools">
              <label class="roster-search-wrap">
                <input class="text-input roster-search" type="search" data-roster-search="lineup" value="${escapeHtml(lineupSearch)}" aria-label="Search lineup players" placeholder="Search players">
              </label>
              <button class="button button-secondary button-small roster-manager-trigger" data-action="open-player-manager">View all players <span aria-hidden="true">→</span></button>
            </div>
            <div class="roster-list ${lineupPlayers.length > rosterPageSize ? "has-pagination" : ""}">
              ${visiblePlayers.length ? visiblePlayers.map((player) => playerRow(player, playingIds, proposedIds, pausedIds)).join("") :
                lineupSearch ? '<div class="empty-state"><strong>No matching players</strong><span>Try a different name.</span></div>' :
                  '<div class="empty-state"><span class="empty-icon">♧</span><strong>Your lineup starts here</strong><span>Add players to get the session going.</span></div>'}
            </div>
            ${session.status === "draft" ? '<p class="panel-hint">Add at least 2 players for singles or 4 for doubles, then start.</p>' : ""}
            ${paginationControls("roster-page", rosterPage, rosterPageCount, lineupPlayers.length)}
          </div>
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
            <div class="waiting-cards ${waiting.length > waitingPageSize ? "has-pagination" : ""}">${waiting.length ? visibleWaiting.map(waitingCard).join("") : '<span class="muted">No unassigned players waiting</span>'}</div>
            ${paginationControls("waiting-page", waitingPage, waitingPageCount, waiting.length)}
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
      ${rosterManagerOpen ? `
        <div class="roster-manager-backdrop" data-action="close-player-manager-backdrop">
          <section class="roster-manager" role="dialog" aria-modal="true" aria-labelledby="roster-manager-title">
            <div class="roster-manager-heading">
              <div><p class="eyebrow">PLAYER MANAGEMENT</p><h2 id="roster-manager-title">All players <span class="count-badge">${session.players.length}</span></h2></div>
              <button class="icon-button roster-manager-close" data-action="close-player-manager" aria-label="Close player manager">×</button>
            </div>
            <div class="roster-manager-toolbar">
              <label class="roster-filter-label" for="roster-status-filter">Filter by status</label>
              <select id="roster-status-filter" class="text-input" data-roster-filter>
                ${[
                  ["all", "All statuses"],
                  ["active", "Active"],
                  ["queued", "Queued"],
                  ["playing", "Playing"],
                  ["paused", "Paused"],
                  ["resting", "Resting"],
                  ["unavailable", "Unavailable"]
                ].map(([value, label]) => `<option value="${value}" ${rosterManagerFilter === value ? "selected" : ""}>${label}</option>`).join("")}
              </select>
              <label class="roster-search-wrap">
                <input class="text-input roster-search" type="search" data-roster-search="manager" value="${escapeHtml(rosterManagerSearch)}" aria-label="Search all players" placeholder="Search players">
              </label>
            </div>
            <div class="roster-manager-selectbar">
              <label><input type="checkbox" data-select-visible ${managerPlayers.length > 0 && visibleSelectedCount === managerPlayers.length ? "checked" : ""} ${managerPlayers.length ? "" : "disabled"}> Select visible</label>
              <span>${selectedPlayerIds.size} selected</span>
              <button class="button button-quiet button-small" data-action="clear-player-selection" ${selectedPlayerIds.size ? "" : "disabled"}>Clear</button>
            </div>
            <div class="roster-manager-list">
              ${managerPlayers.length ? managerPlayers.map((player) => managerPlayerRow(player, playingIds, proposedIds, pausedIds)).join("") : '<p class="roster-manager-empty">No players match these filters.</p>'}
            </div>
            <div class="roster-manager-actions">
              <button class="button button-secondary button-small" data-action="bulk-rest" ${session.status === "completed" || !selectedCanRest.length ? "disabled" : ""}>Mark rest${selectedCanRest.length ? ` (${selectedCanRest.length})` : ""}</button>
              <button class="button button-quiet button-small" data-action="bulk-return" ${session.status === "completed" || !selectedCanReturn.length ? "disabled" : ""}>Return${selectedCanReturn.length ? ` (${selectedCanReturn.length})` : ""}</button>
              <button class="button button-danger-quiet button-small" data-action="bulk-remove" ${session.status === "completed" || !selectedCanRemove.length ? "disabled" : ""}>Remove${selectedCanRemove.length ? ` (${selectedCanRemove.length})` : ""}</button>
            </div>
            <p class="roster-manager-hint">Players with recorded games cannot be removed. Changing the status of queued players cancels their queued matches.</p>
          </section>
        </div>` : ""}
      <footer class="page-footer">PickleQueue ni Loyloy <span>·</span> Fair play, better rotations.</footer>
    </div>`;
  requestAnimationFrame(syncDashboardPanels);
}

function syncDashboardPanels() {
  const rosterPanel = document.querySelector(".roster-panel");
  const matchesPanel = document.querySelector(".matches-panel");
  if (!rosterPanel || !matchesPanel) return;

  if (!window.matchMedia("(min-width: 851px)").matches) {
    rosterPanel.style.height = "";
    fitRosterPageSize();
    return;
  }

  rosterPanel.style.height = "";
  rosterPanel.style.height = `${matchesPanel.getBoundingClientRect().height}px`;
  fitRosterPageSize();
}

function fitRosterPageSize() {
  const rosterPanel = document.querySelector(".roster-panel");
  const rosterList = document.querySelector(".roster-list");
  const firstRow = rosterList?.querySelector(".player-row");
  if (!rosterPanel || !rosterList || !firstRow) return;
  const matchingPlayerCount = searchPlayers(session.players, lineupSearch).length;

  let targetPageSize = defaultRosterPageSize;
  if (window.matchMedia("(min-width: 851px)").matches) {
    const styles = window.getComputedStyle(rosterPanel);
    const panelBottom = rosterPanel.getBoundingClientRect().bottom -
      parseFloat(styles.borderBottomWidth) - parseFloat(styles.paddingBottom);
    const listTop = rosterList.getBoundingClientRect().top;
    const rowHeight = firstRow.getBoundingClientRect().height;
    const hint = rosterPanel.querySelector(".panel-hint");
    const hintStyles = hint ? window.getComputedStyle(hint) : null;
    const hintSpace = hint
      ? hint.getBoundingClientRect().height + parseFloat(hintStyles.marginTop) + parseFloat(hintStyles.marginBottom)
      : 0;
    const availableHeight = Math.max(0, panelBottom - listTop - hintSpace);
    const rowsWithoutPagination = Math.max(1, Math.floor(availableHeight / rowHeight));
    const needsPagination = matchingPlayerCount > rowsWithoutPagination;
    targetPageSize = Math.max(1, Math.floor(
      (availableHeight - (needsPagination ? paginationReservedSpace : 0)) / rowHeight
    ));
  }
  if (targetPageSize === rosterPageSize) {
    rosterAnchorIndexAfterResize = null;
    return;
  }

  const anchorIndex = rosterAnchorIndexAfterResize !== null
    ? rosterAnchorIndexAfterResize
    : rosterPage * rosterPageSize;
  rosterPageSize = targetPageSize;
  const pageCount = Math.max(1, Math.ceil(matchingPlayerCount / rosterPageSize));
  rosterPage = Math.min(Math.floor(anchorIndex / rosterPageSize), pageCount - 1);
  rosterAnchorIndexAfterResize = null;
  render();
}

window.addEventListener("resize", () => requestAnimationFrame(syncDashboardPanels));

function sessionControls() {
  if (session.status === "draft") {
    const needed = session.format === "doubles" ? 4 : 2;
    const available = session.players.filter((player) => ["active", "resting"].includes(player.status)).length;
    return `<button class="button button-primary" data-action="start-session" ${available < needed ? "disabled" : ""}>Start session <span aria-hidden="true">→</span></button>`;
  }
  if (session.status === "active") return '<button class="button button-pause" data-action="pause-session">Ⅱ Pause session</button><button class="button button-danger-quiet" data-action="end-session">End session</button>';
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

function managerPlayerStatus(player, playingIds, proposedIds, pausedIds) {
  if (playingIds.has(player.id)) return pausedIds.has(player.id) ? "paused" : "playing";
  if (proposedIds.has(player.id)) return "queued";
  return player.status;
}

function searchPlayers(players, query) {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  return normalizedQuery
    ? players.filter((player) => player.name.toLocaleLowerCase().includes(normalizedQuery))
    : players;
}

function managerPlayerRow(player, playingIds, proposedIds, pausedIds) {
  const status = managerPlayerStatus(player, playingIds, proposedIds, pausedIds);
  return `<label class="roster-manager-player">
    <input type="checkbox" data-roster-player="${escapeHtml(player.id)}" ${selectedPlayerIds.has(player.id) ? "checked" : ""} aria-label="Select ${escapeHtml(player.name)}">
    <span class="avatar avatar-${player.skill}">${initials(player.name)}</span>
    <span class="roster-manager-player-main"><strong>${escapeHtml(player.name)}</strong><small>${skillName(player.skill)} · ${player.games} ${plural(player.games, "game")}</small></span>
    <span class="player-status status-${status}">${titleCase(status)}</span>
  </label>`;
}

function sortPlayersByName(players) {
  return [...players].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
}

function matchCard(match) {
  const teams = match.teams.map((team) => team.map((id) => session.players.find((player) => player.id === id)).filter(Boolean));
  const score = Number.isInteger(match.scoreA) && Number.isInteger(match.scoreB) ? `${match.scoreA} – ${match.scoreB}` : match.score || "";
  const activeCourts = session.matches.filter((entry) => entry.status === "inProgress").length;
  const timer = match.status === "inProgress"
    ? `<span class="match-timer" data-started-at="${escapeHtml(match.startedAt ?? "")}" data-paused-at="${escapeHtml(match.pausedAt ?? "")}" data-total-paused="${Number(match.totalPausedMs ?? 0)}" aria-label="Game duration" aria-live="off">${formatElapsed(match.startedAt, match.pausedAt, match.totalPausedMs)}</span>`
    : "";
  const activeCourtNumbers = new Set(session.matches
    .filter((entry) => entry.status === "inProgress")
    .map((entry) => entry.court));
  const reservedCourtNumbers = new Set(session.matches
    .filter((entry) => entry.id !== match.id && ["proposed", "inProgress"].includes(entry.status))
    .map((entry) => entry.court));
  const canReassignCourt = Array.from({ length: session.courts }, (_, index) => index + 1)
    .some((court) => !reservedCourtNumbers.has(court));
  const canStart = session.status === "active" && activeCourts < session.courts &&
    (!activeCourtNumbers.has(match.court) || canReassignCourt) &&
    match.playerIds.every((id) => session.players.find((player) => player.id === id)?.status === "active");
  return `<article class="match-card ${match.status === "inProgress" ? "match-playing" : ""} ${match.pausedAt ? "match-paused" : ""}">
    <div class="match-top"><div class="court-label"><span class="court-icon">▦</span> Court ${match.court ?? "unassigned"} ${match.kind === "custom" ? '<span class="custom-badge">CUSTOM</span>' : ""}</div><span class="match-status">${match.status === "inProgress" ? `${match.pausedAt ? "PAUSED" : "IN PLAY"} · LOCKED ${timer}` : "QUEUED"}</span></div>
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
  const waitSince = Number.isFinite(player.waitSince) ? new Date(player.waitSince).toISOString() : "";
  const waitingTime = waitSince ? formatElapsed(waitSince) : "00:00";
  return `<article class="waiting-card"><div class="avatar avatar-${player.skill}">${initials(player.name)}</div><div class="waiting-player-info"><strong>${escapeHtml(player.name)}</strong><span>${skillName(player.skill)} · ${winRate} · ${player.wins}W/${player.games}G</span><small>Waiting <span class="waiting-timer" data-wait-since="${escapeHtml(waitSince)}">${waitingTime}</span> · Available</small></div><button class="icon-button" data-action="rest-player" data-id="${player.id}" title="Put ${escapeHtml(player.name)} on break" aria-label="Put ${escapeHtml(player.name)} on break">Ⅱ</button></article>`;
}

function paginationControls(action, page, pageCount, itemCount) {
  if (itemCount <= (action === "roster-page" ? rosterPageSize : waitingPageSize)) return "";
  const label = action === "roster-page" ? "Players" : "Available players";
  return `<nav class="list-pagination" aria-label="${label} pages">
    <button class="button button-quiet button-small" data-action="${action}" data-page="${page - 1}" aria-label="Previous ${label.toLowerCase()} page" ${page === 0 ? "disabled" : ""}>← Previous</button>
    <span aria-live="polite">Page ${page + 1} of ${pageCount}</span>
    <button class="button button-quiet button-small" data-action="${action}" data-page="${page + 1}" aria-label="Next ${label.toLowerCase()} page" ${page === pageCount - 1 ? "disabled" : ""}>Next →</button>
  </nav>`;
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
  return `<span class="setting-help" tabindex="0" role="img" aria-label="${text}"><span aria-hidden="true">i</span><span class="setting-tooltip" role="tooltip">${text}</span></span>`;
}

function skillOptions(selected) {
  return SKILLS.map(({ label, value }) => `<option value="${value}" ${Number(selected) === value ? "selected" : ""}>${label}</option>`).join("");
}

function formatSessionDateInput(date) {
  return `${date.getMonth() + 1}/${date.getDate()}/${date.getFullYear()}`;
}

function parseSessionDate(value) {
  if (!value.trim()) return "";
  const match = value.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!match) return null;

  const [, monthText, dayText, yearText] = match;
  const month = Number(monthText);
  const day = Number(dayText);
  const year = Number(yearText);
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
  if (year < 1 || month < 1 || month > 12 || !daysInMonth || day < 1 || day > daysInMonth) return null;
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function updateSessionDateValidity(input) {
  const date = parseSessionDate(input.value);
  input.setCustomValidity(date === null ? "Enter a valid date as M/D/YYYY." : "");
}

function showError(error) {
  notice = `Error: ${error.message}`;
  render();
}

function validateForm(form) {
  clearFormValidation(form);
  const invalidTargets = getInvalidTargets(form);
  if (!invalidTargets.length) {
    clearValidationNotice();
    return true;
  }

  for (const { field, group } of invalidTargets) {
    if (group) {
      group.classList.add("is-invalid");
      group.querySelectorAll('input[type="radio"]').forEach((radio) => radio.setAttribute("aria-invalid", "true"));
    } else {
      field.classList.add("is-invalid");
      field.setAttribute("aria-invalid", "true");
    }
  }

  const message = validationSummaryText(invalidTargets);
  const summary = document.createElement("p");
  summary.className = "form-validation-message";
  summary.setAttribute("aria-live", "off");
  summary.textContent = message;
  const actionRow = form.querySelector(".dialog-actions");
  const submitButton = form.querySelector('button[type="submit"]');
  if (actionRow) form.insertBefore(summary, actionRow);
  else if (form.matches(".add-player-form, .reclub-import-form")) form.append(summary);
  else form.insertBefore(summary, submitButton ?? null);
  setValidationNotice(message, true);
  updateToast();
  invalidTargets[0].field.focus();
  return false;
}

function getInvalidTargets(form) {
  const targets = [];
  const invalidGroups = new Set();
  for (const field of form.elements) {
    if (!field.willValidate || field.validity.valid) continue;
    const group = field.type === "radio" ? field.closest(".feedback-rating") : null;
    if (group) {
      if (invalidGroups.has(group)) continue;
      invalidGroups.add(group);
      targets.push({ field, group, label: "session rating" });
    } else {
      const label = field.labels?.[0]?.textContent.replace(/\s*\(required\)\s*/i, "").trim() ||
        field.getAttribute("aria-label") || "required field";
      targets.push({ field, group: null, label });
    }
  }
  return targets;
}

function validationSummaryText(targets) {
  if (targets.length > 1) return `Please complete the ${targets.length} highlighted required fields before continuing.`;
  const { field, label } = targets[0];
  if (field.validity.valueMissing) return `Please complete the required ${label} before continuing.`;
  return `${label}: ${field.validationMessage}`;
}

function clearFormValidation(form) {
  form.querySelectorAll(".is-invalid").forEach((field) => field.classList.remove("is-invalid"));
  form.querySelectorAll('[aria-invalid="true"]').forEach((field) => field.removeAttribute("aria-invalid"));
  form.querySelectorAll(".form-validation-message").forEach((message) => message.remove());
}

function clearCorrectedField(field) {
  if (!field.willValidate) return;
  const form = field.form;
  const radioGroup = field.type === "radio" ? field.closest(".feedback-rating") : null;
  const hadValidationError = field.classList.contains("is-invalid") ||
    radioGroup?.classList.contains("is-invalid") ||
    form?.querySelector(".form-validation-message");
  if (!hadValidationError) return;

  if (field.validity.valid) {
    field.classList.remove("is-invalid");
    field.removeAttribute("aria-invalid");
  }
  if (field.type === "radio" && field.validity.valid) {
    radioGroup?.classList.remove("is-invalid");
    radioGroup?.querySelectorAll('[aria-invalid="true"]').forEach((radio) => radio.removeAttribute("aria-invalid"));
  }
  if (!form) return;
  const invalidTargets = getInvalidTargets(form);
  if (invalidTargets.length) {
    const summary = form.querySelector(".form-validation-message");
    if (summary) {
      summary.textContent = validationSummaryText(invalidTargets);
    }
    return;
  }
  form.querySelectorAll(".form-validation-message").forEach((message) => message.remove());
  clearValidationNotice();
}

function setValidationNotice(message, refresh = false) {
  if (notice === message && !refresh) return;
  if (notice === message) {
    notice = "";
    updateToast();
  }
  validationNotice = message;
  notice = message;
}

function clearValidationNotice() {
  if (!validationNotice) return;
  if (notice === validationNotice) notice = "";
  validationNotice = "";
  updateToast();
}

function updateToast() {
  if (!notice) {
    clearTimeout(noticeTimeout);
    noticeTimeout = null;
    displayedNotice = "";
    toastNotification.hidden = true;
    toastNotification.classList.remove("is-fading", "toast-error");
    toastMessage.textContent = "";
    return;
  }
  if (notice === displayedNotice) return;

  clearTimeout(noticeTimeout);
  displayedNotice = notice;
  const isError = notice.startsWith("Error:") || notice === validationNotice || notice.includes("emails could not be sent");
  toastNotification.classList.toggle("toast-error", isError);
  toastNotification.setAttribute("role", isError ? "alert" : "status");
  toastNotification.setAttribute("aria-live", isError ? "assertive" : "polite");
  toastIndicator.textContent = isError ? "!" : "✓";
  toastMessage.textContent = notice;
  toastNotification.classList.remove("is-fading");
  toastNotification.hidden = false;

  const currentNotice = notice;
  noticeTimeout = setTimeout(() => {
    toastNotification.classList.add("is-fading");
    noticeTimeout = setTimeout(() => {
      if (notice !== currentNotice) return;
      notice = "";
      updateToast();
    }, 350);
  }, 5000);
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
    `Email: ${organizer.email || "Not provided"}`,
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
    lines.push(
      "",
      "Organizer feedback:",
      session.feedbackRating ? `Rating: ${session.feedbackRating}/5 stars` : "Rating: Not provided",
      session.feedback || "Not submitted."
    );
  }
  return lines.join("\n");
}

async function emailSessionReport(reportType) {
  if (!session.organizer?.name || !session.organizer?.contactNumber || !session.organizer?.email || !session.courtName) {
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
        organizerName: session.organizer.name,
        organizerEmail: session.organizer.email,
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
    return `Session saved, but one or more session emails could not be sent: ${error.message}`;
  }
}

function openOrganizerDialog() {
  organizerForm.reset();
  organizerForm.elements.name.value = session.organizer?.name ?? "";
  organizerForm.elements.contactNumber.value = session.organizer?.contactNumber ?? "";
  organizerForm.elements.email.value = session.organizer?.email ?? "";
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
  }
}

document.addEventListener("reset", (event) => {
  clearFormValidation(event.target);
  event.target.querySelector("#session-date")?.setCustomValidity("");
  clearValidationNotice();
});

function requestConfirmation({ title, message, confirmLabel = "Confirm", eyebrow = "CONFIRM ACTION" }) {
  document.querySelector("#confirm-title").textContent = title;
  document.querySelector("#confirm-message").textContent = message;
  document.querySelector("#confirm-accept").textContent = confirmLabel;
  document.querySelector("#confirm-eyebrow").textContent = eyebrow;
  confirmDialog.showModal();
  return new Promise((resolve) => {
    resolveConfirmation = resolve;
  });
}

function closeConfirmation(confirmed) {
  const resolve = resolveConfirmation;
  resolveConfirmation = null;
  confirmDialog.close();
  resolve?.(confirmed);
}

app.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (event.target.id === "create-form") updateSessionDateValidity(event.target.querySelector("#session-date"));
  if (!validateForm(event.target)) return;
  const data = new FormData(event.target);
  try {
    if (event.target.id === "create-form") {
      const values = Object.fromEntries(data.entries());
      values.date = parseSessionDate(values.date);
      session = createSession(values);
      persist();
      notice = "";
      render();
    } else if (event.target.id === "add-player-form") {
      const addedPlayer = addPlayer(session, Object.fromEntries(data.entries()));
      lineupSearch = "";
      addFormOpen = true;
      const sortedPlayerIndex = sortPlayersByName(session.players).findIndex((player) => player.id === addedPlayer.id);
      rosterAnchorIndexAfterResize = sortedPlayerIndex;
      rosterPage = Math.floor(sortedPlayerIndex / rosterPageSize);
      persist();
      notice = "";
      render();
      document.querySelector('#add-player-form [name="name"]').focus();
    } else if (event.target.id === "reclub-import-form") {
      if (importingReclub) return;
      importingReclub = true;
      notice = "Importing confirmed Reclub players…";
      render();
      try {
        const response = await fetch("/api/reclub-import", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ eventUrl: data.get("eventUrl") })
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || "The Reclub event could not be imported.");
        if (!Array.isArray(result.players) || !result.players.every((name) => typeof name === "string")) {
          throw new Error("The Reclub import returned an invalid player list.");
        }
        const imported = importRestingPlayers(session, result.players);
        lineupSearch = "";
        persist();
        notice = `Imported ${imported.length} confirmed player${imported.length === 1 ? "" : "s"} as Intermediate and placed them on break.`;
        reclubImportOpen = false;
        rosterPage = Math.max(0, Math.ceil(session.players.length / rosterPageSize) - 1);
        render();
      } finally {
        importingReclub = false;
      }
    }
  } catch (error) {
    showError(error);
  }
});

resultForm.addEventListener("submit", (event) => {
  event.preventDefault();
  if (!validateForm(resultForm)) return;
  const data = new FormData(resultForm);
  (async () => {
    try {
      if (resultForm.dataset.mode === "edit-score") {
        const confirmed = await requestConfirmation({
          title: "Correct recorded score?",
          message: "The winner and player statistics will be recalculated using this score.",
          confirmLabel: "Correct score",
          eyebrow: "EDIT RESULT"
        });
        if (!confirmed) return;
        editCompletedScore(session, data.get("matchId"), data.get("scoreA"), data.get("scoreB"));
      } else {
        recordResultAndGenerate(session, data.get("matchId"), data.get("scoreA"), data.get("scoreB"));
      }
      resultDialog.close();
      commit();
    } catch (error) {
      showError(error);
    }
  })();
});

matchForm.addEventListener("submit", (event) => {
  event.preventDefault();
  if (!validateForm(matchForm)) return;
  const data = new FormData(matchForm);
  const teamSize = session.format === "doubles" ? 2 : 1;
  const teams = [
    Array.from({ length: teamSize }, (_, index) => data.get(`teamA${index}`)),
    Array.from({ length: teamSize }, (_, index) => data.get(`teamB${index}`))
  ];
  try {
    if (matchForm.dataset.mode === "custom") {
      createCustomMatch(session, teams);
      notice = "";
    } else {
      editQueuedMatch(session, data.get("matchId"), teams);
      notice = "";
    }
    matchDialog.close();
    persist();
    render();
  } catch (error) {
    showError(error);
  }
});

playerForm.addEventListener("submit", (event) => {
  event.preventDefault();
  if (!validateForm(playerForm)) return;
  const data = new FormData(playerForm);
  try {
    updatePlayer(session, data.get("playerId"), {
      name: data.get("name"),
      skill: data.get("skill")
    });
    playerDialog.close();
    commit();
  } catch (error) {
    showError(error);
  }
});

playerForm.addEventListener("input", updatePlayerPreview);
playerForm.addEventListener("change", updatePlayerPreview);

organizerForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!validateForm(organizerForm)) return;
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
  if (!validateForm(feedbackForm)) return;
  const data = new FormData(feedbackForm);
  const feedback = data.get("feedback").trim();
  const rating = Number(data.get("rating"));
  session.feedbackRating = rating;
  session.feedback = feedback;
  feedbackDialog.close();
  await sendReportAndNotify("ended");
});
document.addEventListener("input", (event) => {
  if (event.target.matches("#session-date")) updateSessionDateValidity(event.target);
  clearCorrectedField(event.target);
});
document.addEventListener("change", (event) => clearCorrectedField(event.target));

confirmForm.addEventListener("submit", (event) => {
  event.preventDefault();
  closeConfirmation(true);
});
confirmForm.querySelector('[data-action="cancel-confirm"]').addEventListener("click", () => closeConfirmation(false));
confirmDialog.addEventListener("cancel", (event) => {
  event.preventDefault();
  closeConfirmation(false);
});

document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape" || !rosterManagerOpen || confirmDialog.open) return;
  rosterManagerOpen = false;
  selectedPlayerIds.clear();
  render();
});

toastNotification.querySelector(".toast-dismiss").addEventListener("click", () => {
  notice = "";
  updateToast();
});
app.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-action]");
  if (!button) return;
  const { action, id } = button.dataset;
  try {
    if (action === "show-create-form") {
      createFormOpen = true;
      render();
      document.querySelector("#organizer-name").focus();
      return;
    }
    if (action === "roster-page" || action === "waiting-page") {
      const page = Number(button.dataset.page);
      if (!Number.isInteger(page) || page < 0) return;
      if (action === "roster-page") rosterPage = page;
      else waitingPage = page;
      render();
      return;
    }
    if (action === "toggle-add") {
      addFormOpen = !addFormOpen;
      if (addFormOpen) reclubImportOpen = false;
      render();
      if (addFormOpen) document.querySelector('#add-player-form [name="name"]').focus();
      return;
    }
    if (action === "toggle-reclub-import") {
      reclubImportOpen = !reclubImportOpen;
      if (reclubImportOpen) addFormOpen = false;
      render();
      if (reclubImportOpen) document.querySelector("#reclub-event-url").focus();
      return;
    }
    if (action === "open-player-manager") {
      rosterManagerOpen = true;
      rosterManagerFilter = "all";
      selectedPlayerIds.clear();
      render();
      document.querySelector(".roster-manager-close").focus();
      return;
    }
    if (action === "close-player-manager" || action === "close-player-manager-backdrop") {
      if (action === "close-player-manager-backdrop" && event.target !== button) return;
      rosterManagerOpen = false;
      selectedPlayerIds.clear();
      render();
      return;
    }
    if (action === "clear-player-selection") {
      selectedPlayerIds.clear();
      render();
      document.querySelector('[data-action="clear-player-selection"]').focus();
      return;
    }
    if (action === "bulk-rest" || action === "bulk-return" || action === "bulk-remove") {
      await applyBulkPlayerAction(action);
      return;
    }
    let reportType = null;
    if (action === "start-session") {
      if (!session.organizer?.name || !session.organizer?.contactNumber || !session.organizer?.email || !session.courtName) {
        pendingSessionAction = "start";
        openOrganizerDialog();
        return;
      }
      startSession(session);
      reportType = "started";
    }
    if (action === "pause-session") pauseSession(session);
    if (action === "resume-session") resumeSession(session);
    if (action === "submit-feedback") {
      feedbackForm.reset();
      feedbackDialog.showModal();
      feedbackForm.elements.feedback.focus();
      return;
    }
    if (action === "end-session") {
      const unfinished = session.matches.filter((match) => ["proposed", "inProgress"].includes(match.status)).length;
      const explanation = unfinished ? ` This will cancel ${unfinished} unfinished or proposed ${plural(unfinished, "game")} without recording results.` : "";
      const confirmed = await requestConfirmation({
        title: `End ${session.name}?`,
        message: `This will complete the session.${explanation}`,
        confirmLabel: "End session"
      });
      if (!confirmed) return;
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
      notice = result.matches.length ? "" : result.message;
      persist();
      render();
      return;
    }
    if (action === "start-match") startMatch(session, id);
    if (action === "create-custom") openMatchEditor("custom");
    if (action === "edit-match") openMatchEditor("edit", id);
    if (action === "pause-game") pauseMatch(session, id);
    if (action === "resume-game") resumeMatch(session, id);
    if (action === "stop-game") {
      if (!await requestConfirmation({
        title: "Stop this game?",
        message: "The game will return to the editable queue without recording a score.",
        confirmLabel: "Stop game"
      })) return;
      stopMatch(session, id);
      notice = "";
    }
    if (action === "cancel-match") {
      if (!await requestConfirmation({
        title: "Remove this queued match?",
        message: "The match will be removed from the live queue.",
        confirmLabel: "Remove match"
      })) return;
      cancelProposedMatch(session, id);
    }
    if (action === "rest-player") await changeAvailability(id, "resting");
    if (action === "unavailable-player") await changeAvailability(id, "unavailable");
    if (action === "return-player") setPlayerAvailability(session, id, "active");
    if (action === "remove-player") {
      const player = session.players.find((entry) => entry.id === id);
      if (!await requestConfirmation({
        title: `Remove ${player.name}?`,
        message: "This player will be removed from this session and any queued match they are in will be canceled.",
        confirmLabel: "Remove player"
      })) return;
      removePlayer(session, id, { confirmRemoval: true });
    }
    if (action === "edit-player") {
      const player = session.players.find((entry) => entry.id === id);
      openPlayerEditor(player);
    }
    if (action === "record-result") openResult(id);
    if (action === "edit-score") openResult(id, true);
    if (action === "new-session") {
      if (!session.feedback) {
        feedbackForm.reset();
        feedbackDialog.showModal();
        feedbackForm.elements.feedback.focus();
        return;
      }
      if (!await requestConfirmation({
        title: "Start a new session?",
        message: "This will replace the session currently saved on this device.",
        confirmLabel: "Start new session"
      })) return;
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

async function changeAvailability(playerId, status) {
  const result = setPlayerAvailability(session, playerId, status);
  if (result.requiresConfirmation) {
    const player = session.players.find((entry) => entry.id === playerId);
    const confirmed = await requestConfirmation({
      title: `Change ${player.name}'s status?`,
      message: `${player.name} is in a queued match. Changing their status will remove that match from the queue.`,
      confirmLabel: "Change status"
    });
    if (!confirmed) return false;
    setPlayerAvailability(session, playerId, status, { confirmRemoval: true });
  }
  return result.changed || result.requiresConfirmation;
}

async function applyBulkPlayerAction(action) {
  const selected = session.players.filter((player) => selectedPlayerIds.has(player.id));
  const playingIds = new Set(session.matches
    .filter((match) => match.status === "inProgress")
    .flatMap((match) => match.playerIds));
  if (action === "bulk-rest") {
    const targets = selected.filter((player) => player.status === "active" && !playingIds.has(player.id));
    if (!targets.length) {
      notice = "Select active players who are not currently playing to put them on break.";
      render();
      return;
    }
    const targetIds = new Set(targets.map((player) => player.id));
    const queuedCount = session.matches.filter((match) =>
      match.status === "proposed" && match.playerIds.some((id) => targetIds.has(id))).length;
    if (queuedCount && !await requestConfirmation({
      title: "Put selected players on break?",
      message: `This will cancel ${queuedCount} queued ${plural(queuedCount, "match")} containing selected players.`,
      confirmLabel: "Mark rest"
    })) return;
    targets.forEach((player) => setPlayerAvailability(session, player.id, "resting", { confirmRemoval: true }));
    notice = `${targets.length} player${targets.length === 1 ? "" : "s"} marked as resting.`;
  } else if (action === "bulk-return") {
    const targets = selected.filter((player) => ["resting", "unavailable"].includes(player.status));
    if (!targets.length) {
      notice = "Select resting or unavailable players to return to the queue.";
      render();
      return;
    }
    targets.forEach((player) => setPlayerAvailability(session, player.id, "active"));
    notice = `${targets.length} player${targets.length === 1 ? "" : "s"} returned to the queue.`;
  } else {
    const targets = selected.filter((player) => player.games === 0 && !playingIds.has(player.id));
    if (!targets.length) {
      notice = "Only players who have not played and are not currently on court can be removed.";
      render();
      return;
    }
    const skipped = selected.length - targets.length;
    const targetIds = new Set(targets.map((player) => player.id));
    const queuedCount = session.matches.filter((match) =>
      match.status === "proposed" && match.playerIds.some((id) => targetIds.has(id))).length;
    const details = [
      `${targets.length} eligible ${plural(targets.length, "player")} will be removed.`,
      skipped ? `${skipped} selected ${plural(skipped, "player")} with games played or currently on court will be skipped.` : "",
      queuedCount ? `${queuedCount} queued ${plural(queuedCount, "match")} will also be cancelled.` : ""
    ].filter(Boolean).join(" ");
    if (!await requestConfirmation({
      title: "Remove selected players?",
      message: details,
      confirmLabel: `Remove ${targets.length} ${plural(targets.length, "player")}`
    })) return;
    targets.forEach((player) => removePlayer(session, player.id, { confirmRemoval: true }));
    notice = `Removed ${targets.length} player${targets.length === 1 ? "" : "s"}${skipped ? `; skipped ${skipped} who cannot be removed` : ""}.`;
  }
  selectedPlayerIds.clear();
  persist();
  render();
}

app.addEventListener("input", (event) => {
  const search = event.target.closest("[data-roster-search]");
  if (!search) return;

  const searchArea = search.dataset.rosterSearch;
  const selectionStart = search.selectionStart;
  const selectionEnd = search.selectionEnd;
  if (searchArea === "lineup") {
    lineupSearch = search.value;
    rosterPage = 0;
  } else {
    rosterManagerSearch = search.value;
  }
  render();
  const updatedSearch = document.querySelector(`[data-roster-search="${searchArea}"]`);
  updatedSearch?.focus();
  if (Number.isInteger(selectionStart) && Number.isInteger(selectionEnd)) {
    updatedSearch?.setSelectionRange(selectionStart, selectionEnd);
  }
});

app.addEventListener("change", (event) => {
  if (event.target.matches("[data-roster-filter]")) {
    rosterManagerFilter = event.target.value;
    render();
    document.querySelector("[data-roster-filter]").focus();
    return;
  }
  if (event.target.matches("[data-roster-player]")) {
    const playerId = event.target.dataset.rosterPlayer;
    if (event.target.checked) selectedPlayerIds.add(playerId);
    else selectedPlayerIds.delete(playerId);
    render();
    [...document.querySelectorAll("[data-roster-player]")]
      .find((checkbox) => checkbox.dataset.rosterPlayer === playerId)
      ?.focus();
    return;
  }
  if (event.target.matches("[data-select-visible]")) {
    const playingIds = new Set(session.matches
      .filter((match) => match.status === "inProgress")
      .flatMap((match) => match.playerIds));
    const proposedIds = new Set(session.matches
      .filter((match) => match.status === "proposed")
      .flatMap((match) => match.playerIds));
    const pausedIds = new Set(session.matches
      .filter((match) => match.status === "inProgress" && match.pausedAt)
      .flatMap((match) => match.playerIds));
    const visiblePlayers = searchPlayers(sortPlayersByName(session.players), rosterManagerSearch).filter((player) =>
      rosterManagerFilter === "all" ||
      managerPlayerStatus(player, playingIds, proposedIds, pausedIds) === rosterManagerFilter);
    if (event.target.checked) visiblePlayers.forEach((player) => selectedPlayerIds.add(player.id));
    else visiblePlayers.forEach((player) => selectedPlayerIds.delete(player.id));
    render();
    document.querySelector("[data-select-visible]").focus();
    return;
  }
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
    if (setting === "courts" && session.matches.some((match) =>
      ["proposed", "inProgress"].includes(match.status) && match.court > value)) {
      throw new Error("Court count cannot be less than the highest court assigned to a queued or active match.");
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
  clearFormValidation(resultForm);
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
  clearFormValidation(playerForm);
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
  clearFormValidation(matchForm);
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
      const options = sortPlayersByName(session.players).map((player) => {
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
  document.querySelectorAll(".waiting-timer").forEach((timer) => {
    if (timer.dataset.waitSince) timer.textContent = formatElapsed(timer.dataset.waitSince);
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
