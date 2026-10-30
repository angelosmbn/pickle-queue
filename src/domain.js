export const STORAGE_KEY = "gear-up-rally.session.v1";
export const LEGACY_STORAGE_KEY = "picklequeue.session.v1";

export const SKILLS = [
  { label: "Beginner", value: 1 },
  { label: "Novice", value: 2 },
  { label: "Intermediate", value: 3 },
  { label: "Advanced", value: 4 },
  { label: "Expert", value: 5 }
];

export const DEFAULT_SETTINGS = {
  maxTeamSkillDifference: 2,
  maxTeamGap: 1,
  rotatePartners: true,
  allowConsecutiveGames: true,
  restAfterConsecutiveGames: 2,
  prioritizeWaiting: true,
  prioritizeSimilarSkill: true,
  performanceInfluence: 0.5,
  minimumRankedGames: 3,
  scoringTo: 11,
  allowDeuce: true
};

const BASE_WEIGHTS = {
  skill: 0.34,
  performance: 0.19,
  scoreContext: 0.04,
  participation: 0.14,
  waiting: 0.14,
  partners: 0.1,
  opponents: 0.05
};

const STRATEGY_WEIGHTS = {
  skill: { skill: 0.56, performance: 0.07, scoreContext: 0.03, participation: 0.12, waiting: 0.12, partners: 0.06, opponents: 0.04 },
  wins: { skill: 0.13, performance: 0.45, scoreContext: 0.05, participation: 0.13, waiting: 0.12, partners: 0.07, opponents: 0.05 },
  fair: BASE_WEIGHTS,
  casual: { skill: 0.17, performance: 0.09, scoreContext: 0.03, participation: 0.17, waiting: 0.17, partners: 0.2, opponents: 0.17 }
};

const STRATEGY_NAMES = {
  skill: "Skill-based",
  wins: "Win-rate based",
  fair: "Balanced fair play",
  casual: "Casual / mixed"
};

export function createSession({
  name, date = "", notes = "", courts = 1, format = "doubles", strategy = "fair",
  organizerName = "", contactNumber = "", organizerEmail = "", clubName = "", courtName = ""
}) {
  const cleanName = String(name ?? "").trim();
  if (!cleanName) throw new Error("Enter a session name.");
  const cleanOrganizerEmail = String(organizerEmail ?? "").trim();
  if (!isValidEmail(cleanOrganizerEmail)) throw new Error("Enter a valid organizer email address.");
  const courtCount = Number(courts);
  if (!Number.isInteger(courtCount) || courtCount < 1 || courtCount > 12) {
    throw new Error("Choose between 1 and 12 courts.");
  }
  if (!["singles", "doubles"].includes(format) || !STRATEGY_WEIGHTS[strategy]) {
    throw new Error("Choose a supported game format and queue strategy.");
  }
  return {
    id: makeId("session"),
    name: cleanName,
    date,
    notes: String(notes).trim(),
    courtName: String(courtName).trim(),
    organizer: {
      name: String(organizerName).trim(),
      contactNumber: String(contactNumber).trim(),
      email: cleanOrganizerEmail,
      clubName: String(clubName).trim()
    },
    courts: courtCount,
    format,
    strategy,
    status: "draft",
    createdAt: new Date().toISOString(),
    settings: { ...DEFAULT_SETTINGS },
    players: [],
    matches: []
  };
}

export function updateOrganizerDetails(session, { name, contactNumber, email, clubName = "", courtName }) {
  const cleanName = String(name ?? "").trim();
  const cleanContact = String(contactNumber ?? "").trim();
  const cleanEmail = String(email ?? "").trim();
  const cleanCourtName = String(courtName ?? "").trim();
  if (!cleanName) throw new Error("Enter your name.");
  if (!cleanContact) throw new Error("Enter your contact number.");
  if (!isValidEmail(cleanEmail)) throw new Error("Enter a valid email address.");
  if (!cleanCourtName) throw new Error("Enter a court name.");
  session.courtName = cleanCourtName;
  session.organizer = {
    name: cleanName,
    contactNumber: cleanContact,
    email: cleanEmail,
    clubName: String(clubName ?? "").trim()
  };
  return session.organizer;
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export function addPlayer(session, { name, skill = 3 }) {
  const cleanName = String(name ?? "").trim();
  const rating = Number(skill);
  if (!cleanName) throw new Error("Enter a player name.");
  if (session.players.some((player) => playerNameKey(player.name) === playerNameKey(cleanName))) {
    throw new Error("That player name is already added. Choose a different name.");
  }
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) throw new Error("Choose a skill level.");
  const player = {
    id: makeId("player"),
    name: cleanName,
    skill: rating,
    status: "active",
    games: 0,
    wins: 0,
    losses: 0,
    consecutive: 0,
    waitSince: Date.now(),
    totalWaitMs: 0,
    partners: {},
    opponents: {},
    notes: ""
  };
  session.players.push(player);
  return player;
}

