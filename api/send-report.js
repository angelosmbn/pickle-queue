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
      typeof body.report !== "string" || !body.report.trim() || Buffer.byteLength(body.report) > 30000) {
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
    await transporter.sendMail({
      from: `PickleQueue ni Loyloy <${GMAIL_USER}>`,
      to: REPORT_TO_EMAIL,
      subject: `PickleQueue ni Loyloy — Session ${phase}: ${sessionName}`,
      text: body.report
    });
    return respond(res, 200, { sent: true });
  } catch (error) {
    console.error("Session report email failed:", error);
    return respond(res, 502, { error: "Email delivery failed. Check the Gmail settings and Vercel function logs." });
  }
}
