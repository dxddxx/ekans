# EKANS

A reverse game of Snake. The serpent hunts on its own. You only choose where the apple appears, and you win by making its pathing crash it into a wall or into its own body.

EKANS is snake, spelled backward. It is a single static page: HTML, CSS, and JavaScript. Opening `index.html` is enough. Nothing is built, and nothing is sent anywhere.

## Run it

Open `index.html` in a browser.

Or serve the folder and play from there:

```bash
python3 -m http.server 8741
```

Then visit `http://127.0.0.1:8741`.

Styles, scripts, the favicon, and the fonts are relative paths (`css/style.css`, `js/ai.js`, `favicon.svg`, `../fonts/...` from the stylesheet). The same files open from `index.html` and from a project site such as `https://dxddxx.github.io/ekans/`.

A push to `main` runs `.github/workflows/pages.yml`, which publishes that folder with GitHub Actions. In the repo, set Pages to deploy from GitHub Actions (Settings → Pages → Build and deployment → Source: GitHub Actions). On a private personal repository, GitHub Pages requires GitHub Pro.

The scripted traps below are also checked by:

```bash
node test/play.cjs
```

## Rules

The garden is a 15×15 board. The snake starts in the center, length 3, facing right. North is toward the top of the screen.

- Click or tap an empty square to plant an apple. The snake will not move until one exists.
- It then steps, on its own, toward that apple. Eating grows it by one, the usual way.
- While it is hunting, click another empty square to **queue** the next apple (drawn as a hollow apple). Click a different square to move the queue. Click the queued square again to clear it.
- When it eats, a queued apple becomes the target immediately and the snake keeps moving. If the queue is empty, the snake **stops** until you plant the next one.
- The clock runs only while the snake is moving. Waiting is free.
- If its head crawls onto the queued square before it has eaten the current apple, that queued apple is destroyed.
- A red mark is the square it is about to enter when that step kills it. A small brass dot is a safe next step.
- **You win** when the head runs off the board or into its body. The tail square is empty by the time the head arrives, unless this step is the bite that makes it grow.
- **You lose** when it finishes the level's allotment of apples and is still alive. That last bite is the escape. A queued trap does not get a chance after it.

### Why it waits instead of using a placement timer

EKANS is a puzzle about reading a path. A timer on the apple would punish looking, and the later snakes need to be looked at. The queue is there when you already know the next square: the snake never has to pause. An empty queue is the thinking version of the same rule, and the clock pauses with you. The pressure is the row of pips, not a countdown.

Speed is squares per second, from 2 to 14. Restart, mute, and the four snakes are buttons; `R`, `M`, `-`/`=`, and `1`–`4` do the same from the keyboard.

Beating a snake unlocks the next one, and your shortest kill (fewest turns) is remembered in this browser.

## The snakes

Each brain is one object in `js/ai.js`. They all receive the same view of the board and return a direction: `N`, `E`, `S`, or `W`. A direction that leaves the board or enters the body is legal to *return* — the garden then kills the snake. Careful moves refuse a 180° turn into the neck. A lunge is allowed to take that turn, and dying that way counts as biting itself.

Squares below are numbered from the top-left. Column 1, row 1 is the corner. The opening head is column 8, row 8.

Let the snake finish each apple and stop before you plant the next one. The recipes below are written for that rhythm.

### 1 · Tunnel Vision

**Escape:** 8 apples.

It compares the horizontal and vertical distance to the apple and steps along the longer axis first. A tie prefers horizontal. It never checks the square it is about to enter, so its body and the walls are invisible. It will not reverse into its neck. When the apple is straight behind it, every toward-apple step *is* that reversal, so it turns **left** and commits — including off the board.

**Flaw.** Blind, with a deterministic panic turn.

**A reliable kill.**