export function importRestingPlayers(session, names) {
  if (session.status === "completed") throw new Error("Players cannot be imported after the session has ended.");
  if (!Array.isArray(names) || names.length === 0 || names.length > 500) {
    throw new Error("The player import must contain between 1 and 500 names.");
  }

  const cleanNames = names.map((value) => {
    if (typeof value !== "string") throw new Error("Every imported player must have a name.");
    const cleanName = value.trim().replace(/\s+/g, " ");
    if (!cleanName) throw new Error("Every imported player must have a name.");
    return cleanName;
  });
  const reservedNames = new Set(cleanNames.map(playerNameKey));
  const usedNames = new Set(session.players.map((player) => playerNameKey(player.name)));
  const uniqueNames = cleanNames.map((cleanName) => {
    let suffix = 1;
    let candidate = cleanName.slice(0, 50);
    while (usedNames.has(playerNameKey(candidate)) ||
        (suffix > 1 && reservedNames.has(playerNameKey(candidate)))) {
      suffix += 1;
      const ending = ` (${suffix})`;
      candidate = `${cleanName.slice(0, 50 - ending.length).trimEnd()}${ending}`;
    }
    usedNames.add(playerNameKey(candidate));
    return candidate;
  });

  return uniqueNames.map((name) => {
    const player = addPlayer(session, { name, skill: 3 });
    setPlayerAvailability(session, player.id, "resting");
    return player;
  });
}

export function startSession(session) {
  if (session.status !== "draft") throw new Error("Only a draft session can be started.");
  const required = session.format === "doubles" ? 4 : 2;
  const startablePlayers = session.players.filter((player) =>
    player.status === "active" || player.status === "resting");
  if (startablePlayers.length < required) {
    throw new Error(`Add at least ${required} available or resting players before starting ${session.format}.`);
  }
  session.players
    .filter((player) => player.status === "resting")
    .forEach((player) => setPlayerAvailability(session, player.id, "active"));
  session.status = "active";
  return generateMatches(session);
}

export function pauseSession(session) {
  if (session.status !== "active") throw new Error("Only an active session can be paused.");
  session.status = "paused";
}

export function resumeSession(session) {
  if (session.status !== "paused") throw new Error("Only a paused session can be resumed.");
  session.status = "active";
}

export function endSession(session, { confirmUnfinished = false } = {}) {
  if (!["active", "paused"].includes(session.status)) throw new Error("This session cannot be ended right now.");
  const unfinished = session.matches.filter((match) => ["proposed", "inProgress"].includes(match.status));
  if (unfinished.length && !confirmUnfinished) return { requiresConfirmation: true, unfinished: unfinished.length };
  unfinished.forEach((match) => { match.status = "cancelled"; });
  session.status = "completed";
  return { completed: true, cancelledMatches: unfinished.length };
}

export function removePlayer(session, playerId, { confirmRemoval = false } = {}) {
  const player = getPlayer(session, playerId);
  if (player.games > 0) throw new Error("Players who have played a game cannot be removed from the session.");
  if (session.matches.some((match) => match.status === "inProgress" && match.playerIds.includes(playerId))) {
    throw new Error("A player in an active game cannot be removed.");
  }
  const proposed = session.matches.filter((match) => match.status === "proposed" && match.playerIds.includes(playerId));
  if (proposed.length && !confirmRemoval) return { removed: false, requiresConfirmation: true };
  proposed.forEach((match) => { match.status = "cancelled"; });
  session.players = session.players.filter((entry) => entry.id !== playerId);
  return { removed: true };
}

export function setPlayerAvailability(session, playerId, status, { confirmRemoval = false } = {}) {
  if (!["active", "resting", "unavailable"].includes(status)) throw new Error("Choose a valid player status.");
  const player = getPlayer(session, playerId);
  if (player.status === status) return { changed: false };
  if (status !== "active") {
    const proposed = session.matches.filter((match) => match.status === "proposed" && match.playerIds.includes(playerId));
    if (proposed.length && !confirmRemoval) return { changed: false, requiresConfirmation: true };
    if (proposed.length) {
      proposed.forEach((match) => { match.status = "cancelled"; });
    }
  }
  const now = Date.now();
  if (player.waitSince !== null && player.status === "active") {
    player.totalWaitMs = (player.totalWaitMs ?? 0) + Math.max(0, now - player.waitSince);
  }
  player.status = status;
  const currentlyPlaying = session.matches.some((match) => match.status === "inProgress" && match.playerIds.includes(playerId));
  player.waitSince = status === "active" && !currentlyPlaying ? now : null;
  return { changed: true };
}

export function updatePlayer(session, playerId, changes) {
  const player = getPlayer(session, playerId);
  if (changes.name !== undefined) {
    const name = String(changes.name).trim();
    if (!name) throw new Error("Player name cannot be blank.");
    if (session.players.some((entry) => entry.id !== playerId && playerNameKey(entry.name) === playerNameKey(name))) {
      throw new Error("That player name is already added. Choose a different name.");
    }
    player.name = name;
  }
  if (changes.skill !== undefined) {
    const skill = Number(changes.skill);
    if (!Number.isInteger(skill) || skill < 1 || skill > 5) throw new Error("Choose a valid skill level.");
    player.skill = skill;
  }
}

