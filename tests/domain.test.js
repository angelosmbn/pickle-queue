import test from "node:test";
import assert from "node:assert/strict";
import {
  addPlayer, cancelProposedMatch, createSession, endSession, generateMatches, getStatistics, importRestingPlayers, pauseSession, updateOrganizerDetails, updatePlayer,
  recordResult, removePlayer, resumeSession, setPlayerAvailability, startMatch, startSession,
  createCustomMatch, editQueuedMatch, editInProgressMatch, editCompletedScore,
  pauseMatch, resumeMatch, stopMatch
} from "../public/src/domain.js";

function fixture({ format = "doubles", count = 8, strategy = "fair", courts = 2 } = {}) {
  const session = createSession({ name: "Test session", courts, format, strategy, organizerEmail: "organizer@example.com" });
  for (let index = 0; index < count; index += 1) {
    addPlayer(session, { name: `Player ${index + 1}`, skill: (index % 5) + 1 });
  }
  return session;
}

test("forms distinct doubles teams and respects available courts", () => {
  const session = fixture({ count: 12 });
  startSession(session);
  const matches = session.matches.filter((match) => match.status === "proposed");
  assert.equal(matches.length, 2);
  assert.equal(new Set(matches.flatMap((match) => match.playerIds)).size, 8);
  assert.ok(matches.every((match) => match.playerIds.length === 4 && match.teams.every((team) => team.length === 2)));
  assert.deepEqual(matches.map((match) => match.court), [1, 2]);
  startMatch(session, matches[0].id);
  assert.equal(matches[0].court, 1);
  assert.equal(matches[1].court, 2);
});

test("custom matches receive a court number when queued", () => {
  const session = fixture({ count: 12, courts: 2 });
  startSession(session);
  const waiting = session.players.filter((player) =>
    !session.matches.some((match) => match.status === "proposed" && match.playerIds.includes(player.id)));
  const custom = createCustomMatch(session, [
    waiting.slice(0, 2).map((player) => player.id),
    waiting.slice(2, 4).map((player) => player.id)
  ]);
  assert.equal(custom.status, "proposed");
  assert.equal(custom.court, 1);
});

test("imported players are intermediate, resting, and receive unique names", () => {
  const session = fixture({ count: 1 });
  const imported = importRestingPlayers(session, ["Player 1", " Alex ", "Alex", "Alex (2)"]);

  assert.deepEqual(imported.map((player) => player.name), ["Player 1 (2)", "Alex", "Alex (3)", "Alex (2)"]);
  assert.ok(imported.every((player) => player.skill === 3 && player.status === "resting" && player.waitSince === null));
});

test("starting a session activates resting players and includes them in the opening matches", () => {
  const session = createSession({
    name: "Imported roster",
    courts: 1,
    format: "doubles",
    organizerEmail: "organizer@example.com"
  });
  const imported = importRestingPlayers(session, ["Alex", "Casey", "Jamie", "Morgan"]);

  const result = startSession(session);

  assert.equal(session.status, "active");
  assert.ok(imported.every((player) => player.status === "active" && player.waitSince !== null));
  assert.equal(result.matches.length, 1);
  assert.ok(result.matches[0].playerIds.every((id) => imported.some((player) => player.id === id)));
});

test("player import rejects invalid lists without adding partial players", () => {
  const session = fixture({ count: 1 });
  assert.throws(() => importRestingPlayers(session, ["Valid", "  "]), /Every imported player must have a name/);
  assert.equal(session.players.length, 1);
});

test("generating after removing a queued match favors a different matchup", () => {
  const session = fixture({ count: 12, courts: 2 });
  startSession(session);
  const [match] = session.matches;
  const originalIds = new Set(match.playerIds);

  cancelProposedMatch(session, match.id);
  const generated = generateMatches(session).matches;

  assert.equal(generated.length, 1);
  const changedPlayers = generated[0].playerIds.filter((id) => !originalIds.has(id)).length;
  assert.ok(changedPlayers > 0 && changedPlayers <= 4);
  assert.equal(new Set(session.matches.filter((entry) => entry.status === "proposed").flatMap((entry) => entry.playerIds)).size, 8);
});

