# PickleQueue ni Loyloy

A local-first pickleball session manager for a single organizer. Serve `index.html` from a local static web server (for example, `npm start`) and run the domain tests with `npm test`.

## What it includes

- Draft, active, paused, and completed session states.
- Singles and doubles, a configurable court count, player skill levels, breaks, and availability.
- Unique player names, checked case-insensitively when adding or editing players.
- Four matching strategies, deterministic scoring, court-aware simultaneous match selection, fairness explanations, and soft skill-gap warnings.
- Organizer-created custom matches, queued-match editing, automatic player exchanges, plus pause/resume and stop-to-queue controls.
- Configurable score targets and optional deuce (win-by-two) validation, score correction with statistic recalculation, automatic stats, a minimum-games leaderboard, and completed-game history.
- A live elapsed-time timer on every in-progress game.
- Match cards with player skill levels and session win rates, plus waiting cards that exclude reserved and playing players.
- Browser `localStorage` persistence, so a refresh on the same browser/device keeps the session.
- Optional Gmail session reports sent at session start and end through a Vercel serverless function.

## How matching works

The domain module first filters out players who are resting, unavailable, already on a live court, or otherwise ineligible. It enumerates feasible player groups and (for doubles) all team partitions. A normalized score balances team skill, sample-smoothed session performance, participation, waiting time, partner variety, and opponent variety. Strategy-specific weights change these priorities. It then searches bounded candidate sets for the best non-overlapping collection across the open courts, with stable IDs providing deterministic tie-breaking.

Proposed matches reserve open court slots just like in-progress games. If every court is occupied or already has a queued match, start an existing queued match or cancel it before generating another; unassigned eligible players can then fill any open court.

An organizer can pick active players who are already in queued matches. Custom-match creation replaces each pulled queued slot from the unassigned waiting players; if there are not enough replacements, the custom match is rejected without changing any queued assignment. Editing a queued match exchanges a selected queued player with the player being removed. Selecting a player already on the other team swaps their two positions. Live matches cannot be edited; stopping one returns it to the editable queue without recording a score. Pausing a live match freezes its timer.

Team skill starts with the mean of the players' 1–5 skill levels. Session performance uses a Beta(1,1)-smoothed win rate `(wins + 1) / (games + 2)` and a small configurable adjustment to skill. Valid recorded point margins are a low-weight supplementary signal only for the same team combination in doubles (or player in singles); the app does not infer an individual's skill from a doubles score. Skill thresholds are warnings/preferences rather than hard exclusions: the best feasible match is still proposed and its trade-off is shown. Player eligibility, uniqueness, available courts, and not changing completed matches or other live matches are hard constraints.

Games default to 11 points with deuce enabled. With deuce enabled, a team must reach the target and lead by at least 2, and play may continue beyond the target. With deuce disabled, the winning score must be exactly the target and the other team must be below it. Both the target and deuce option are configurable in the session settings. In-progress match cards show elapsed time since the game started, excluding paused time. Scores are validated and determine the winner; editing a completed score recalculates the session player statistics.

This is an explainable heuristic for recreational play, not a fairness guarantee. For larger groups it uses a bounded search over the highest-scoring candidate matches, which favors responsiveness but may not find the mathematical global optimum. Skill ratings are organizer-entered and results are a limited sample.

## Persistence limitations

Session data stays in the browser's local storage on this device. It does not sync with other organizers or devices, and clearing browser data can erase the session. There is no shared session database, account system, or cross-device recovery; the Vercel function only sends the report supplied by the organizer.

## Email reports on Vercel

The setup asks for the organizer's name, contact number, and court/venue name before a session can start; club name is optional. When deployed to Vercel, the app emails a plain-text report when a session starts and ends. The report includes organizer contact details, court/venue, session settings, player statistics, and match history. After ending, the organizer must submit feedback before the final report is emailed. A report can also be sent manually with **Email update** or **Email final report**. If delivery fails, the session remains saved and the app displays an error; use the email button to retry.

Before deploying, add these environment variables in the Vercel project settings (for Production, and Preview if needed):

- `GMAIL_USER`: the Gmail address used to send reports.
- `GMAIL_APP_PASSWORD`: the Google App Password. Keep it in Vercel only; never add it to frontend code or commit it.
- `REPORT_TO_EMAIL`: the inbox that receives the reports.

The report endpoint does not prompt for an access code. It sends only to the fixed `REPORT_TO_EMAIL`, rejects cross-origin requests, and applies a best-effort per-instance request limit. Because the endpoint is public and Vercel functions can scale across instances, this limit is not strong authentication or a guaranteed global quota. For a private deployment, enable Vercel Deployment Protection or add user authentication before using it broadly. Organizer contact details, player names, results, and feedback are sent in email, so tell participants how this information will be used.

After setting the variables, redeploy the Vercel project. The `api/send-report.js` function is available on Vercel; the plain local static server (`npm start`) does not run serverless API functions. To test email sending locally, run the project with the Vercel CLI (`vercel dev`) and provide the email environment variables in the local Vercel environment. If a Gmail address or App Password is changed, update the matching Vercel environment variable and redeploy.

## Tests

`npm test` runs the domain and email-endpoint tests using Node's built-in test runner.