export function generateMatches(session, now = Date.now()) {
  if (!["active"].includes(session.status)) return { matches: [], message: "Resume the session before generating matches." };
  const groupSize = session.format === "doubles" ? 4 : 2;
  const occupied = session.matches
    .filter((match) => ["proposed", "inProgress"].includes(match.status))
    .flatMap((match) => match.playerIds);
  const availablePlayers = session.players.filter((player) =>
    player.status === "active" && !occupied.includes(player.id));
  const consecutiveLimit = session.settings.allowConsecutiveGames
    ? session.settings.restAfterConsecutiveGames
    : 1;
  let players = availablePlayers.filter((player) => player.consecutive < consecutiveLimit);
  const courtSlots = Math.max(0, session.courts - session.matches.filter((match) => ["proposed", "inProgress"].includes(match.status)).length);
  let gameSlots = Math.min(courtSlots, Math.floor(players.length / groupSize));
  let forcedPastRestLimit = false;
  if (!gameSlots && courtSlots > 0 && availablePlayers.length >= groupSize) {
    players = availablePlayers;
    gameSlots = Math.min(courtSlots, Math.floor(players.length / groupSize));
    forcedPastRestLimit = true;
  }
  if (!gameSlots) {
    const proposedCount = session.matches.filter((match) => match.status === "proposed").length;
    const message = courtSlots === 0 && proposedCount > 0
      ? "Queued matches already reserve every remaining court. Start or cancel a queued match before generating more."
      : courtSlots === 0 ? "All courts are occupied." :
      players.length === 0 ? "No eligible players are waiting." :
        `Need ${groupSize} available players for ${session.format}. ${players.length} are eligible.`;
    return { matches: [], message };
  }

  const candidates = makeCandidates(players, session, now);
  const defaultSelection = chooseSet(candidates, gameSlots);
  const removedMatch = session.matches.slice().reverse().find((match) =>
    match.kind === "generated" && match.removedAt);
  let selection = defaultSelection;
  if (removedMatch) {
    const previousIds = new Set(removedMatch.playerIds);
    const alternativeGroups = candidates.filter((candidate) =>
      candidate.ids.some((id) => !previousIds.has(id)));
    const alternativeCandidates = alternativeGroups.length
      ? alternativeGroups
      : candidates.filter((candidate) => teamSignature(candidate.teams) !== teamSignature(removedMatch.teams));
    const shuffledCandidates = alternativeCandidates.map((candidate) => ({
      ...candidate,
      score: candidate.score + candidate.ids.filter((id) => !previousIds.has(id)).length * 0.02
    })).sort((a, b) => b.score - a.score ||
      a.ids.join(",").localeCompare(b.ids.join(",")) ||
      teamSignature(a.teams).localeCompare(teamSignature(b.teams)));
    const alternativeSelection = chooseSet(shuffledCandidates, gameSlots);
    if (alternativeSelection.length >= defaultSelection.length) selection = alternativeSelection;
  }
  const generated = selection.map((candidate) => {
    const skillAtMatch = Object.fromEntries(candidate.ids.map((id) => [id, getPlayer(session, id).skill]));
    const match = {
      id: makeId("match"),
      court: nextCourt(session),
      playerIds: candidate.ids,
      teams: candidate.teams,
      kind: "generated",
      skillAtMatch,
      status: "proposed",
      createdAt: new Date(now).toISOString(),
      startedAt: null,
      completedAt: null,
      winnerTeam: null,
      score: "",
      warning: candidate.warning,
      reason: forcedPastRestLimit
        ? `${candidate.reason} Played despite the rest limit because no rested match was available.`
        : candidate.reason
    };
    session.matches.push(match);
    return match;
  });
  if (generated.length && removedMatch) removedMatch.removedAt = null;
  return {
    matches: generated,
    message: generated.length < gameSlots ? "Could not fill every open court without repeating a player." : "",
    considered: candidates.length
  };
}

function teamSignature(teams) {
  return teams.map((team) => [...team].sort().join("|")).sort().join("||");
}

export function startMatch(session, matchId) {
  if (session.status !== "active") throw new Error("Resume the session before starting a game.");
  const match = getMatch(session, matchId);
  if (match.status !== "proposed") throw new Error("Only a proposed match can be started.");
  const groupSize = session.format === "doubles" ? 4 : 2;
  validateTeams(match.teams, groupSize);
  const teamIds = match.teams.flat();
  if (match.playerIds.length !== groupSize || new Set(match.playerIds).size !== groupSize ||
      teamIds.some((id) => !match.playerIds.includes(id))) {
    throw new Error("This match has an invalid player assignment. Edit or remove it before starting.");
  }
  const activeMatches = session.matches.filter((entry) => entry.status === "inProgress");
  if (activeMatches.length >= session.courts) throw new Error("All courts are occupied.");
  const assigned = new Set(activeMatches.flatMap((entry) => entry.playerIds));
  if (match.playerIds.some((id) => assigned.has(id))) throw new Error("A player is already participating in another active game.");
  if (match.playerIds.some((id) => session.matches.some((entry) => entry.id !== match.id && entry.status === "proposed" && entry.playerIds.includes(id)))) {
    throw new Error("A player is reserved for another queued match.");
  }
  if (match.playerIds.some((id) => getPlayer(session, id).status !== "active")) {
    throw new Error("A player is no longer available. Remove this match and generate a replacement.");
  }
  const reservedCourts = new Set(session.matches
    .filter((entry) => entry.id !== match.id && ["proposed", "inProgress"].includes(entry.status))
    .map((entry) => entry.court));
  if (!Number.isInteger(match.court) || match.court < 1 || match.court > session.courts ||
      activeMatches.some((entry) => entry.court === match.court)) {
    match.court = Array.from({ length: session.courts }, (_, index) => index + 1)
      .find((court) => !reservedCourts.has(court));
  }
  if (!match.court) throw new Error("No court is available for this queued match.");
  match.status = "inProgress";
  match.startedAt = new Date().toISOString();
  match.pausedAt = null;
  match.totalPausedMs = 0;
  const startedAt = Date.now();
  match.playerIds.forEach((id) => {
    const player = getPlayer(session, id);
    if (player.waitSince !== null) {
      player.totalWaitMs = (player.totalWaitMs ?? 0) + Math.max(0, startedAt - player.waitSince);
      player.waitSince = null;
    }
  });
}