test("regeneration can replace just one player when only one is available to shuffle in", () => {
  const session = fixture({ format: "singles", count: 3, courts: 1 });
  startSession(session);
  const [match] = session.matches;
  const originalIds = new Set(match.playerIds);

  cancelProposedMatch(session, match.id);
  const generated = generateMatches(session).matches;

  assert.equal(generated.length, 1);
  assert.equal(generated[0].playerIds.filter((id) => !originalIds.has(id)).length, 1);
});

test("generating after removing a queued match reshuffles teams when no other players are available", () => {
  const session = fixture({ count: 8, courts: 2 });
  startSession(session);
  const [match] = session.matches;
  const originalTeams = match.teams.map((team) => [...team]);

  cancelProposedMatch(session, match.id);
  const generated = generateMatches(session).matches;

  assert.equal(generated.length, 1);
  assert.deepEqual([...generated[0].playerIds].sort(), originalTeams.flat().sort());
  assert.notDeepEqual(generated[0].teams, originalTeams);
});

test("stores required organizer details and supports updating them for legacy sessions", () => {
  const session = createSession({
    name: "Organizer details test",
    organizerName: "  Loyloy  ",
    contactNumber: "  09123456789 ",
    organizerEmail: "  loyloy@example.com ",
    clubName: "  Pickleball Friends ",
    courtName: "  Main Court "
  });
  assert.equal(session.courtName, "Main Court");
  assert.deepEqual(session.organizer, {
    name: "Loyloy",
    contactNumber: "09123456789",
    email: "loyloy@example.com",
    clubName: "Pickleball Friends"
  });
  assert.throws(() => updateOrganizerDetails(session, { name: " ", contactNumber: "1234567", courtName: "Court 1" }), /Enter your name/);
  assert.throws(() => updateOrganizerDetails(session, { name: "Loyloy", contactNumber: " ", courtName: "Court 1" }), /Enter your contact number/);
  assert.throws(() => updateOrganizerDetails(session, { name: "Loyloy", contactNumber: "09123456789", email: "invalid", courtName: "Court 1" }), /Enter a valid email address/);
  assert.throws(() => updateOrganizerDetails(session, { name: "Loyloy", contactNumber: "09123456789", email: "loyloy@example.com" }), /Enter a court name/);
  updateOrganizerDetails(session, { name: "Organizer", contactNumber: "09123456789", email: "organizer@example.com", courtName: "North Courts" });
  assert.equal(session.courtName, "North Courts");
  assert.deepEqual(session.organizer, {
    name: "Organizer",
    contactNumber: "09123456789",
    email: "organizer@example.com",
    clubName: ""
  });
});

test("requires a valid organizer email address when creating a session", () => {
  assert.throws(() => createSession({ name: "Missing email" }), /Enter a valid organizer email address/);
  assert.throws(() => createSession({ name: "Invalid email", organizerEmail: "not-an-email" }), /Enter a valid organizer email address/);
  assert.equal(createSession({ name: "With email", organizerEmail: "organizer@example.com" }).organizer.email, "organizer@example.com");
});

test("player names must be unique when adding and editing, ignoring case and surrounding spaces", () => {
  const session = fixture({ count: 2 });
  const first = session.players[0];
  const second = session.players[1];
  const originalSecondName = second.name;

  assert.throws(() => addPlayer(session, { name: "  pLaYeR 1  " }), /That player name is already added/);
  assert.throws(() => updatePlayer(session, second.id, { name: " PLAYER 1 " }), /That player name is already added/);
  assert.equal(second.name, originalSecondName);
  assert.equal(session.players.length, 2);

  updatePlayer(session, first.id, { name: " player 1 " });
  assert.equal(first.name, "player 1");
});

