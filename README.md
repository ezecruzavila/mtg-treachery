# 🎴 MTG Treachery (LAN)

A homemade web app to play the hidden-role Magic: The Gathering variant
**[MTG Treachery](https://mtgtreachery.net)**. It secretly deals the identities
(Leader, Guardian, Assassin, Traitor) to each player on their phone. It does
**not run the Magic game itself** (life totals, turns, etc.): it only deals
roles secretly and keeps the session alive.

Meant to be played on the **same WiFi network**: run it on one computer and
everyone else joins from their phone by scanning a QR code.

## Requirements

- **Node.js 24 or newer** (uses the native `WebSocket`, `crypto` and `--watch`).
- All players on the **same local network** (WiFi).

## Running it

```bash
npm install
npm start
```

On startup, the console prints something like:

```
  On this machine:   http://localhost:3000
  Share on the LAN:  http://192.168.1.47:3000   ← share this one
```

- On **your** computer, open `http://localhost:3000`.
- **Everyone else** goes to the LAN URL (`http://192.168.1.x:3000`) or, more
  easily, scans the **QR code** shown in the room.

> The default port is `3000`. To change it: `PORT=4000 npm start`.

## Standalone executables (no Node install needed)

If you'd rather not run `npm start`, you can build double-click executables for
the **host** (the person who runs the server). Players still just scan the QR —
they never install anything.

```bash
npm run package
```

This produces, in `dist/`:

- `mtg-treachery-macos-arm64` — macOS (Apple Silicon)
- `mtg-treachery-macos-x64` — macOS (Intel)
- `mtg-treachery-win-x64.exe` — Windows

Double-click the one for your machine. It starts the server, prints a QR in the
console, and **opens your browser** at the host page automatically. Keep the
console window open — closing it stops the server.

**First-launch security warnings (the binaries are unsigned):**

- **macOS:** Gatekeeper blocks it the first time. Right-click the file → **Open**
  (or run `xattr -d com.apple.quarantine mtg-treachery-macos-arm64` once).
- **Windows:** SmartScreen shows "unknown publisher" → **More info → Run anyway**.

> The build runs on your Mac and cross-compiles all three (including the Windows
> `.exe`). The first `npm run package` downloads Node base binaries (~60 MB each),
> so it needs internet once; later builds are cached.

## Hosting from an Android phone (Termux)

Android can't run the executables, but it can run the server from source using
**[Termux](https://termux.dev)** (a terminal app):

```bash
pkg update && pkg install nodejs git      # Termux's package manager
git clone <repo-url> mtg-treachery
cd mtg-treachery
npm install
npm start
```

Then share the printed LAN URL / QR. Tips:
- The phone must be on the same WiFi as the players.
- Run `termux-wake-lock` so the server keeps running when the screen locks.

## How to play

1. Someone opens the app, enters their name and taps **Create room** → a **4-letter code** and a **QR code** appear.
2. Everyone else scans the QR (or types the code) and enters their name.
3. Once everyone is in (**4 to 8 players**), whoever created the room taps **Start**.
4. Each player sees **their card face down**: tap it to flip it and see your role; tap again to hide it.
   - It **hides itself** after 10 seconds or when the phone locks / the app goes to the background.
   - The **Leader** is marked publicly for everyone (it's open information in the game).
5. When you use your **Unveil** ability at the table, flip the **Unveil** switch:
   your card stays face-up on your screen. Announce your identity to the table **out loud** —
   the app doesn't tell the others. The switch is reversible (it only affects your own screen).

### Restart / End Game

While in the role view, whoever created the room has two extra controls:

- **Restart** — reshuffles the roles for the same players, no need to rejoin. Great for playing several games in a row. Everyone's card flips back down.
- **End Game** — closes the room; everyone returns to the start screen.

## Important notes

- **Reconnection:** if you refresh or close the browser, you get your same seat and same role back
  when you return (a token is stored in the browser). No need to rejoin.
- **Who starts the game:** only whoever created the room sees the **Start** button. If they
  disconnect for ~30 s before starting, control passes to the next player automatically; if they
  come back in time, they get it back.
- **Restarting the server = new game.** State lives in memory; if you kill the process, rooms are lost.
- **Roles are truly secret:** the server never sends a player another player's role. Not even the
  browser dev tools can reveal someone else's deal.

### macOS: firewall permission

The **first time** someone connects from another device, macOS may ask whether to allow incoming
connections for `node`. You must **allow it** so phones can reach the server.

## Rules: role distribution by player count

| Players | Leader | Traitor | Assassin | Guardian |
|:-------:|:------:|:-------:|:--------:|:--------:|
| 4 | 1 | 1 | 2 | 0 |
| 5 | 1 | 1 | 2 | 1 |
| 6 | 1 | 1 | 3 | 1 |
| 7 | 1 | 1 | 3 | 2 |
| 8 | 1 | 2 | 3 | 2 |

## Development

```bash
npm run dev     # auto-reload on edit (node --watch)
npm run lab     # same, and opens the multi-user lab in the browser
npm test        # dealing tests (official composition + randomness)
```

### Multi-user lab

Sessions live in `localStorage`, so two normal tabs on the same origin would
share a seat. The **lab** (`/lab`, or `npm run lab`) shows 4–8 phone frames in
one window. Each frame is a different player (`?slot=1` … `?slot=8` namespaces
the session).

- **Start table** — creates a room and seats everyone (Ann is the dealer).
- **Blank phones** — empty home screens so you can walk through create / join.
- **Pop out** — opens that player in a real window at phone size.

You can also emulate users without the grid: open
`http://localhost:3000/home?slot=alice` and `http://localhost:3000/home?slot=bob`
in two windows.

You can shorten the control-handover grace period for testing with
`DEALER_GRACE_MS=1000 npm start` (default is 30000 ms).

### Structure

```
server/
  index.js   http+ws startup, serves static files, discovers the LAN IP
  rooms.js   room/player state, reconnection and control handover
  deal.js    official role table + shuffling (Fisher–Yates with crypto)
  api.js     JSON HTTP endpoints
  ws.js      presence WebSocket + broadcasting the player list
public/
  index.html landing / create room
  join.html  join (QR target)
  room.html  lobby + "my role"
  lab.html   multi-user emulator (several phones in one window)
  app.js     session (localStorage), fetch and navigation
  room.js    socket, lobby, card flip and unveil
  lab.js     lab shell: seat N isolated iframes
  styles.css mobile-first styles
```

## Scope

This version does: create/join rooms, correct secret dealing, public Leader, card flip,
reversible personal unveil, reconnection, restart and end game.

Left out (possible future improvements): marking eliminated players, automatically computing
the winner, a Magic life counter, and persisting state to disk to survive restarts.