export function pauseMatch(session, matchId) {
  const match = getMatch(session, matchId);
  if (match.status !== "inProgress") throw new Error("Only an in-progress game can be paused.");
  if (match.pausedAt) throw new Error("This game is already paused.");
  match.pausedAt = new Date().toISOString();
  return match;
}

export function resumeMatch(session, matchId) {
  const match = getMatch(session, matchId);
  if (match.status !== "inProgress" || !match.pausedAt) throw new Error("Only a paused game can be resumed.");
  const pauseStartedAt = Date.parse(match.pausedAt);
  if (!Number.isFinite(pauseStartedAt)) throw new Error("The saved pause time is invalid.");
  match.totalPausedMs = (match.totalPausedMs ?? 0) + Math.max(0, Date.now() - pauseStartedAt);
  match.pausedAt = null;
  return match;
}

export function stopMatch(session, matchId) {
  const match = getMatch(session, matchId);
  if (match.status !== "inProgress") throw new Error("Only an in-progress game can be returned to the queue.");
  match.status = "proposed";
  match.startedAt = null;
  match.pausedAt = null;
  match.totalPausedMs = 0;
  return match;
}

export function recordResult(session, matchId, scoreA, scoreB) {
  const match = getMatch(session, matchId);
  if (match.status !== "inProgress") throw new Error("This game is not in progress or its result was already recorded.");
  if (match.pausedAt) throw new Error("Resume the paused game before recording its result.");
  const { pointsA, pointsB } = validateScore(session, scoreA, scoreB);
  match.scoreA = pointsA;
  match.scoreB = pointsB;
  match.score = `${pointsA}–${pointsB}`;
  match.winnerTeam = pointsA > pointsB ? 0 : 1;
  match.status = "completed";
  match.completedAt = new Date().toISOString();
  match.teams.forEach((team, teamIndex) => {
    team.forEach((id) => {
      const player = getPlayer(session, id);
      player.games += 1;
      if (teamIndex === match.winnerTeam) player.wins += 1;
      else player.losses += 1;
      player.consecutive += 1;
      if (player.status === "active") player.waitSince = Date.now();
      player.participation ??= [];
      player.participation.push({ matchId: match.id, playedAt: match.completedAt });
      const others = match.playerIds.filter((otherId) => otherId !== id);
      others.forEach((otherId) => {
        const field = match.teams[teamIndex].includes(otherId) ? "partners" : "opponents";
        player[field][otherId] = (player[field][otherId] ?? 0) + 1;
      });
    });
  });
  const stillScheduled = new Set(session.matches
    .filter((entry) => ["proposed", "inProgress"].includes(entry.status))
    .flatMap((entry) => entry.playerIds));
  session.players.forEach((player) => {
    if (player.status === "active" && !match.playerIds.includes(player.id) && !stillScheduled.has(player.id)) {
      player.consecutive = 0;
    }
  });
  return match;
}

export function editCompletedScore(session, matchId, scoreA, scoreB) {
  const match = getMatch(session, matchId);
  if (match.status !== "completed") throw new Error("Only completed match scores can be edited.");
  const { pointsA, pointsB } = validateScore(session, scoreA, scoreB);
  match.scoreA = pointsA;
  match.scoreB = pointsB;
  match.score = `${pointsA}–${pointsB}`;
  match.winnerTeam = pointsA > pointsB ? 0 : 1;
  recomputePlayerResults(session);
  return match;
}

export function recordResultAndGenerate(session, matchId, scoreA, scoreB) {
  const result = recordResult(session, matchId, scoreA, scoreB);
  return { result, next: generateMatches(session) };
}

export function cancelProposedMatch(session, matchId) {
  const match = getMatch(session, matchId);
  if (match.status !== "proposed") throw new Error("Only proposed matches can be cancelled.");
  match.status = "cancelled";
  if (match.kind === "generated") match.removedAt = new Date().toISOString();
}