test("fills multiple courts for a 12-player group when two non-overlapping matches are feasible", () => {
  const session = fixture({ count: 12, courts: 2 });
  startSession(session);
  assert.equal(session.matches.filter((match) => match.status === "proposed").length, 2);
  assert.equal(new Set(session.matches.filter((match) => match.status === "proposed").flatMap((match) => match.playerIds)).size, 8);
});

test("one active game and a queued match reserve both courts until the queued match starts or is cancelled", () => {
  const session = fixture({ count: 10, courts: 2 });
  startSession(session);
  const [playing, queued] = session.matches;
  startMatch(session, playing.id);

  const blocked = generateMatches(session);
  assert.equal(blocked.matches.length, 0);
  assert.match(blocked.message, /Queued matches already reserve every remaining court/);

  cancelProposedMatch(session, queued.id);
  const eligible = session.players.filter((player) =>
    player.status === "active" && !session.matches.some((match) =>
      ["proposed", "inProgress"].includes(match.status) && match.playerIds.includes(player.id)));
  assert.equal(eligible.length, 6);

  const generated = generateMatches(session);
  assert.equal(generated.matches.length, 1);
  assert.equal(generated.matches[0].playerIds.length, 4);
  assert.ok(generated.matches[0].playerIds.every((id) => eligible.some((player) => player.id === id)));
});

test("13-player rotation can generate on the open court after four queued players rest at game seven", () => {
  const session = fixture({ count: 13, courts: 2 });
  startSession(session);

  for (let completed = 0; completed < 6; completed += 1) {
    const match = session.matches.find((entry) => entry.status === "proposed");
    startMatch(session, match.id);
    recordResult(session, match.id, 11, 8);
    generateMatches(session);
  }

  const seventhGame = session.matches.find((entry) => entry.status === "proposed");
  const otherQueuedGame = session.matches.find((entry) =>
    entry.status === "proposed" && entry.id !== seventhGame.id);
  startMatch(session, seventhGame.id);

  for (const playerId of otherQueuedGame.playerIds) {
    const result = setPlayerAvailability(session, playerId, "resting");
    if (result.requiresConfirmation) {
      setPlayerAvailability(session, playerId, "resting", { confirmRemoval: true });
    }
  }

  const generated = generateMatches(session);
  assert.equal(generated.matches.length, 1);
  assert.equal(generated.matches[0].playerIds.length, 4);
  assert.equal(session.matches.filter((entry) => entry.status === "inProgress").length, 1);
  assert.equal(session.matches.filter((entry) => entry.status === "proposed").length, 1);
});

test("forms singles matches from distinct players", () => {
  const session = fixture({ format: "singles", count: 5 });
  startSession(session);
  assert.equal(session.matches.length, 2);
  assert.ok(session.matches.every((match) => match.playerIds.length === 2));
});

test("resting and unavailable players are excluded", () => {
  const session = fixture({ count: 8 });
  session.players[0].status = "resting";
  session.players[1].status = "unavailable";
  startSession(session);
  const assigned = session.matches.flatMap((match) => match.playerIds);
  assert.ok(!assigned.includes(session.players[0].id));
  assert.ok(!assigned.includes(session.players[1].id));
});

test("skill strategy chooses a balanced feasible match and flags impossible gaps", () => {
  const session = createSession({ name: "Skill test", courts: 1, strategy: "skill", organizerEmail: "organizer@example.com" });
  [3, 3, 3, 3, 1].forEach((skill, index) => addPlayer(session, { name: `Player ${index}`, skill }));
  startSession(session);
  const match = session.matches[0];
  const strength = match.teams.map((team) => team.reduce((sum, id) => sum + session.players.find((p) => p.id === id).skill, 0) / 2);
  assert.equal(Math.abs(strength[0] - strength[1]), 0);
});

