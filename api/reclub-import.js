const requestTimesByIp = new Map();
const RATE_WINDOW_MS = 60_000;
const RATE_LIMIT = 5;
const MAX_PAGE_BYTES = 2_000_000;

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

function resolveNode(nodes, reference) {
  if (!Number.isInteger(reference) || reference < 0 || reference >= nodes.length) {
    throw new Error("The Reclub page data is incomplete.");
  }
  const value = nodes[reference];
  if (Array.isArray(value) && ["Reactive", "ShallowReactive"].includes(value[0]) && value.length === 2) {
    return resolveNode(nodes, value[1]);
  }
  return value;
}

function propertyValue(nodes, object, key) {
  const value = object?.[key];
  return Number.isInteger(value) ? resolveNode(nodes, value) : value;
}

export function parseConfirmedPlayers(html, eventCode) {
  const script = html.match(/<script\b(?=[^>]*\bid=["']__NUXT_DATA__["'])[^>]*>([\s\S]*?)<\/script>/i)?.[1];
  if (!script) throw new Error("The Reclub page did not include public event data.");

  let nodes;
  try {
    nodes = JSON.parse(script);
  } catch {
    throw new Error("The Reclub page returned invalid event data.");
  }
  if (!Array.isArray(nodes) || !nodes.length) throw new Error("The Reclub page returned invalid event data.");

  const appState = resolveNode(nodes, 0);
  const data = propertyValue(nodes, appState, "data");
  const eventData = propertyValue(nodes, data, `meet-${eventCode}`);
  const meet = propertyValue(nodes, eventData, "meet");
  if (propertyValue(nodes, meet, "referenceCode") !== eventCode) {
    throw new Error("The Reclub page did not match the requested event.");
  }

  const participants = propertyValue(nodes, meet, "participants");
  const users = propertyValue(nodes, eventData, "usersMap");
  if (!Array.isArray(participants) || !users || typeof users !== "object") {
    throw new Error("The Reclub page does not expose its public participant list.");
  }

  const names = [];
  for (const reference of participants) {
    const participant = resolveNode(nodes, reference);
    const status = propertyValue(nodes, participant, "status");
    const tags = propertyValue(nodes, participant, "tags");
    if (status !== 1 || !Array.isArray(tags) ||
        !tags.some((tag) => resolveNode(nodes, tag) === "paid")) continue;

    const externalReference = propertyValue(nodes, participant, "externalReference");
    const guestName = propertyValue(nodes, externalReference, "name");
    let name = typeof guestName === "string" ? guestName.trim() : "";
    if (!name) {
      const userId = propertyValue(nodes, participant, "referenceId");
      const profileReference = users[String(userId)];
      if (!Number.isInteger(profileReference)) continue;
      const profile = resolveNode(nodes, profileReference);
      name = propertyValue(nodes, profile, "name");
    }
    if (typeof name === "string" && name.trim()) names.push(name.trim());
  }

  if (!names.length) throw new Error("No confirmed paid players were found in the public Reclub event.");
  if (names.length > 500) throw new Error("The event has too many confirmed players to import.");
  return names;
}

async function readLimitedResponse(response) {
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_PAGE_BYTES) {
    throw new Error("The Reclub event page is larger than the import limit.");
  }
  if (!response.body) throw new Error("The Reclub event page returned an empty response.");

  const reader = response.body.getReader();
  const chunks = [];
  let totalBytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    totalBytes += value.byteLength;
    if (totalBytes > MAX_PAGE_BYTES) {
      await reader.cancel();
      throw new Error("The Reclub event page is larger than the import limit.");
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks).toString("utf8");
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return respond(res, 405, { error: "Use POST to import a Reclub event." });
  }
  if (!String(req.headers["content-type"] ?? "").toLowerCase().startsWith("application/json")) {
    return respond(res, 415, { error: "Send the Reclub link as JSON." });
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
    return respond(res, 429, { error: "Too many imports were requested. Wait a minute and try again." });
  }

  const body = req.body && typeof req.body === "object" ? req.body : {};
  if (typeof body.eventUrl !== "string" || body.eventUrl.length > 2048) {
    return respond(res, 400, { error: "Enter a valid public Reclub event link." });
  }

  let eventUrl;
  try {
    eventUrl = new URL(body.eventUrl);
  } catch {
    return respond(res, 400, { error: "Enter a valid public Reclub event link." });
  }
  const eventMatch = eventUrl.pathname.match(/^\/m\/([a-zA-Z0-9]{4,32})\/?$/);
  if (eventUrl.protocol !== "https:" ||
      !["reclub.co", "www.reclub.co"].includes(eventUrl.hostname.toLowerCase()) ||
      eventUrl.port || eventUrl.username || eventUrl.password || !eventMatch) {
    return respond(res, 400, { error: "Use a public Reclub link in the form https://reclub.co/m/EVENTCODE." });
  }
  const eventCode = eventMatch[1];

  try {
    const response = await fetch(`https://reclub.co/m/${eventCode}`, {
      headers: { accept: "text/html" },
      redirect: "manual",
      signal: AbortSignal.timeout(10_000)
    });
    if (!response.ok || response.status >= 300) {
      return respond(res, 502, { error: "The public Reclub event page could not be loaded." });
    }
    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.toLowerCase().includes("text/html")) {
      return respond(res, 502, { error: "Reclub did not return a public event page." });
    }
    const html = await readLimitedResponse(response);
    let players;
    try {
      players = parseConfirmedPlayers(html, eventCode);
    } catch (error) {
      return respond(res, 422, { error: error.message });
    }
    return respond(res, 200, { players });
  } catch (error) {
    if (error.name === "TimeoutError" || error.name === "AbortError") {
      return respond(res, 504, { error: "Loading the Reclub event timed out. Try again in a moment." });
    }
    if (error instanceof Error && error.message.startsWith("The Reclub")) {
      return respond(res, 422, { error: error.message });
    }
    console.error("Reclub player import failed:", error);
    return respond(res, 502, { error: "The Reclub event could not be imported. Check the public link and try again." });
  }
}
