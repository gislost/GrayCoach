# GrayCoach

A Chrome/Edge extension that reviews your **finished** chess.com and Lichess games:

- **Stockfish 19** runs in your browser and grades every move (best, excellent, good, inaccuracy, mistake, blunder, missed chance), with accuracy, average centipawn loss and an eval graph.
- **Claude** reads the engine report and writes a coach review: what decided the game, 3–6 key moments, strengths, weaknesses, tips and one thing to train next.
- **Ask the coach** questions about any position while you click through the game.
- **Click any move the coach names** to jump the board there. Moves it suggests (that weren't played) show as a green arrow.
- Reviews open in the browser's **side panel**, right next to the game. Prefer a full tab? Change it in Settings, or click **Open in tab ↗**.

![A Stockfish review: 9...b5 graded a mistake, with the better move Qc7 drawn on the board](store/screenshots/1-review-mistake.png)

## Install

### Download (no build needed)

1. Download `graycoach-vX.Y.Z.zip` from the [latest release](https://github.com/gislost/GrayCoach/releases/latest) and unzip it to a folder you'll keep.
2. Open `chrome://extensions` (or `edge://extensions` in Edge).
3. Turn on **Developer mode**.
4. Click **Load unpacked** and pick the unzipped folder (the one with `manifest.json` in it).
5. Pin the extension, open its **Settings** and add your chess.com and Lichess usernames. For the coach review, paste an Anthropic API key from [console.anthropic.com](https://console.anthropic.com/settings/keys). Without a key you still get the full Stockfish review.

To update, download the new zip, replace the folder's contents, and press the reload button on the extension card.

### Build from source

Needs Node 20 or newer.

```bash
npm install
npm run build
```

Then load the `dist` folder with **Load unpacked** as above. `npm run watch` rebuilds as you edit (press reload on the extension card after a change). `npm run package` builds and writes the release zip to `release/`.

## Use it

- Finish a game on chess.com or Lichess, then click the green **♞ Coach review** button (bottom right), or use the toolbar popup → **Review this game**.
- The popup also has **Latest chess.com game**, **Latest Lichess game** (from your usernames) and **Paste a PGN**.
- In the review: ← → step through moves, **F** flips the board, click the graph, a key moment or a move in the coach's text to jump, and **Show the better move** shows what the engine wanted.
- The review opens in the side panel next to the game. Settings → **Where reviews open** switches to a new tab instead. Pasted PGNs always open in a tab.

Analyses and coach reviews for your last 40 games are saved locally, so they reopen instantly.

## Privacy and cost

- The API key is kept in the extension's local storage and is sent only to `api.anthropic.com`.
- Stockfish runs locally. Only the coach step sends the moves and engine report to Claude.
- Each coach review is one API call on your key. Follow-up questions are one call each. Pick the model in Settings.
- No analytics or tracking. The full policy is in [PRIVACY.md](PRIVACY.md).

## Fair play

The extension only reviews games that are over. It refuses unfinished chess.com and Lichess games, and pasted PGNs without a result need an explicit "this game is over" tick. Using engine help during a game you're playing breaks the rules on both sites.

## Licenses

GrayCoach is free software under the [GNU GPL v3 or later](LICENSE). It bundles:

- [Stockfish](https://stockfishchess.org) 19 lite (via the `stockfish` npm package): GPL-3.0. Its license ships in the build as `engine/COPYING.txt`.
- [chessground](https://github.com/lichess-org/chessground): GPL-3.0-or-later. The cburnett piece set is CC BY-SA 3.0.
- [chess.js](https://github.com/jhlywa/chess.js): BSD-2-Clause.
- [Anthropic TypeScript SDK](https://github.com/anthropics/anthropic-sdk-typescript): Apache-2.0. [zod](https://zod.dev): MIT.

The build includes `THIRD_PARTY_LICENSES.txt` with the license text of every bundled package.

Not affiliated with chess.com, Lichess or Anthropic.