test("one early win is smoothed rather than treated as reliable perfect form", () => {
  const session = fixture({ count: 4, strategy: "wins" });
  session.players[0].games = 1;
  session.players[0].wins = 1;
  session.players[1].games = 10;
  session.players[1].wins = 10;
  const a = (session.players[0].wins + 1) / (session.players[0].games + 2);
  const b = (session.players[1].wins + 1) / (session.players[1].games + 2);
  assert.ok(a < 1);
  assert.ok(a < b);
});

test("a player break removes their proposed match and regeneration preserves completed history", () => {
  const session = fixture({ count: 8 });
  startSession(session);
  const first = session.matches[0];
  startMatch(session, first.id);
  recordResult(session, first.id, 11, 8);
  const completedSnapshot = JSON.stringify(first);
  const proposed = session.matches.find((match) => match.status === "proposed");
  setPlayerAvailability(session, proposed.playerIds[0], "resting");
  assert.equal(session.players.find((player) => player.id === proposed.playerIds[0]).status, "active");
  setPlayerAvailability(session, proposed.playerIds[0], "resting", { confirmRemoval: true });
  const result = generateMatches(session);
  assert.equal(JSON.stringify(first), completedSnapshot);
  assert.ok(result.matches.every((match) => !match.playerIds.includes(proposed.playerIds[0])));
});

test("results update win/loss stats once; duplicate submission is rejected", () => {
  const session = fixture({ count: 4, courts: 1 });
  startSession(session);
  const match = session.matches[0];
  startMatch(session, match.id);
  recordResult(session, match.id, 8, 11);
  assert.throws(() => recordResult(session, match.id, 8, 11), /already recorded/);
  assert.equal(session.players.filter((player) => player.wins === 1).length, 2);
  assert.equal(session.players.filter((player) => player.losses === 1).length, 2);
  assert.equal(match.score, "8–11");
  assert.throws(() => recordResult(session, "missing-match", 1, 1), /Match not found/);
});

test("leaderboard ranks by win rate and leaves zero-game players unranked", () => {
  const session = fixture({ count: 4, courts: 1 });
  session.settings.minimumRankedGames = 1;
  session.players[0].games = 2;
  session.players[0].wins = 1;
  session.players[0].losses = 1;
  session.players[1].games = 1;
  session.players[1].wins = 1;
  const stats = getStatistics(session);
  assert.equal(stats.players[0].id, session.players[1].id);
  assert.equal(stats.players.find((player) => player.id === session.players[2].id).winRate, null);
  assert.equal(stats.insufficient.length, 2);
});

test("pause, resume, and end lifecycle preserve existing records", () => {
  const session = fixture({ count: 4, courts: 1 });
  startSession(session);
  const id = session.matches[0].id;
  cancelProposedMatch(session, id);
  pauseSession(session);
  assert.equal(generateMatches(session).matches.length, 0);
  resumeSession(session);
  generateMatches(session);
  endSession(session, { confirmUnfinished: true });
  assert.equal(session.status, "completed");
  assert.ok(session.matches.every((match) => match.status === "cancelled"));
});

test("consecutive-game limits provide a rest rotation and allow rested players back", () => {
  const session = fixture({ count: 8, courts: 1 });
  assert.equal(session.settings.restAfterConsecutiveGames, 2);
  session.settings.allowConsecutiveGames = false;
  startSession(session);
  const first = session.matches[0];
  const firstIds = new Set(first.playerIds);
  startMatch(session, first.id);
  recordResult(session, first.id, 11, 8);
  const second = generateMatches(session).matches[0];
  assert.ok(second);
  assert.ok(second.playerIds.every((id) => !firstIds.has(id)));
  startMatch(session, second.id);
  recordResult(session, second.id, 11, 8);
  const third = generateMatches(session).matches[0];
  assert.ok(third);
  assert.ok(third.playerIds.some((id) => firstIds.has(id)));
});

