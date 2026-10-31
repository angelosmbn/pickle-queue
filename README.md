# Gear Up Rally

A local-first pickleball session manager for a single organizer. The frontend lives in `public/` so Vercel can serve it as static assets; run `npm start` to serve the app locally, including the Reclub import API, and run the tests with `npm test`.

## What it includes

- Draft, active, paused, and completed session states.
- Singles and doubles, a configurable court count, player skill levels, breaks, and availability.
- Public Reclub event import for all confirmed players, regardless of payment; imported players start at Intermediate and on break.
- A floating all-player manager with status filters and bulk rest, return, and removal actions.
- Unique player names, checked case-insensitively when adding or editing players.
- Four matching strategies, deterministic scoring, court-aware simultaneous match selection, fairness explanations, and soft skill-gap warnings.
- Organizer-created custom matches with court selection, queued-match editing, automatic player exchanges, plus pause/resume and stop-to-queue controls.
- Configurable score targets and optional deuce (win-by-two) validation, score correction with statistic recalculation, automatic stats, a minimum-games leaderboard, and completed-game history.
- A live elapsed-time timer on every in-progress game.
- Match cards with player skill levels and session win rates, plus waiting cards that exclude reserved and playing players.
- Browser `localStorage` persistence, so a refresh on the same browser/device keeps the session.
- Required session feedback with a 1–5 star rating, included in the final Gmail report sent through a Vercel serverless function, plus a thank-you email to the organizer.

Use **Import Reclub** in the player lineup and paste a public event link such as `https://reclub.co/m/7E2ZJD`. The importer reads confirmed participants and their public display names regardless of payment status; waitlisted and cancelled participants are excluded. It does not sign in or access private event data. Imported players are set to Intermediate and resting, and duplicate names receive a numbered suffix. Resting players count toward the minimum to start a session, but remain resting after it starts; mark them active when they are ready to join the queue. The importer works with `npm start` locally and through its serverless endpoint on Vercel.

Use the lineup search beside **View all players** to find a player by name. Choose **View all players** to open the floating manager, where search can be combined with active, queued, playing, paused, resting, or unavailable status filters. Select visible players individually or together and bulk mark them resting, return them to the queue, or remove eligible players. Players with completed games or currently on court cannot be removed. Removing players or changing the status of queued players cancels affected queued matches after confirmation.

## How matching works

The domain module first filters out players who are resting, unavailable, already on a live court, or otherwise ineligible. It prefers players below the consecutive-game rest limit, but if that leaves too few players to fill any court, it generates a match with available active players and notes the rest-limit override. It enumerates feasible player groups and (for doubles) all team partitions. A normalized score balances team skill, sample-smoothed session performance, participation, waiting time, partner variety, and opponent variety. Strategy-specific weights change these priorities. It then searches bounded candidate sets for the best non-overlapping collection across the open courts, with stable IDs providing deterministic tie-breaking.

Proposed matches receive and reserve a court number as soon as they are queued, just like in-progress games. Removing a generated queued match and choosing **Generate** favors a different matchup while primarily ranking options by the queue strategy; a replacement may keep some or all of the original players, and if no different player group is available, it favors a new team arrangement. If every court is occupied or already has a queued match, start an existing queued match or cancel it before generating another; unassigned eligible players can then fill any open court. The player lineup and available-next list are shown alphabetically.

When enough unassigned active players are eligible for another game, the dashboard shows up to two non-reserving upcoming-match previews above the available-next player list. It uses the current queue strategy and rest rotation, showing two when possible, one when only one can be formed, and none when no full match can be formed.

An organizer can pick active players who are already in queued matches. Custom-match creation replaces each pulled queued slot from the unassigned waiting players; if there are not enough replacements, the custom match is rejected without changing any queued assignment. Upcoming-match previews can be edited without entering the live queue; use **Queue** when ready to add that preview as a custom match. Queued matches can change courts, including to a court currently in use, but cannot start until their assigned court is free. Editing a queued match exchanges a selected queued player with the player being removed. Selecting a player already on the other team swaps their two positions. Live matches cannot be edited; stopping one returns it to the editable queue without recording a score. Pausing a live match freezes its timer.

Team skill starts with the mean of the players' 1–5 skill levels. Session performance uses a Beta(1,1)-smoothed win rate `(wins + 1) / (games + 2)` and a small configurable adjustment to skill. Valid recorded point margins are a low-weight supplementary signal only for the same team combination in doubles (or player in singles); the app does not infer an individual's skill from a doubles score. Skill thresholds are warnings/preferences rather than hard exclusions: the best feasible match is still proposed and its trade-off is shown. Player eligibility, uniqueness, available courts, and not changing completed matches or other live matches are hard constraints.

Games default to 11 points with deuce enabled. With deuce enabled, a team must reach the target and lead by at least 2, and play may continue beyond the target. With deuce disabled, the winning score must be exactly the target and the other team must be below it. Both the target and deuce option are configurable in the session settings. In-progress match cards show elapsed time since the game started, excluding paused time. Scores are validated and determine the winner; editing a completed score recalculates the session player statistics.

This is an explainable heuristic for recreational play, not a fairness guarantee. For larger groups it uses a bounded search over the highest-scoring candidate matches, which favors responsiveness but may not find the mathematical global optimum. Skill ratings are organizer-entered and results are a limited sample.

## Persistence limitations

Session data stays in the browser's local storage on this device. It does not sync with other organizers or devices, and clearing browser data can erase the session. There is no shared session database, account system, or cross-device recovery; the Vercel function only sends the report supplied by the organizer.

## Email reports on Vercel

The setup asks for the organizer's name, contact number, email address, and court/venue name before a session can start; club name is optional. When deployed to Vercel, the app emails a formatted session report when a session starts and ends. The report includes organizer contact details, court/venue, session settings, tabular player statistics and match history, and the organizer's feedback with its star rating. After ending, the organizer must submit feedback before the final report is emailed; a separate thank-you email is sent to the organizer's required email address. If delivery fails, the session remains saved and the app displays an error.

Before deploying, add these environment variables in the Vercel project settings (for Production, and Preview if needed):

- `GMAIL_USER`: the Gmail address used to send reports.
- `GMAIL_APP_PASSWORD`: the Google App Password. Keep it in Vercel only; never add it to frontend code or commit it.
- `REPORT_TO_EMAIL`: the inbox that receives the reports.

The report endpoint does not prompt for an access code. Session reports go to the fixed `REPORT_TO_EMAIL`; after feedback, the thank-you message also goes to the organizer's email address entered at setup. The report and Reclub import endpoints reject cross-origin browser requests and apply best-effort per-instance request limits. Because Vercel functions can scale across instances, these limits are not strong authentication or guaranteed global quotas. For a private deployment, enable Vercel Deployment Protection or add user authentication before using the app broadly. Organizer contact details, email address, player names, results, and feedback are sent in email, so tell participants how this information will be used.

After setting the variables, redeploy the Vercel project. The `api/send-report.js` and `api/reclub-import.js` functions are available on Vercel. Local `npm start` runs the Reclub import endpoint but does not run the email-report function; use the Vercel CLI (`vercel dev`) to test all serverless functions locally. If a Gmail address or App Password is changed, update the matching Vercel environment variable and redeploy.

## Tests

`npm test` runs the domain and email-endpoint tests using Node's built-in test runner.
