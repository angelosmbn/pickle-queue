import nodemailer from "nodemailer";

const requestTimesByIp = new Map();
const RATE_WINDOW_MS = 60_000;
const RATE_LIMIT = 5;

function respond(res, status, payload) {
  return res.status(status).json(payload);
}

function overRateLimit(ip, now = Date.now()) {
  const recent = (requestTimesByIp.get(ip) ?? []).filter((time) => now - time < RATE_WINDOW_MS);
  if (recent.length >= RATE_LIMIT) {
    requestTimesByIp.set(ip, recent);
    return true;
  }
  recent.push(now);
  requestTimesByIp.set(ip, recent);
  return false;
}

function escapeHtml(value) {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[character]);
}

function renderTable(headers, rows) {
  const header = headers.map((label) =>
    `<th align="left" style="padding:9px 10px;background:#252421;border-bottom:1px solid #34322f;color:#d3a76c;font-size:11px;font-weight:700">${escapeHtml(label)}</th>`
  ).join("");
  const body = rows.length
    ? rows.map((row) => `<tr>${row.map((cell) =>
      `<td style="padding:9px 10px;border-bottom:1px solid #34322f;color:#f1eee8;font-size:12px;line-height:1.5;vertical-align:top">${escapeHtml(cell)}</td>`
    ).join("")}</tr>`).join("")
    : `<tr><td colspan="${headers.length}" style="padding:12px 10px;border-bottom:1px solid #34322f;color:#aaa69e;font-size:13px">No entries yet.</td></tr>`;
  return `<table role="table" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse">${headers.length ? `<thead><tr>${header}</tr></thead>` : ""}<tbody>${body}</tbody></table>`;
}

