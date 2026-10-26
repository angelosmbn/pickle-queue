import test from "node:test";
import assert from "node:assert/strict";
import handler from "../api/send-report.js";

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
