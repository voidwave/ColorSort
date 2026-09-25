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
- Color-blind symbols, keyboard controls (`1`–`0`, `Z`, `R`, `H`), progress saved automatically, installable as a PWA and playable offline.

## Development

The game is a static site with no build step:

```
python3 -m http.server   # then open http://localhost:8000
```

- `js/solver.js`: seeded RNG, level generation and the solver. It also runs under Node, e.g. `node -e "console.log(require('./js/solver.js').generate(require('./js/solver.js').levelConfig(10)))"`.
- `js/game.js`: rendering, input, animation, audio and progression.
- `css/style.css`: styles.
- `sw.js`: a network-first service worker for offline play.

## Deploying

GitHub Pages serves the repository root of `main` (Settings → Pages → Deploy from a branch → `main` / root). All asset paths are relative, so the site works under `/ColorSort/`.
