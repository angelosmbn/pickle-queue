import test from "node:test";
import assert from "node:assert/strict";
import nodemailer from "nodemailer";
import handler, { buildReportHtml, buildThankYouHtml } from "../api/send-report.js";

test("HTML report email renders a formatted summary and escapes user-provided content", () => {
  const html = buildReportHtml("ended", "Club <script>", [
    "Gear Up Rally — Session ended",
    "",
    "Organizer: Alex & Sam",
    "Contact number: 123456789",
    "Club: Sample club",
    "Court / venue: Court 1",
    "Session: Finals",
    "Date: Today",
    "Format: Doubles",
    "Courts: 2",
    "Queue strategy: Balanced",
    "Status: Completed",
    "Completed games: 3",
    "Players: 4",
    "",
    "Player statistics:",
    "- Casey <b>Player</b>: 2 games, 1 wins, 1 losses, 50% win rate",
    "",
    "Match history:",
    "- Game 1 · Completed · Court 1: Casey + Alex vs Sam + Jo (11–8)",
    "",
    "Organizer feedback:",
    "Rating: 5/5 stars",
    "Great session!"
  ].join("\n"));

  assert.match(html, /Session complete/);
  assert.match(html, /Session details/);
  assert.match(html, /Player statistics/);
  assert.match(html, /Match history/);
  assert.match(html, /Organizer feedback/);
  assert.match(html, /Session rating/);
  assert.match(html, /5 \/ 5/);
  assert.match(html, /★★★★★/);
  assert.match(html, /<th[^>]*>Games<\/th>/);
  assert.match(html, /<th[^>]*>Win rate<\/th>/);
  assert.match(html, /<th[^>]*>Matchup \/ score<\/th>/);
  assert.match(html, /Club &lt;script&gt;/);
  assert.match(html, /Alex &amp; Sam/);
  assert.match(html, /<th[^>]*>Organizer<\/th><td[^>]*>Alex &amp; Sam<\/td>/);
  assert.match(html, /Casey &lt;b&gt;Player&lt;\/b&gt;/);
  assert.doesNotMatch(html, /<script>|<b>Player<\/b>/);
});

test("thank-you email is personalized, polished, and escapes user content", () => {
  const html = buildThankYouHtml("Alex <b>Player</b>", "Saturday & Friends");
  assert.match(html, /Thanks for playing!/);
  assert.match(html, /Alex &lt;b&gt;Player&lt;\/b&gt;/);
  assert.match(html, /Saturday &amp; Friends/);
  assert.doesNotMatch(html, /<b>Player<\/b>/);
});

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

test("report endpoint allows POST only", async () => {
  const res = responseRecorder();
  await handler({ method: "GET", headers: {} }, res);
  assert.equal(res.statusCode, 405);
  assert.equal(res.headers.Allow, "POST");
});

test("report endpoint validates report data without requiring an access code", async () => {
  const original = { ...process.env };
  process.env.GMAIL_USER = "sender@gmail.com";
  process.env.GMAIL_APP_PASSWORD = "not-a-real-password";
  process.env.REPORT_TO_EMAIL = "recipient@example.com";
  try {
    const res = responseRecorder();
    await handler({
      method: "POST",
      headers: { host: "app.example.com", origin: "https://app.example.com", "content-type": "application/json" },
      body: { reportType: "invalid", sessionName: "Test", report: "Test" }
    }, res);
    assert.equal(res.statusCode, 400);
    assert.deepEqual(res.payload, { error: "The session report is incomplete or too large." });
  } finally {
    for (const key of ["GMAIL_USER", "GMAIL_APP_PASSWORD", "REPORT_TO_EMAIL"]) {
      if (original[key] === undefined) delete process.env[key];
      else process.env[key] = original[key];
    }
  }
});

test("report endpoint rejects cross-origin browser requests", async () => {
  const original = { ...process.env };
  process.env.GMAIL_USER = "sender@gmail.com";
  process.env.GMAIL_APP_PASSWORD = "not-a-real-password";
  process.env.REPORT_TO_EMAIL = "recipient@example.com";
  try {
    const res = responseRecorder();
    await handler({
      method: "POST",
      headers: { host: "app.example.com", origin: "https://other.example.com", "content-type": "application/json" },
      body: { reportType: "started", sessionName: "Test", report: "Test" }
    }, res);
    assert.equal(res.statusCode, 403);
  } finally {
    for (const key of ["GMAIL_USER", "GMAIL_APP_PASSWORD", "REPORT_TO_EMAIL"]) {
      if (original[key] === undefined) delete process.env[key];
      else process.env[key] = original[key];
    }
  }
});

test("ended report requires a valid organizer email before delivery", async () => {
  const original = { ...process.env };
  process.env.GMAIL_USER = "sender@gmail.com";
  process.env.GMAIL_APP_PASSWORD = "not-a-real-password";
  process.env.REPORT_TO_EMAIL = "recipient@example.com";
  try {
    const res = responseRecorder();
    await handler({
      method: "POST",
      headers: { host: "app.example.com", origin: "https://app.example.com", "content-type": "application/json" },
      body: {
        reportType: "ended",
        sessionName: "Test",
        report: "Session ended",
        organizerName: "Organizer",
        organizerEmail: "invalid"
      }
    }, res);
    assert.equal(res.statusCode, 400);
    assert.deepEqual(res.payload, { error: "The session report is incomplete or too large." });
  } finally {
    for (const key of ["GMAIL_USER", "GMAIL_APP_PASSWORD", "REPORT_TO_EMAIL"]) {
      if (original[key] === undefined) delete process.env[key];
      else process.env[key] = original[key];
    }
  }
});

test("ended report sends the final report and a thank-you to the organizer", async () => {
  const originalEnv = { ...process.env };
  const originalCreateTransport = nodemailer.createTransport;
  const messages = [];
  process.env.GMAIL_USER = "sender@gmail.com";
  process.env.GMAIL_APP_PASSWORD = "not-a-real-password";
  process.env.REPORT_TO_EMAIL = "reports@example.com";
  nodemailer.createTransport = () => ({
    sendMail: async (message) => { messages.push(message); }
  });
  try {
    const res = responseRecorder();
    await handler({
      method: "POST",
      headers: { host: "app.example.com", origin: "https://app.example.com", "content-type": "application/json" },
      body: {
        reportType: "ended",
        sessionName: "Saturday Open Play",
        organizerName: "Alex",
        organizerEmail: "alex@example.com",
        report: "Session ended\nOrganizer feedback:\nGreat session!"
      }
    }, res);

    assert.equal(res.statusCode, 200);
    assert.equal(messages.length, 2);
    assert.equal(messages[0].to, "reports@example.com");
    assert.match(messages[0].subject, /Session ended/);
    assert.equal(messages[1].to, "alex@example.com");
    assert.match(messages[1].subject, /Thanks for using Gear Up Rally/);
    assert.match(messages[1].html, /Thanks for playing!/);
  } finally {
    nodemailer.createTransport = originalCreateTransport;
    for (const key of ["GMAIL_USER", "GMAIL_APP_PASSWORD", "REPORT_TO_EMAIL"]) {
      if (originalEnv[key] === undefined) delete process.env[key];
      else process.env[key] = originalEnv[key];
    }
  }
});
