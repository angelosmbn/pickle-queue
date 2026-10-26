import test from "node:test";
import assert from "node:assert/strict";
import handler, { parseConfirmedPlayers } from "../api/reclub-import.js";

function eventHtml(code, participants) {
  const nodes = [null];
  const add = (value) => {
    nodes.push(value);
    return nodes.length - 1;
  };
  const participantReferences = [];
  const users = {};

  participants.forEach(({ userId, name, status = 1, tag = "paid", guestName = null }) => {
    const tagReference = add(tag);
    const tagsReference = add([tagReference]);
    const participantReference = add({
      status: add(status),
      tags: tagsReference,
      referenceId: add(userId),
      externalReference: guestName ? add({ name: add(guestName) }) : add(null)
    });
    const profileReference = add({ name: add(name) });
    participantReferences.push(participantReference);
    users[String(userId)] = profileReference;
  });

  const participantListReference = add(["Reactive", add(participantReferences)]);
  const meetReference = add({
    referenceCode: add(code),
    participants: participantListReference
  });
  const eventReference = add({
    meet: add(["Reactive", meetReference]),
    usersMap: add(users)
  });
  const dataReference = add({ [`meet-${code}`]: eventReference });
  const appReference = add({
    data: add(["ShallowReactive", dataReference])
  });
  nodes[0] = ["ShallowReactive", appReference];
  return `<html><script id="__NUXT_DATA__" type="application/json">${JSON.stringify(nodes)}</script></html>`;
}

function responseRecorder() {
  return {
    headers: {},
    statusCode: null,
    payload: null,
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.payload = payload; return this; }
  };
}

function request(eventUrl, { ip = "198.51.100.10", method = "POST" } = {}) {
  return {
    method,
    headers: {
      host: "app.example.com",
      origin: "https://app.example.com",
      "content-type": "application/json",
      "x-forwarded-for": ip
    },
    body: { eventUrl }
  };
}

test("Reclub parser imports confirmed players regardless of payment and excludes nonconfirmed players", () => {
  const html = eventHtml("7E2ZJD", [
    { userId: 1, name: "Paid Confirmed Player", tag: "paid" },
    { userId: 2, name: "Unpaid Confirmed Player", tag: "unpaid" },
    { userId: 3, name: "Waitlisted Player", status: 2, tag: "unpaid" },
    { userId: 4, name: "Cancelled Player", status: -1, tag: "unpaid" }
  ]);

  assert.deepEqual(parseConfirmedPlayers(html, "7E2ZJD"), ["Paid Confirmed Player", "Unpaid Confirmed Player"]);
});

test("Reclub parser uses a plus-one guest name instead of the host name", () => {
  const html = eventHtml("7E2ZJD", [
    { userId: 1, name: "Host Player", guestName: "Sy" },
    { userId: 2, name: "Unpaid Host", guestName: "Guest Name", tag: "unpaid" }
  ]);

  assert.deepEqual(parseConfirmedPlayers(html, "7E2ZJD"), ["Sy", "Guest Name"]);
});

test("Reclub parser reports missing or empty public roster data", () => {
  assert.throws(() => parseConfirmedPlayers("<html></html>", "7E2ZJD"), /did not include public event data/);
  assert.throws(() => parseConfirmedPlayers(eventHtml("7E2ZJD", [{ userId: 1, name: "Waiting", status: 2, tag: "unpaid" }]), "7E2ZJD"), /No confirmed players/);
});

test("Reclub endpoint accepts POST only", async () => {
  const res = responseRecorder();
  await handler(request("https://reclub.co/m/7E2ZJD", { method: "GET" }), res);
  assert.equal(res.statusCode, 405);
  assert.equal(res.headers.Allow, "POST");
});

test("Reclub endpoint rejects non-Reclub and non-event URLs before fetching", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error("fetch must not be called"); };
  try {
    const res = responseRecorder();
    await handler(request("https://example.com/m/7E2ZJD"), res);
    assert.equal(res.statusCode, 400);
    assert.match(res.payload.error, /public Reclub link/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Reclub endpoint fetches a public event and returns only confirmed names", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    assert.equal(url, "https://reclub.co/m/7E2ZJD");
    assert.equal(options.redirect, "manual");
    return new Response(eventHtml("7E2ZJD", [
      { userId: 1, name: "Paid Player" },
      { userId: 2, name: "Unpaid Player", tag: "unpaid" },
      { userId: 3, name: "Waitlisted Player", status: 2, tag: "unpaid" }
    ]), { status: 200, headers: { "content-type": "text/html" } });
  };
  try {
    const res = responseRecorder();
    await handler(request("https://reclub.co/m/7E2ZJD", { ip: "198.51.100.11" }), res);
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.payload, { players: ["Paid Player", "Unpaid Player"] });
  } finally {
    globalThis.fetch = originalFetch;
  }
});