export function createCustomMatch(session, teams) {
  if (session.status !== "active") throw new Error("Custom matches can only be queued in an active session.");
  const groupSize = session.format === "doubles" ? 4 : 2;
  validateTeams(teams, groupSize);
  const ids = teams.flat();
  const playing = new Set(session.matches.filter((match) => match.status === "inProgress").flatMap((match) => match.playerIds));
  ids.forEach((id) => {
    const player = getPlayer(session, id);
    if (player.status !== "active") throw new Error(`${player.name} is not available.`);
    if (playing.has(id)) throw new Error(`${player.name} is already playing.`);
  });
  const proposed = session.matches.filter((match) => match.status === "proposed");
  const queuedIds = new Set(proposed.flatMap((match) => match.playerIds));
  const pullPlans = [];
  const selectedReplacements = new Set();
  for (const match of proposed) {
    const pulledIds = ids.filter((id) => match.playerIds.includes(id));
    if (!pulledIds.length) continue;
    const availableReplacements = session.players.filter((player) =>
      player.status === "active" && !queuedIds.has(player.id) && !ids.includes(player.id) &&
      !playing.has(player.id) && !selectedReplacements.has(player.id));
    if (availableReplacements.length < pulledIds.length) {
      throw new Error(`Cannot pull ${pulledIds.map((id) => getPlayer(session, id).name).join(", ")} from their queued match: not enough unassigned players are available to fill those spots.`);
    }
    const replacementById = new Map();
    for (const pulledId of pulledIds) {
      const pulled = getPlayer(session, pulledId);
      const replacement = availableReplacements
        .filter((player) => !selectedReplacements.has(player.id))
        .sort((a, b) =>
          Math.abs(a.skill - pulled.skill) - Math.abs(b.skill - pulled.skill) ||
          a.waitSince - b.waitSince ||
          a.id.localeCompare(b.id))[0];
      selectedReplacements.add(replacement.id);
      replacementById.set(pulledId, replacement.id);
    }
    const nextTeams = match.teams.map((team) => team.map((id) => replacementById.get(id) ?? id));
    validateTeams(nextTeams, groupSize);
    pullPlans.push({ match, teams: nextTeams });
  }
  const candidate = evaluateTeams(session, teams);
  const match = {
    id: makeId("match"), court: nextCourt(session), playerIds: ids, teams: teams.map((team) => [...team]),
    kind: "custom", skillAtMatch: Object.fromEntries(ids.map((id) => [id, getPlayer(session, id).skill])),
    status: "proposed", createdAt: new Date().toISOString(), startedAt: null, completedAt: null,
    winnerTeam: null, score: "", scoreA: null, scoreB: null, warning: candidate.warning, reason: "Custom matchup set by organizer."
  };
  pullPlans.forEach(({ match: queued, teams: nextTeams }) => {
    queued.teams = nextTeams;
    queued.playerIds = nextTeams.flat();
    queued.skillAtMatch = Object.fromEntries(queued.playerIds.map((id) => [id, getPlayer(session, id).skill]));
    refreshFairness(session, queued);
  });
  session.matches.push(match);
  return match;
}

function nextCourt(session) {
  const reservedCourts = new Set(session.matches
    .filter((match) => ["proposed", "inProgress"].includes(match.status))
    .map((match) => match.court));
  return Array.from({ length: session.courts }, (_, index) => index + 1)
    .find((court) => !reservedCourts.has(court)) ?? 1;
}

export function editQueuedMatch(session, matchId, teams) {
  return editMatchPlayers(session, matchId, teams, false);
}

export function editInProgressMatch(session, matchId, teams) {
  return editMatchPlayers(session, matchId, teams, true);
}