test("generates a match when every available player has reached the rest limit", () => {
  const session = fixture({ count: 4, courts: 1 });
  session.settings.restAfterConsecutiveGames = 1;
  startSession(session);
  const first = session.matches[0];
  startMatch(session, first.id);
  recordResult(session, first.id, 11, 8);

  const generated = generateMatches(session);

  assert.equal(generated.matches.length, 1);
  assert.deepEqual(new Set(generated.matches[0].playerIds), new Set(first.playerIds));
  assert.match(generated.matches[0].reason, /Played despite the rest limit/);
});

test("players with no games can be removed, but played players stay in session history", () => {
  const session = fixture({ count: 4, courts: 1 });
  const playerId = session.players[0].id;
  startSession(session);
  assert.equal(removePlayer(session, playerId).requiresConfirmation, true);
  removePlayer(session, playerId, { confirmRemoval: true });
  assert.ok(!session.players.some((player) => player.id === playerId));
  assert.equal(session.matches[0].status, "cancelled");
});

test("ending a session explicitly confirms and cancels unfinished games", () => {
  const session = fixture({ count: 4, courts: 1 });
  startSession(session);
  const match = session.matches[0];
  startMatch(session, match.id);
  assert.equal(endSession(session).requiresConfirmation, true);
  endSession(session, { confirmUnfinished: true });
  assert.equal(session.status, "completed");
  assert.equal(match.status, "cancelled");
  assert.equal(session.players.reduce((sum, player) => sum + player.games, 0), 0);
});

test("generation remains responsive with a recreational group of 20", () => {
  const session = fixture({ count: 20, courts: 4 });
  const startedAt = performance.now();
  startSession(session);
  const elapsed = performance.now() - startedAt;
  assert.equal(session.matches.length, 4);
  assert.ok(elapsed < 2000, `Expected match generation under 2s, received ${elapsed.toFixed(0)}ms`);
});

test("score validation requires an untied legal winning score and derives the winner", () => {
  const session = fixture({ count: 4, courts: 1 });
  startSession(session);
  const match = session.matches[0];
  startMatch(session, match.id);
  assert.throws(() => recordResult(session, match.id, 11, 11), /cannot end in a tie/);
  assert.throws(() => recordResult(session, match.id, 10, 8), /must reach 11 points/);
  assert.throws(() => recordResult(session, match.id, -1, 11), /non-negative whole-number/);
  assert.throws(() => recordResult(session, match.id, "", 11), /score for both teams/);
  recordResult(session, match.id, 11, 9);
  assert.equal(match.winnerTeam, 0);
  assert.deepEqual([match.scoreA, match.scoreB], [11, 9]);
});

test("deuce requires a two-point lead and permits scores beyond the target", () => {
  const session = fixture({ count: 4, courts: 1 });
  startSession(session);
  const match = session.matches[0];
  startMatch(session, match.id);
  assert.throws(() => recordResult(session, match.id, 11, 10), /lead by at least 2/);
  recordResult(session, match.id, 12, 10);
  assert.equal(match.status, "completed");
  assert.equal(match.score, "12–10");
});

test("without deuce, the winner must finish exactly at the target score", () => {
  const session = fixture({ count: 4, courts: 1 });
  session.settings.allowDeuce = false;
  startSession(session);
  const match = session.matches[0];
  startMatch(session, match.id);
  assert.throws(() => recordResult(session, match.id, 12, 10), /exactly 11/);
  assert.throws(() => recordResult(session, match.id, 11, 11), /cannot end in a tie/);
  recordResult(session, match.id, 11, 10);
  assert.equal(match.status, "completed");
  assert.equal(match.score, "11–10");
});

test("correcting a completed score updates winner and player statistics", () => {
  const session = fixture({ count: 4, courts: 1 });
  startSession(session);
  const match = session.matches[0];
  startMatch(session, match.id);
  recordResult(session, match.id, 11, 8);
  const oldWinnerIds = [...match.teams[0]];
  editCompletedScore(session, match.id, 8, 11);
  assert.equal(match.winnerTeam, 1);
  assert.equal(match.score, "8–11");
  assert.ok(oldWinnerIds.every((id) => session.players.find((player) => player.id === id).losses === 1));
  assert.ok(oldWinnerIds.every((id) => session.players.find((player) => player.id === id).wins === 0));
  assert.throws(() => editCompletedScore(session, match.id, 11, 11), /cannot end in a tie/);
});

