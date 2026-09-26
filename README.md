# Color Sort

A glowing, endlessly replayable color-sorting puzzle. Play it at **https://voidwave.com/ColorSort/**.

Tap a tube to pick up its top color, then tap another tube to pour. You can only pour onto the same color or into an empty tube. The level is won when every tube holds a single color.

## Features

- **Endless campaign** with a difficulty curve (3 → 12 colors, taller 5-block tubes later on). Every level is seeded, so level N is always the same puzzle.
- **Every level is solvable.** Each generated board is checked by a built-in A* solver, which also sets the level's par.
- **Star rating:** a live ★★★ tracker shows how many moves you have left to keep your stars.
- **Mystery levels** hide every block under `?` until it reaches the top of its tube.
- **Daily Challenge** has one harder puzzle per day and streak rewards.
- **Coins:** earn them by winning and spend them on hints (the solver shows the next move) or an extra tube. Undo is always free.
- **Game feel:** arcing pour animations, particle bursts, tube caps, combo shout-outs, confetti, synthesized sound effects and vibration.
- **Online leaderboards** backed by a Google Sheet. Each level and daily puzzle shows how many people solved it, the fewest moves, the best score, and a chart of how many players solved it in each number of moves. A Top players board ranks everyone by total score.
- Twelve easy-to-tell-apart colors, each with a letter for color-blind play. Keyboard controls (`1`–`0`, `Z`, `R`, `H`), progress saved automatically, installable as a PWA and playable offline.

## Development

The game is a static site with no build step:

```
python3 -m http.server   # then open http://localhost:8000
```

- `js/solver.js`: seeded RNG, level generation and the solver. It also runs under Node, e.g. `node -e "console.log(require('./js/solver.js').generate(require('./js/solver.js').levelConfig(10)))"`.
- `js/game.js`: rendering, input, animation, audio and progression.
- `css/style.css`: styles.
- `js/leaderboard.js`: the leaderboard client and panel.
- `js/config.js`: site settings, including the leaderboard URL.
- `apps-script/Code.gs`: the leaderboard backend (a Google Apps Script web app).
- `sw.js`: a network-first service worker for offline play.

When you change CSS or JS, bump the `?v=` tags in `index.html` so browsers never mix old and new files.

## Deploying

GitHub Pages serves the repository root of `main` (Settings → Pages → Deploy from a branch → `main` / root). All asset paths are relative, so the site works under `/ColorSort/`.

## Leaderboard (Google Sheets)

1. Create a Google Sheet and open **Extensions → Apps Script**.
2. Replace the contents of `Code.gs` with [`apps-script/Code.gs`](apps-script/Code.gs) and save.
3. **Deploy → New deployment → Web app**, set *Execute as: Me* and *Who has access: Anyone*, then authorize it.
4. Copy the `/exec` URL into `leaderboardUrl` in `js/config.js`.

To ship a code change later, use **Deploy → Manage deployments → Edit → Version: New version**. That keeps the same URL.

- Scores are stored in the `Scores` tab. It is created automatically with these columns: Timestamp, Board (`L12` or `D2026-09-26`), PlayerId, Name, Moves, Seconds, Score, Par, Hints, ExtraTube.
- The spreadsheet gets a **Color Sort → Refresh summary sheets** menu. It writes a `Boards` tab (solvers, fewest moves, best score, and players per move count for each board) and a `Players` tab.
- Score = 1000 + 40 × (par − moves) − seconds (up to 600) − 100 per hint − 150 for the extra tube, with a minimum of 50.
- Scores are accepted as submitted. The server does not verify them.
