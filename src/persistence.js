import { STORAGE_KEY } from "./domain.js";

export function loadSession() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  try {
    const session = JSON.parse(raw);
    if (!session || typeof session !== "object" || !Array.isArray(session.players) || !Array.isArray(session.matches)) {
      throw new Error("Saved session has an unexpected structure.");
    }
    return session;
  } catch (error) {
    throw new Error(`Could not read the saved session: ${error.message}`);
  }
}

export function saveSession(session) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
  } catch (error) {
    throw new Error(`Could not save this session in this browser: ${error.message}`);
  }
}

export function clearSession() {
  localStorage.removeItem(STORAGE_KEY);
}