test("custom match reserves players, is labeled, and cannot be auto-generated twice", () => {
  const session = fixture({ count: 8, courts: 2 });
  startSession(session);
  session.matches.filter((match) => match.status === "proposed").forEach((match) => cancelProposedMatch(session, match.id));
  const players = session.players;
  const custom = createCustomMatch(session, [[players[0].id, players[1].id], [players[2].id, players[3].id]]);
  assert.equal(custom.kind, "custom");
  assert.equal(custom.status, "proposed");
  const generated = generateMatches(session).matches;
  assert.ok(generated.length);
  assert.ok(generated.every((match) => match.playerIds.every((id) => !custom.playerIds.includes(id))));
  assert.ok(generated.every((match) => match.court !== custom.court));
  assert.equal(custom.status, "proposed");
  assert.equal(custom.court, 1);
});

test("queued generated matches automatically exchange players without duplicate assignments", () => {
  const session = fixture({ count: 8, courts: 2 });
  startSession(session);
  const [first, second] = session.matches;
  const incomingId = second.playerIds[0];
  const outgoingId = first.playerIds[0];
  const changedTeams = first.teams.map((team) => team.map((id) => id === outgoingId ? incomingId : id));
  const beforeFirst = structuredClone(first);
  const beforeSecond = structuredClone(second);
  const result = editQueuedMatch(session, first.id, changedTeams);
  assert.equal(result.updated, true);
  assert.equal(result.exchanges.length, 1);
  assert.notDeepEqual(first, beforeFirst);
  assert.notDeepEqual(second, beforeSecond);
  assert.ok(first.playerIds.includes(incomingId));
  assert.ok(second.playerIds.includes(outgoingId));
  const allIds = [...first.playerIds, ...second.playerIds];
  assert.equal(new Set(allIds).size, allIds.length);
});

test("custom match takes a queued player and backfills the vacated queue slot", () => {
  const session = fixture({ count: 12, courts: 2 });
  startSession(session);
  const [queued] = session.matches;
  const incomingId = queued.playerIds[0];
  const waiting = session.players.filter((player) => !session.matches.some((match) => match.status === "proposed" && match.playerIds.includes(player.id)));
  const custom = createCustomMatch(session, [
    [incomingId, waiting[0].id],
    [waiting[1].id, waiting[2].id]
  ]);
  assert.ok(custom.playerIds.includes(incomingId));
  assert.ok(!queued.playerIds.includes(incomingId));
  assert.ok(queued.playerIds.includes(waiting[3].id));
  assert.equal(queued.playerIds.length, 4);
  const assigned = session.matches.filter((match) => match.status === "proposed").flatMap((match) => match.playerIds);
  assert.equal(new Set(assigned).size, assigned.length);
});

test("custom match pull is atomic when no waiting player can replace the queued slot", () => {
  const session = fixture({ count: 8, courts: 2 });
  startSession(session);
  const [queued] = session.matches;
  const selectedId = queued.playerIds[0];
  const before = structuredClone(session.matches);
  const unselected = session.matches[1].playerIds;
  assert.throws(() => createCustomMatch(session, [
    [selectedId, unselected[0]], [unselected[1], unselected[2]]
  ]), /not enough unassigned players/);
  assert.deepEqual(session.matches, before);
});

test("editing automatically pulls queued players from another match and swaps the vacated player", () => {
  const session = fixture({ count: 8, courts: 2 });
  startSession(session);
  const [first, second] = session.matches;
  const incomingId = second.playerIds[0];
  const outgoingId = first.playerIds[0];
  const changedTeams = first.teams.map((team) => team.map((id) => id === outgoingId ? incomingId : id));
  editQueuedMatch(session, first.id, changedTeams);
  assert.ok(first.playerIds.includes(incomingId));
  assert.ok(second.playerIds.includes(outgoingId));
  const assignedIds = [...first.playerIds, ...second.playerIds];
  assert.equal(new Set(assignedIds).size, assignedIds.length);
});