function editMatchPlayers(session, matchId, teams, allowInProgress) {
  if (session.status !== "active") throw new Error("Resume the session before editing match players.");
  const target = getMatch(session, matchId);
  const expectedStatus = allowInProgress ? "inProgress" : "proposed";
  if (target.status !== expectedStatus) throw new Error(allowInProgress ? "Only in-progress matches can be edited." : "Only queued matches can be edited.");
  const groupSize = session.format === "doubles" ? 4 : 2;
  validateTeams(teams, groupSize);
  const nextIds = teams.flat();
  const previousTargetIds = [...target.playerIds];
  const otherMatches = session.matches.filter((match) => match.id !== target.id && match.status === "proposed");
  const conflicts = [...new Set(nextIds.filter((id) => otherMatches.some((match) => match.playerIds.includes(id))))];
  const inProgressIds = new Set(session.matches.filter((match) => match.status === "inProgress" && match.id !== target.id).flatMap((match) => match.playerIds));
  nextIds.forEach((id) => {
    if (inProgressIds.has(id)) throw new Error(`${getPlayer(session, id).name} is already playing.`);
    if (getPlayer(session, id).status !== "active") throw new Error(`${getPlayer(session, id).name} is not available.`);
  });
  const removedIds = target.playerIds.filter((id) => !nextIds.includes(id));
  if (conflicts.length > removedIds.length) throw new Error("There are not enough outgoing players in this match to exchange with the selected queued players.");
  const exchangeGroups = new Map();
  const usedOutgoing = new Set();
  for (const incomingId of conflicts) {
    const other = otherMatches.find((match) => match.playerIds.includes(incomingId));
    const outgoingId = removedIds.find((id) => !usedOutgoing.has(id));
    if (!outgoingId) throw new Error("A player exchange needs one player to leave this match.");
    if (other.playerIds.includes(outgoingId)) throw new Error("These players already share the same queued match.");
    if (!exchangeGroups.has(other.id)) exchangeGroups.set(other.id, { other, replacements: new Map() });
    const group = exchangeGroups.get(other.id);
    group.replacements.set(incomingId, outgoingId);
    usedOutgoing.add(outgoingId);
  }
  const exchangePlans = [...exchangeGroups.values()].map(({ other, replacements }) => {
    const otherTeams = other.teams.map((team) => team.map((id) => replacements.get(id) ?? id));
    const updatedIds = otherTeams.flat();
    validateTeams(otherTeams, groupSize);
    if (new Set(updatedIds).size !== groupSize) throw new Error("The exchange would duplicate a player in the other match.");
    return {
      other,
      teams: otherTeams,
      replacements: [...replacements].map(([incomingId, outgoingId]) => ({ incomingId, outgoingId }))
    };
  });
  const remainingReserved = new Set(otherMatches.flatMap((match) => match.playerIds));
  nextIds.forEach((id) => {
    if (remainingReserved.has(id) && !conflicts.includes(id)) throw new Error(`${getPlayer(session, id).name} is already reserved.`);
  });
  exchangePlans.forEach(({ other, teams: updatedTeams }) => {
    other.teams = updatedTeams;
    other.playerIds = updatedTeams.flat();
    other.skillAtMatch = Object.fromEntries(other.playerIds.map((id) => [id, getPlayer(session, id).skill]));
    refreshFairness(session, other);
  });
  target.teams = teams.map((team) => [...team]);
  target.playerIds = [...nextIds];
  target.skillAtMatch = Object.fromEntries(nextIds.map((id) => [id, getPlayer(session, id).skill]));
  refreshFairness(session, target);
  const now = Date.now();
  const scheduledIds = new Set(session.matches
    .filter((match) => ["proposed", "inProgress"].includes(match.status))
    .flatMap((match) => match.playerIds));
  nextIds.filter((id) => !previousTargetIds.includes(id)).forEach((id) => {
    const player = getPlayer(session, id);
    if (player.waitSince !== null) {
      player.totalWaitMs = (player.totalWaitMs ?? 0) + Math.max(0, now - player.waitSince);
      player.waitSince = null;
    }
  });
  previousTargetIds.filter((id) => !nextIds.includes(id)).forEach((id) => {
    const player = getPlayer(session, id);
    if (player.status === "active" && !scheduledIds.has(id) && player.waitSince === null) player.waitSince = now;
  });
  return {
    updated: true,
    exchanges: exchangePlans.flatMap(({ other, replacements }) =>
      replacements.map(({ incomingId, outgoingId }) => ({ matchId: other.id, incomingId, outgoingId })))
  };
}

export function matchFairness(session, teams) {
  return evaluateTeams(session, teams);
}

function refreshFairness(session, match) {
  const result = evaluateTeams(session, match.teams);
  match.warning = result.warning;
  match.reason = match.kind === "custom" ? "Custom matchup set by organizer." : result.reason;
}

function validateTeams(teams, groupSize) {
  if (!Array.isArray(teams) || teams.length !== 2 || teams.some((team) => !Array.isArray(team) || team.length !== groupSize / 2)) {
    throw new Error(`This ${groupSize === 4 ? "doubles" : "singles"} match requires ${groupSize} players split evenly between two teams.`);
  }
  const ids = teams.flat();
  if (ids.some((id) => typeof id !== "string" || !id) || new Set(ids).size !== groupSize) {
    throw new Error("Each match must contain distinct players.");
  }
}

function validateScore(session, scoreA, scoreB) {
  if ((typeof scoreA !== "number" && typeof scoreA !== "string") ||
      (typeof scoreB !== "number" && typeof scoreB !== "string") ||
      (typeof scoreA === "string" && !scoreA.trim()) ||
      (typeof scoreB === "string" && !scoreB.trim())) {
    throw new Error("Enter a score for both teams.");
  }
  const pointsA = Number(scoreA);
  const pointsB = Number(scoreB);
  if (!Number.isInteger(pointsA) || !Number.isInteger(pointsB) || pointsA < 0 || pointsB < 0) {
    throw new Error("Enter non-negative whole-number scores for both teams.");
  }
  if (pointsA === pointsB) throw new Error("A completed game cannot end in a tie.");
  const target = Number(session.settings.scoringTo ?? 11);
  const allowDeuce = session.settings.allowDeuce !== false;
  if (!Number.isInteger(target) || target < 1) {
    throw new Error("The session scoring rules are invalid. Set a positive target score.");
  }
  const winnerScore = Math.max(pointsA, pointsB);
  const loserScore = Math.min(pointsA, pointsB);
  if (allowDeuce && (winnerScore < target || winnerScore - loserScore < 2)) {
    throw new Error(`The winning score must reach ${target} points and lead by at least 2.`);
  }
  if (!allowDeuce && (winnerScore !== target || loserScore >= target)) {
    throw new Error(`Without deuce, the winning score must be exactly ${target} and the other team must score less.`);
  }
  return { pointsA, pointsB };
}

