# Chrome Web Store listing

Everything the Chrome Web Store developer dashboard asks for, ready to paste. Upload a `release/graycoach-vX.Y.Z.zip` you built with `npm run package` after the step below (not the GitHub release zip, which has the key in it).

**Before uploading:** delete the `"key"` line from `src/manifest.json` and run `npm run package` again. That key pins the extension ID for zip installs so settings survive updates. The store assigns its own ID, so the key doesn't belong in a store package. Store installs also update themselves, so you may want the GitHub update check off by default in that build (`checkUpdates: false` in `src/lib/settings.js`); if you do, drop the GitHub sentence from the description's PRIVACY paragraph.

Images in this folder come from `npm run build && npm run shots` (a real Stockfish review of Morphy's 1858 Opera Game; no API key, so no coach text). Once you've run a real coach review, a screenshot of it makes a good 4th or 5th image: 1280x800, PNG or JPEG.

## Store listing tab

**Name** (from the manifest): GrayCoach

**Summary** (from the manifest, 112 of 132 characters):
After a chess.com or Lichess game: Stockfish analysis plus a Claude coach review with tips. Finished games only.

**Description** (plain text):

```text
Finished a game on chess.com or Lichess? Click "Coach review" and see what really happened.

ENGINE REVIEW, FREE AND LOCAL
• Stockfish 19 runs right in your browser. Nothing is uploaded for the engine review.
• Every move is graded: best, excellent, good, inaccuracy, mistake, blunder, missed chance.
• Accuracy and average centipawn loss for both players, an eval bar and an eval graph.
• "Show the better move" draws what you played and what the engine wanted.

CLAUDE COACH (OPTIONAL)
• Add your own Anthropic API key and Claude reads the engine report and writes a coach review: what decided the game, the key moments, your strengths and weaknesses, practical tips, and one thing to train next.
• Ask the coach about any position while you click through the game: "why was this bad?", "what was the plan here?"
• Click any move the coach mentions to jump the board there. Its suggested moves show as a green arrow.
• Each review is one API call billed to your Anthropic account. Choose the model in Settings.

HOW TO USE
1. Open Settings and add your chess.com and/or Lichess username (and an API key if you want the coach).
2. Finish a game, then click the green "Coach review" button on the game page, or use the toolbar popup.
3. The review opens in the side panel next to your game (or in a new tab, if you pick that in Settings).
4. The popup can also open your latest chess.com or Lichess game, or review any pasted PGN.

FAIR PLAY
GrayCoach only reviews games that are over. It refuses unfinished games. Using engine help during a game you're playing breaks the rules on chess.com and Lichess.

PRIVACY
No analytics, no tracking, no account. Your key and saved games stay in your browser. Game data goes to Anthropic only when you ask for a coach review. Once a day GrayCoach asks GitHub for the latest version number (nothing about you is sent); you can turn that off in Settings.

Open source (GPL-3.0): https://github.com/gislost/GrayCoach
Not affiliated with chess.com, Lichess or Anthropic.
```

**Category:** Lifestyle → Games (or Productivity → Education)

**Language:** English

**Graphic assets:**

| Field | File |
| --- | --- |
| Store icon (128x128) | `icon-128.png` |
| Screenshots (1280x800) | `screenshots/1-review-mistake.png`, `screenshots/2-review-final.png`, `screenshots/3-settings.png` |
| Small promo tile (440x280) | `promo-440x280.png` |

**Homepage URL:** https://github.com/gislost/GrayCoach
**Support URL:** https://github.com/gislost/GrayCoach/issues

## Privacy practices tab

**Single purpose:**

```text
Reviews finished chess games from chess.com and Lichess: runs a local Stockfish analysis that grades each move, and optionally gets a written coach review from Claude using the user's own Anthropic API key.
```

**Permission justifications:**

| Permission | Justification |
| --- | --- |
| `storage` | Saves the user's settings (usernames, coach model, analysis depth, optional Anthropic API key) and their 40 most recent game analyses and reviews, so reviews reopen instantly. |
| `activeTab` | When the user opens the toolbar popup, reads the current tab's URL to enable "Review this game" on a chess.com or Lichess game page, and asks that page's content script for the finished game. |
| `sidePanel` | Shows the game review in the browser's side panel next to the chess.com or Lichess tab, only after the user clicks "Coach review" or a popup button. Users can switch to opening reviews in a tab instead. |
| Host `https://api.chess.com/*` | Reads the user's finished games from chess.com's public API (their latest game, or a game the page didn't provide). |
| Host `https://lichess.org/*` | Reads the user's finished games from Lichess's public game export API. Also runs the content script that adds the "Coach review" button on Lichess game pages. |
| Host `https://api.anthropic.com/*` | Sends the game moves and engine report to Anthropic's API with the user's own key, only when the user asks for a coach review or asks the coach a question. |
| Content script on `https://www.chess.com/*` | Adds the "Coach review" button to chess.com game pages and reads the finished game being viewed. It does nothing on other pages. |

**Remote code:** No, I am not using remote code. (All JavaScript and the Stockfish WebAssembly engine ship inside the package.)

**Data usage.** Tick these:

- **Authentication information:** the user's Anthropic API key, stored locally and sent only to api.anthropic.com to make the requests the user asks for.
- **Website content:** chess game moves and headers from chess.com and Lichess, sent to Anthropic for the coach review.
- **Personally identifiable information:** the chess.com and Lichess usernames the user enters, sent to those sites' public APIs to find the user's games.

Then tick all three certifications: data is not sold to third parties, not used for purposes unrelated to the single purpose, and not used to determine creditworthiness or for lending.

**Privacy policy URL:** https://github.com/gislost/GrayCoach/blob/main/PRIVACY.md

## Distribution tab

Free, Public, all regions.

## Submitting

1. Register at https://chrome.google.com/webstore/devconsole (one-time $5 fee, paid by you).
2. **New item** → upload the release zip.
3. Fill in the tabs above, then **Submit for review**. Reviews usually take a few days. Extensions that use host permissions can take longer.

For Microsoft Edge Add-ons (free): https://partner.microsoft.com/dashboard/microsoftedge. The same zip and text work there.