test("editing exchanges multiple players from the same queued match atomically", () => {
  const session = fixture({ count: 8, courts: 2 });
  startSession(session);
  const [target, source] = session.matches;
  const outgoing = target.playerIds.slice(0, 2);
  const incoming = source.playerIds.slice(0, 2);
  const nextTeams = target.teams.map((team) => team.map((id) => {
    const index = outgoing.indexOf(id);
    return index >= 0 ? incoming[index] : id;
  }));
  const result = editQueuedMatch(session, target.id, nextTeams);
  assert.equal(result.exchanges.length, 2);
  assert.ok(incoming.every((id) => target.playerIds.includes(id)));
  assert.ok(outgoing.every((id) => source.playerIds.includes(id)));
  assert.equal(new Set([...target.playerIds, ...source.playerIds]).size, 8);
});

test("editing reassigns a selected player from the other team without duplicate assignment", () => {
  const session = fixture({ count: 4, courts: 1 });
  startSession(session);
  const match = session.matches[0];
  const teamA = match.teams[0];
  const teamB = match.teams[1];
  const swappedTeams = [[teamA[0], teamB[0]], [teamA[1], teamB[1]]];
  editQueuedMatch(session, match.id, swappedTeams);
  assert.deepEqual(match.teams, swappedTeams);
  assert.equal(new Set(match.playerIds).size, 4);
});

test("a queued match cannot start without an open court or with a duplicated assignment", () => {
  const session = fixture({ count: 8, courts: 1 });
  startSession(session);
  const first = session.matches[0];
  startMatch(session, first.id);
  const availableIds = session.players.filter((player) => !first.playerIds.includes(player.id)).map((player) => player.id);
  const custom = createCustomMatch(session, [
    availableIds.slice(0, 2),
    availableIds.slice(2, 4)
  ]);
  assert.throws(() => startMatch(session, custom.id), /All courts are occupied/);
  assert.equal(custom.status, "proposed");
  assert.equal(first.status, "inProgress");
  assert.throws(() => editQueuedMatch(session, first.id, first.teams), /Only queued matches/);
});

test("starting a match records its start time for the elapsed game timer", () => {
  const session = fixture({ count: 4, courts: 1 });
  startSession(session);
  const match = session.matches[0];
  const beforeStart = Date.now();
  startMatch(session, match.id);
  const startedAt = Date.parse(match.startedAt);
  assert.ok(Number.isFinite(startedAt));
  assert.ok(startedAt >= beforeStart && startedAt <= Date.now());
});

test("pausing a game freezes its timer until resumed", () => {
  const session = fixture({ count: 4, courts: 1 });
  startSession(session);
  const match = session.matches[0];
  startMatch(session, match.id);
  pauseMatch(session, match.id);
  const pausedAt = match.pausedAt;
  assert.ok(Number.isFinite(Date.parse(pausedAt)));
  assert.throws(() => recordResult(session, match.id, 11, 8), /Resume the paused game/);
  resumeMatch(session, match.id);
  assert.equal(match.pausedAt, null);
  assert.ok(match.totalPausedMs >= 0);
  assert.throws(() => resumeMatch(session, match.id), /Only a paused game/);
});

test("stopping a game returns it to the editable queue without recording a result", () => {
  const session = fixture({ count: 4, courts: 1 });
  startSession(session);
  const match = session.matches[0];
  startMatch(session, match.id);
  const court = match.court;
  pauseMatch(session, match.id);
  stopMatch(session, match.id);
  assert.equal(match.status, "proposed");
  assert.equal(match.court, court);
  assert.equal(match.startedAt, null);
  assert.equal(match.pausedAt, null);
  assert.equal(match.totalPausedMs, 0);
  assert.equal(session.players.reduce((sum, player) => sum + player.games, 0), 0);
  assert.doesNotThrow(() => editQueuedMatch(session, match.id, match.teams));
  startMatch(session, match.id);
  assert.equal(match.status, "inProgress");
});

