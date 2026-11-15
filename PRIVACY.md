# Privacy policy: GrayCoach

_Last updated: November 15, 2026_

GrayCoach is a browser extension that reviews chess games after they finish. It has no server of its own and collects nothing for its developer.

## What it stores

Everything is kept in the extension's local storage in your browser profile:

- **Settings:** your Anthropic API key (if you add one), the coach model, the analysis depth, and your chess.com and Lichess usernames.
- **Saved games:** the moves and headers (player names, ratings, date, result) of your 40 most recently reviewed games, with their engine analyses and coach reviews, so they reopen instantly.

You can delete saved games in Settings → **Delete saved games and reviews**. Removing the extension deletes all of its data.

## What it sends, and where

| Data | Sent to | When |
| --- | --- | --- |
| Game moves and headers, the Stockfish report, and your questions | `api.anthropic.com` (Anthropic), with your API key | Only when you ask for a coach review or ask the coach a question. Nothing goes to Anthropic if you don't add a key. |
| Your chess.com username | `api.chess.com` (public API) | To find your latest game, or a finished game the page couldn't provide. |
| Your Lichess username | `lichess.org` (public API) | To find your latest game. |
| A game ID | `www.chess.com` or `lichess.org` | When you click **Coach review** on a game page, the extension reads that game from the site you're on. |

Stockfish runs inside your browser. Engine analysis never leaves your computer.

Anthropic handles API requests under its own [privacy policy](https://www.anthropic.com/legal/privacy). Requests are billed to your Anthropic account.

## What it doesn't do

- No analytics, tracking, ads or remote code.
- No selling or sharing of data with anyone.
- It doesn't read pages other than chess.com and lichess.org, and on those it only looks for the game you're viewing.

## Contact

Open an issue at <https://github.com/gislost/GrayCoach/issues>.