export function buildReportHtml(reportType, sessionName, report) {
  const lines = report.split(/\r?\n/);
  const sectionIndex = (heading) => lines.indexOf(heading);
  const playerIndex = sectionIndex("Player statistics:");
  const matchIndex = sectionIndex("Match history:");
  const feedbackIndex = sectionIndex("Organizer feedback:");
  const firstSection = [playerIndex, matchIndex, feedbackIndex].filter((index) => index >= 0);
  const detailsEnd = firstSection.length ? Math.min(...firstSection) : lines.length;
  const details = lines.slice(1, detailsEnd)
    .map((line) => line.match(/^([^:]+):\s*(.*)$/))
    .filter(Boolean)
    .map(([, label, value]) => [label, value]);
  const playerLines = playerIndex >= 0
    ? lines.slice(playerIndex + 1, matchIndex >= 0 ? matchIndex : lines.length)
      .filter((line) => line.startsWith("- "))
    : [];
  const players = playerLines.map((line) => {
    const match = line.match(/^- (.+): (\d+) games, (\d+) wins, (\d+) losses, (.+) win rate$/);
    return match
      ? [match[1], match[2], match[3], match[4], match[5]]
      : [line.slice(2), "—", "—", "—", "—"];
  });
  const matchLines = matchIndex >= 0
    ? lines.slice(matchIndex + 1, feedbackIndex >= 0 ? feedbackIndex : lines.length)
      .filter((line) => line.startsWith("- "))
    : [];
  const matches = matchLines.map((line) => {
    const match = line.match(/^- (Game \d+) · ([^·:]+?)(?: · Court (\d+))?: (.+?) vs (.+?)(?: \((\d+)–(\d+)\))?$/);
    if (!match) return [line.slice(2), "—", "—", "—"];
    const [, game, status, court = "—", teamA, teamB, scoreA, scoreB] = match;
    return [game, status.trim(), court, `${teamA} vs ${teamB}${scoreA && scoreB ? ` (${scoreA}–${scoreB})` : ""}`];
  });
  const feedbackLines = feedbackIndex >= 0
    ? lines.slice(feedbackIndex + 1).join("\n").trim()
    : "";
  const rating = feedbackLines.match(/^Rating:\s*(Not provided|\d+\/5 stars)\s*(?:\r?\n|$)/m)?.[1] ?? "Not provided";
  const feedback = feedbackLines.replace(/^Rating:\s*(?:Not provided|\d+\/5 stars)\s*(?:\r?\n|$)/m, "").trim();
  const isEnded = reportType === "ended";
  const detailRows = details.map(([label, value]) =>
    `<tr><th align="left" style="width:38%;padding:9px 12px;border-bottom:1px solid #34322f;color:#c2bdb3;font-size:12px;font-weight:600">${escapeHtml(label)}</th><td style="padding:9px 12px;border-bottom:1px solid #34322f;color:#f1eee8;font-size:13px">${escapeHtml(value)}</td></tr>`
  ).join("");
  const playerTable = renderTable(["Player", "Games", "Wins", "Losses", "Win rate"], players);
  const matchTable = renderTable(["Game", "Status", "Court", "Matchup / score"], matches);
  const ratingValue = rating === "Not provided" ? "Not provided" : rating.replace("/5 stars", " / 5");
  const starRating = rating === "Not provided" ? "" : `<span style="color:#c89d62;font-size:18px;letter-spacing:2px">${"★".repeat(Number.parseInt(rating, 10))}</span>`;
  const section = (title, content) =>
    `<tr><td style="padding:0 28px 22px"><h2 style="margin:0 0 10px;color:#d3a76c;font-size:16px;line-height:1.4">${title}</h2>${content}</td></tr>`;

  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:24px 12px;background:#111;font-family:Arial,Helvetica,sans-serif;color:#f1eee8">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:640px;margin:0 auto;background:#1b1a18;border:1px solid #34322f;border-radius:14px;overflow:hidden">
    <tr><td style="padding:26px 28px;background:#111;border-bottom:2px solid #c89d62;color:#f1eee8">
      <p style="margin:0 0 8px;color:#d3a76c;font-size:11px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase">Gear Up Rally</p>
      <h1 style="margin:0;font-size:24px;line-height:1.3">${isEnded ? "Session complete" : "Session started"}</h1>
      <p style="margin:7px 0 0;color:#c2bdb3;font-size:15px">${escapeHtml(sessionName)}</p>
    </td></tr>
    <tr><td style="padding:22px 28px 12px">
      <p style="margin:0 0 7px;color:#d3a76c;font-size:11px;font-weight:700;letter-spacing:1.2px;text-transform:uppercase">Session details</p>
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0">${detailRows}</table>
    </td></tr>
    ${playerIndex >= 0 ? section("Player statistics", playerTable) : ""}
    ${matchIndex >= 0 ? section("Match history", matchTable) : ""}
    ${feedbackIndex >= 0 ? section("Organizer feedback", `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin-bottom:10px;border:1px solid #34322f;border-radius:8px;background:#22211f"><tr><th align="left" style="width:34%;padding:11px 13px;color:#c2bdb3;font-size:12px;font-weight:600">Session rating</th><td style="padding:11px 13px;color:#f1eee8;font-size:13px;font-weight:700">${starRating}<span style="padding-left:8px;vertical-align:3px">${escapeHtml(ratingValue)}</span></td></tr></table><p style="margin:0;padding:13px 15px;border-radius:8px;background:#252421;color:#f1eee8;font-size:14px;line-height:1.6;white-space:pre-wrap">${escapeHtml(feedback || "No written feedback provided.")}</p>`) : ""}
    <tr><td style="padding:17px 28px;border-top:1px solid #34322f;background:#151412;color:#aaa69e;font-size:11px;line-height:1.5">Automatically generated by Gear Up Rally.</td></tr>
  </table>
</body>
</html>`;
}

export function buildThankYouHtml(organizerName, sessionName) {
  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:24px 12px;background:#111;font-family:Arial,Helvetica,sans-serif;color:#f1eee8">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:600px;margin:0 auto;background:#1b1a18;border:1px solid #34322f;border-radius:14px;overflow:hidden">
    <tr><td style="padding:28px;background:#111;border-bottom:2px solid #c89d62;color:#f1eee8">
      <p style="margin:0 0 10px;color:#d3a76c;font-size:11px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase">Gear Up Rally</p>
      <h1 style="margin:0;font-size:26px;line-height:1.3">Thanks for playing!</h1>
    </td></tr>
    <tr><td style="padding:28px">
      <p style="margin:0 0 14px;font-size:17px;line-height:1.5">Hi ${escapeHtml(organizerName)},</p>
      <p style="margin:0 0 14px;color:#c2bdb3;font-size:15px;line-height:1.7">Thanks for using Gear Up Rally to organize <strong style="color:#f1eee8">${escapeHtml(sessionName)}</strong>. We hope it made your games easier to run and more fun to play.</p>
      <p style="margin:0 0 22px;color:#c2bdb3;font-size:15px;line-height:1.7">Thanks for sharing your feedback, too. It helps us make the app better for your next session.</p>
      <p style="margin:0;color:#d3a76c;font-size:15px;font-weight:700;line-height:1.6">See you on the court!<br><span style="color:#c2bdb3;font-weight:400">The Gear Up Rally team</span></p>
    </td></tr>
    <tr><td style="padding:16px 28px;border-top:1px solid #34322f;background:#151412;color:#aaa69e;font-size:11px;line-height:1.5">This is an automatic thank-you for your completed session.</td></tr>
  </table>
</body>
</html>`;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return respond(res, 405, { error: "Use POST to send a session report." });
  }
  if (!String(req.headers["content-type"] ?? "").toLowerCase().startsWith("application/json")) {
    return respond(res, 415, { error: "Send the report as JSON." });
  }

  const origin = req.headers.origin;
  const requestHost = req.headers["x-forwarded-host"] ?? req.headers.host;
  if (!origin || !requestHost) {
    return respond(res, 403, { error: "Requests must come from this deployed app." });
  }
  let originHost;
  try {
    originHost = new URL(origin).host;
  } catch {
    return respond(res, 403, { error: "Requests must come from this deployed app." });
  }
  if (originHost !== String(requestHost)) {
    return respond(res, 403, { error: "Requests must come from this deployed app." });
  }

  const ip = String(req.headers["x-forwarded-for"] ?? "unknown").split(",")[0].trim();
  if (overRateLimit(ip)) {
    return respond(res, 429, { error: "Too many reports were requested. Wait a minute and try again." });
  }

  const { GMAIL_USER, GMAIL_APP_PASSWORD, REPORT_TO_EMAIL } = process.env;
  if (!GMAIL_USER || !GMAIL_APP_PASSWORD || !REPORT_TO_EMAIL) {
    return respond(res, 503, { error: "Email reports are not configured yet. Check the Vercel environment variables." });
  }

  const body = req.body && typeof req.body === "object" ? req.body : {};
  if (!["started", "ended"].includes(body.reportType) ||
      typeof body.sessionName !== "string" || !body.sessionName.trim() || body.sessionName.length > 100 ||
      typeof body.report !== "string" || !body.report.trim() || Buffer.byteLength(body.report) > 30000 ||
      (body.reportType === "ended" &&
        (typeof body.organizerEmail !== "string" || body.organizerEmail.length > 254 ||
          !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.organizerEmail.trim()) ||
          typeof body.organizerName !== "string" || !body.organizerName.trim() || body.organizerName.length > 70))) {
    return respond(res, 400, { error: "The session report is incomplete or too large." });
  }

  const sessionName = body.sessionName.replace(/[\r\n]+/g, " ").trim();
  const phase = body.reportType === "started" ? "started" : "ended";
  const transporter = nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 465,
    secure: true,
    auth: {
      user: GMAIL_USER,
      pass: GMAIL_APP_PASSWORD.replace(/\s/g, "")
    }
  });

  try {
    const reportDelivery = transporter.sendMail({
      from: `Gear Up Rally <${GMAIL_USER}>`,
      to: REPORT_TO_EMAIL,
      subject: `Gear Up Rally — Session ${phase}: ${sessionName}`,
      text: body.report,
      html: buildReportHtml(body.reportType, sessionName, body.report)
    });
    const deliveries = [reportDelivery];
    if (body.reportType === "ended") {
      const organizerName = body.organizerName.trim();
      const organizerEmail = body.organizerEmail.trim();
      deliveries.push(transporter.sendMail({
        from: `Gear Up Rally <${GMAIL_USER}>`,
        to: organizerEmail,
        subject: `Thanks for using Gear Up Rally — ${sessionName}`,
        text: `Hi ${organizerName},\n\nThanks for using Gear Up Rally to organize ${sessionName}. We hope it made your games easier to run and more fun to play.\n\nThanks for sharing your feedback, too. It helps us make the app better for your next session.\n\nSee you on the court!\nThe Gear Up Rally team`,
        html: buildThankYouHtml(organizerName, sessionName)
      }));
    }
    await Promise.all(deliveries);
    return respond(res, 200, { sent: true });
  } catch (error) {
    console.error("Session email delivery failed:", error);
    return respond(res, 502, { error: "One or more session emails could not be delivered. Check the Gmail settings and Vercel function logs." });
  }
}