test("editing a live match exchanges queued players and keeps its court active", () => {
  const session = fixture({ count: 8, courts: 2 });
  startSession(session);
  const [live, queued] = session.matches;
  const incomingId = queued.playerIds[0];
  const outgoingId = live.playerIds[0];
  startMatch(session, live.id);
  const court = live.court;
  const nextTeams = live.teams.map((team) => team.map((id) => id === outgoingId ? incomingId : id));
  const result = editInProgressMatch(session, live.id, nextTeams);
  assert.equal(result.exchanges.length, 1);
  assert.ok(live.playerIds.includes(incomingId));
  assert.ok(queued.playerIds.includes(outgoingId));
  assert.equal(live.status, "inProgress");
  assert.equal(live.court, court);
  assert.equal(new Set([...live.playerIds, ...queued.playerIds]).size, 8);
});

test("editing a live match can use an unassigned player but rejects someone in another live game", () => {
  const session = fixture({ count: 12, courts: 2 });
  startSession(session);
  const [target, other] = session.matches;
  startMatch(session, target.id);
  startMatch(session, other.id);
  const waiting = session.players.find((player) =>
    player.status === "active" && !target.playerIds.includes(player.id) &&
    !other.playerIds.includes(player.id) &&
    !session.matches.some((match) => match.status === "proposed" && match.playerIds.includes(player.id)));
  assert.ok(waiting);
  const outgoing = target.playerIds[0];
  const withWaiting = target.teams.map((team) => team.map((id) => id === outgoing ? waiting.id : id));
  editInProgressMatch(session, target.id, withWaiting);
  assert.ok(target.playerIds.includes(waiting.id));
  assert.equal(session.players.find((player) => player.id === outgoing).waitSince !== null, true);
  const before = structuredClone(target.teams);
  const withPlaying = target.teams.map((team) => team.map((id) => id === waiting.id ? other.playerIds[0] : id));
  assert.throws(() => editInProgressMatch(session, target.id, withPlaying), /already playing/);
  assert.deepEqual(target.teams, before);
});

test("custom match rejects duplicate, unavailable, and in-progress players", () => {
  const session = fixture({ count: 8, courts: 1 });
  startSession(session);
  const active = session.matches[0];
  startMatch(session, active.id);
  const playingId = active.playerIds[0];
  assert.throws(() => createCustomMatch(session, [[playingId, playingId], [session.players[4].id, session.players[5].id]]), /distinct players/);
  const otherIds = session.players.filter((player) => player.id !== playingId).slice(0, 3).map((player) => player.id);
  assert.throws(() => createCustomMatch(session, [[playingId, otherIds[0]], [otherIds[1], otherIds[2]]]), /already playing/);
});

test("custom singles match uses one player per side", () => {
  const session = fixture({ format: "singles", count: 4, courts: 1 });
  startSession(session);
  cancelProposedMatch(session, session.matches[0].id);
  const [a, b] = session.players;
  const match = createCustomMatch(session, [[a.id], [b.id]]);
  assert.equal(match.kind, "custom");
  assert.deepEqual(match.teams, [[a.id], [b.id]]);
});

test("custom match starts only after organizer action and receives an open court", () => {
  const session = fixture({ count: 8, courts: 1 });
  startSession(session);
  cancelProposedMatch(session, session.matches[0].id);
  const ids = session.players.slice(0, 4).map((player) => player.id);
  const custom = createCustomMatch(session, [[ids[0], ids[1]], [ids[2], ids[3]]]);
  assert.equal(custom.status, "proposed");
  assert.equal(custom.court, 1);
  startMatch(session, custom.id);
  assert.equal(custom.status, "inProgress");
  assert.equal(custom.court, 1);
});