1. Plant column 8, row 1 (the top of the snake's column). It climbs and stops facing up.
2. Plant the square immediately to the right of its head. It sidesteps, eats, and stops on the top row facing right.
3. Plant the nearest empty square to its left on that same row. Its body occupies the square directly left, so the apple is the one after that. The apple is straight behind it. It turns left, off the top of the board.

### 2 · Short Leash

**Escape:** 10 apples.

It ranks the three non-reversing directions by which neighbor is closest to the apple, then prefers straight, then left. It skips a neighbor that is off the board or currently occupied. **The tail counts as occupied**, even though that square is about to empty. It does not look any farther than that one square. If every neighbor was skipped, it lunges onto the closest square to the apple, reversal included. If it ever walks a full garden (225 steps) without a bite, it lunges the same way.

**Flaw.** One square of sight, and it will not follow its own tail out of a gap. Each step of a trap can look fine.

**A reliable kill,** the corner plug. This also kills Shortcut and Warden.

1. Plant column 2, row 1. It comes along the top and stops there, facing left.
2. Plant directly under the head.
3. Plant directly left of the head.
4. Plant directly above the head, into the corner.
5. Plant anywhere else, such as column 5, row 5.

The head is now in the corner. The only indoor neighbors are its neck and a curl of its own body. It lunges and bites itself. Four apples are eaten; the fifth is the one it dies chasing.

Tunnel Vision cannot follow this route. It arrives at column 2, row 1 facing up, with its body already on the next square. Use the top-row turn for that snake.

### 3 · Shortcut

**Escape:** 12 apples.

Every step it runs a breadth-first search from the head to the apple and takes the first step of a shortest path. Every segment except the tail is a wall for that search. The tail's square is treated as already empty, and the rest of the body is treated as frozen: the search does not rehearse the body sliding forward or growing when the apple is eaten. The first step will not be a U-turn. If the search finds no path, it lunges, through flesh or off the board.

**Flaw.** It only asks whether a path exists *right now*. It will follow the apple into a pocket one safe step at a time, because each of those steps still has a path, and it never asks whether it can leave after the bite. Once the apple is actually cut off, it hurls itself at the blockage instead of holding still. Pretending the tail is already gone is the other lie in the search; on a normal chase the tail really does leave, so the lie shows up when a bite would have kept it.

**A reliable kill.** The same corner plug as Short Leash. After the fourth bite the outside apple has no path, and the lunge hits the body in the doorway.

### 4 · Warden

**Escape:** 14 apples.

It starts from Shortcut's search, then keeps a second opinion. A step is acceptable when it is not an immediate collision (here the tail is allowed to count as empty, which is the real rule) **and** a rehearsal can still reach the tail afterward. Among those steps it prefers the one on the shortest path. The rehearsal **always moves the tail**, including on the bite, when the real tail stays where it is. Two exceptions throw the caution out:

- **Hunger.** If the apple is within 4 Manhattan squares and this is the first step since it appeared, Warden moves exactly like Tunnel Vision for that step only.
- **Temper.** If no path to the apple exists, or it has wandered a full garden without eating, it lunges.

**Flaws.** The blind first step is Tunnel Vision's whole personality in a four-square radius, including the left turn off the board. A cut-off apple triggers the lunge, so the corner plug works too. The tail rehearsal can also bless a bite that seals the last gap, because it imagines the tail leaving.

**A reliable kill,** the same three plants as Tunnel Vision. The killing apple lands two squares behind the head, inside the hunger radius, and it is the first step of that chase, so the left turn happens immediately. Plant that apple five or more squares farther left and Warden wakes up, walks around its body, and lives. That distance is the whole difference from level 1.

The corner plug kills Warden as well: once the head is boxed, the outside apple has no path, and temper takes over.

## Adding a snake

Append an object to `levels` in `js/ai.js`:

```js
{
  id: 5,
  name: 'New Snake',
  epithet: 'Short label',
  tell: 'Two sentences the player can read beside the board.',
  escapeApples: 16,
  decide: function (view) { return 'E'; }
}
```

`decide` must not mutate `view`. Return `N`, `E`, `S`, or `W`. The selector, the pips, the unlock order, and the keys `1`–`9` all read this list. Beating the previous snake unlocks the new one. `view` contains `head`, `body` (head at index 0, tail at the end), `apple`, `direction`, `cols`, `rows`, `applesEaten`, and `stepsSinceApple` (0 on the first step after an apple appears).

Movement, growth, the queue, and death live in `js/engine.js`. The page is `js/game.js` and `css/style.css`.