function recomputePlayerResults(session) {
  session.players.forEach((player) => {
    player.games = 0;
    player.wins = 0;
    player.losses = 0;
    player.partners = {};
    player.opponents = {};
    player.participation = [];
  });
  session.matches.filter((match) => match.status === "completed").forEach((match) => {
    match.teams.forEach((team, teamIndex) => team.forEach((id) => {
      const player = getPlayer(session, id);
      player.games += 1;
      if (teamIndex === match.winnerTeam) player.wins += 1;
      else player.losses += 1;
      player.participation.push({ matchId: match.id, playedAt: match.completedAt });
      match.playerIds.filter((otherId) => otherId !== id).forEach((otherId) => {
        const field = team.includes(otherId) ? "partners" : "opponents";
        player[field][otherId] = (player[field][otherId] ?? 0) + 1;
      });
    }));
  });
}

function evaluateTeams(session, teams) {
  const ids = teams.flat();
  const candidate = scoreCandidate(ids, teams, session, Date.now());
  return { skillGap: candidate.skillGap, warning: candidate.warning, score: candidate.score, reason: candidate.reason };
}

export function getStatistics(session) {
  const players = session.players.map((player) => ({
    ...player,
    winRate: player.games ? (player.wins / player.games) * 100 : null
  }));
  const completed = session.matches.filter((match) => match.status === "completed");
  const ranked = players.filter((player) => player.games >= session.settings.minimumRankedGames);
  const rankOrder = (a, b) => (b.winRate ?? -1) - (a.winRate ?? -1) || b.games - a.games || b.wins - a.wins || a.name.localeCompare(b.name);
  ranked.sort(rankOrder);
  const officialRankById = new Map(ranked.map((player, index) => [player.id, index + 1]));
  const leaderboard = [...players].sort((a, b) => {
    const aRanked = officialRankById.has(a.id);
    const bRanked = officialRankById.has(b.id);
    if (aRanked !== bRanked) return aRanked ? -1 : 1;
    return rankOrder(a, b);
  }).map((player) => ({ ...player, rank: officialRankById.get(player.id) ?? null }));
  const withGames = players.filter((player) => player.games > 0);
  return {
    players: leaderboard,
    completedGames: completed.length,
    totalWins: completed.length,
    averageGames: players.length ? completed.length * (session.format === "doubles" ? 4 : 2) / players.length : 0,
    highestWinRate: ranked.length ? ranked[0].winRate : null,
    mostActive: [...players].sort((a, b) => b.games - a.games).slice(0, 3),
    insufficient: players.filter((player) => player.games < session.settings.minimumRankedGames),
    playersWithGames: withGames.length
  };
}

export function skillName(value) {
  return SKILLS.find((skill) => skill.value === Number(value))?.label ?? "Unknown";
}

export function getStrategyName(value) {
  return STRATEGY_NAMES[value] ?? STRATEGY_NAMES.fair;
}

function makeCandidates(players, session, now) {
  const size = session.format === "doubles" ? 4 : 2;
  const candidates = [];
  for (const selection of combinations(players, size)) {
    const ids = selection.map((player) => player.id).sort();
    const partitions = size === 2 ? [[ids.slice(0, 1), ids.slice(1)]] : [
      [[ids[0], ids[1]], [ids[2], ids[3]]],
      [[ids[0], ids[2]], [ids[1], ids[3]]],
      [[ids[0], ids[3]], [ids[1], ids[2]]]
    ];
    for (const teams of partitions) {
      const candidate = scoreCandidate(ids, teams, session, now);
      candidates.push(candidate);
    }
  }
  candidates.sort((a, b) => b.score - a.score || a.ids.join(",").localeCompare(b.ids.join(",")) || a.teams.flat().join(",").localeCompare(b.teams.flat().join(",")));
  return candidates;
}

function scoreCandidate(ids, teams, session, now) {
  const byId = new Map(session.players.map((player) => [player.id, player]));
  const players = ids.map((id) => byId.get(id));
  const skills = teams.map((team) => team.reduce((sum, id) => sum + byId.get(id).skill, 0) / team.length);
  const skillGap = Math.abs(skills[0] - skills[1]);
  const withinGap = teams.flatMap((team) => team.length === 2 ? [Math.abs(byId.get(team[0]).skill - byId.get(team[1]).skill)] : [0]).reduce((sum, gap) => sum + gap, 0) / teams.length;
  const performance = teams.map((team) => team.reduce((sum, id) => {
    const player = byId.get(id);
    const smoothedWinRate = (player.wins + 1) / (player.games + 2);
    return sum + player.skill + (smoothedWinRate - 0.5) * 0.8 * session.settings.performanceInfluence;
  }, 0) / team.length);
  const performanceGap = Math.abs(performance[0] - performance[1]);
  const scoreForms = teams.map((team) => teamScoreForm(session, team));
  const scoreContextGap = Math.abs(scoreForms[0] - scoreForms[1]);
  const maxGames = Math.max(1, ...session.players.filter((player) => player.status === "active").map((player) => player.games));
  const participation = average(players.map((player) => 1 - player.games / (maxGames + 1)));
  const waits = players.map((player) => Math.max(0, (now - (player.waitSince ?? now)) / 60000));
  const maxWait = Math.max(1, ...session.players.filter((player) => player.status === "active").map((player) => Math.max(0, (now - (player.waitSince ?? now)) / 60000)));
  const waiting = session.settings.prioritizeWaiting ? average(waits.map((wait) => wait / maxWait)) : 0.5;
  const partnerCount = teams.reduce((sum, team) => sum + (team.length === 2 ? byId.get(team[0]).partners[team[1]] ?? 0 : 0), 0);
  const opponentCount = teams[0].reduce((sum, id) => sum + teams[1].reduce((inner, other) => inner + (byId.get(id).opponents[other] ?? 0), 0), 0);
  const diversity = (counts) => 1 - Math.min(1, counts / Math.max(1, ids.length));
  const dimensions = {
    skill: 1 - Math.min(1, (skillGap * 0.75 + withinGap * 0.25) / 4),
    performance: 1 - Math.min(1, performanceGap / 4),
    scoreContext: 1 - Math.min(1, scoreContextGap / 0.35),
    participation,
    waiting,
    partners: diversity(partnerCount),
    opponents: diversity(opponentCount)
  };
  const weights = { ...STRATEGY_WEIGHTS[session.strategy] };
  if (!session.settings.prioritizeSimilarSkill) weights.skill *= 0.5;
  if (!session.settings.rotatePartners) weights.partners = 0;
  const totalWeight = Object.values(weights).reduce((sum, weight) => sum + weight, 0);
  const score = Object.keys(weights).reduce((sum, key) => sum + dimensions[key] * weights[key], 0) / totalWeight;
  const warning = skillGap > session.settings.maxTeamGap || withinGap > session.settings.maxTeamSkillDifference;
  const reason = buildReason(skillGap, waiting, partnerCount, warning);
  return { ids, teams, score, skillGap, warning, reason };
}

function teamScoreForm(session, team) {
  const signature = [...team].sort().join("|");
  const results = session.matches.filter((match) => {
    if (match.status !== "completed" || !Number.isInteger(match.scoreA) || !Number.isInteger(match.scoreB)) return false;
    return match.teams.some((pastTeam) => [...pastTeam].sort().join("|") === signature);
  });
  if (!results.length) return 0;
  const margin = results.reduce((sum, match) => {
    const teamIndex = match.teams.findIndex((pastTeam) => [...pastTeam].sort().join("|") === signature);
    return sum + (teamIndex === 0 ? match.scoreA - match.scoreB : match.scoreB - match.scoreA);
  }, 0) / results.length;
  return Math.max(-0.35, Math.min(0.35, margin / Math.max(1, Number(session.settings.scoringTo ?? 11)) * 0.1));
}

function chooseSet(candidates, count) {
  const options = candidates.slice(0, 120);
  const greedy = [];
  const greedyUsed = new Set();
  for (const candidate of candidates) {
    if (greedy.length === count) break;
    if (candidate.ids.some((id) => greedyUsed.has(id))) continue;
    candidate.ids.forEach((id) => greedyUsed.add(id));
    greedy.push(candidate);
  }
  let best = greedy;
  let bestScore = greedy.reduce((sum, candidate) => sum + candidate.score, 0);
  let explored = 0;
  const nodeLimit = 30000;
  function search(start, picked, used, score) {
    explored += 1;
    if (explored > nodeLimit) return;
    if (picked.length > best.length || (picked.length === best.length && score > bestScore)) {
      best = [...picked];
      bestScore = score;
    }
    if (picked.length === count) return;
    for (let index = start; index < options.length; index += 1) {
      if (explored > nodeLimit) return;
      const candidate = options[index];
      if (candidate.ids.some((id) => used.has(id))) continue;
      candidate.ids.forEach((id) => used.add(id));
      picked.push(candidate);
      search(index + 1, picked, used, score + candidate.score);
      picked.pop();
      candidate.ids.forEach((id) => used.delete(id));
    }
  }
  search(0, [], new Set(), 0);
  return best;
}

function buildReason(skillGap, waiting, partnerCount, warning) {
  const details = [];
  details.push(skillGap < 0.6 ? "closely matched team strength" : "best available team balance");
  details.push(waiting > 0.65 ? "includes players who have waited longest" : "balances participation");
  if (partnerCount === 0) details.push("new partner combinations");
  const explanation = `Selected for ${details.join(", ")}.`;
  return warning ? `${explanation} Skill balance is outside the preferred range.` : explanation;
}

function* combinations(items, size, start = 0, prefix = []) {
  if (prefix.length === size) {
    yield prefix;
    return;
  }
  for (let index = start; index <= items.length - (size - prefix.length); index += 1) {
    yield* combinations(items, size, index + 1, [...prefix, items[index]]);
  }
}

function getPlayer(session, id) {
  const player = session.players.find((entry) => entry.id === id);
  if (!player) throw new Error("Player not found.");
  return player;
}

function playerNameKey(name) {
  return String(name).normalize("NFKC").trim().toLowerCase();
}

function getMatch(session, id) {
  const match = session.matches.find((entry) => entry.id === id);
  if (!match) throw new Error("Match not found.");
  return match;
}

function average(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function makeId(prefix) {
  return `${prefix}-${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`}`;
}
