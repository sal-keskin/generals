# Tank Lab

A small top-down tank game for the browser: drive a 30-tonne tank around a 5 × 5 km world,
shoot barriers, barrels, trees and buildings, and hunt down the 15 red-and-white targets.

No build step, no dependencies — plain HTML, CSS and JavaScript (Canvas 2D + Web Audio).

## Play locally

Open `index.html` in a browser, or serve the folder:

```sh
python3 -m http.server 8000   # then open http://localhost:8000
```

## Controls

| Action | Keyboard / mouse | Touch |
| --- | --- | --- |
| Drive / reverse | `W` `S` or `↑` `↓` | Left stick |
| Skid-steer | `A` `D` or `←` `→` | Left stick |
| Brake (lock tracks) | `Shift` | Brake |
| Aim turret | Mouse (or `Q` `E`) | ◀ ▶ |
| Fire | Click, `Space` or `F` | FIRE |
| Zoom | Wheel, `+` `−` | — |
| Camera dead zone / speed zoom | `Z` / `X` | — |
| Full map · sound · reset · pause · help | `M` · `N` · `R` · `P` · `H` | Toolbar |

## The world

- **5 × 5 km map** (generated from a fixed seed, so it's the same every time) with rolling hills,
  contour lines and hill shading, a river with bridges, four lakes, and mountains around the edge.
- **Roads**: two highways crossing at a gridded town, country roads, village streets and dirt tracks.
  Roads are fast; grass, farmland, sand and water slow you down; slopes push back.
- **Buildings**: ~270 town blocks, village houses, a farm with a silo, hangars and barracks.
  Shells damage and eventually collapse them into burning rubble.
- **~60,000 trees** in forests and scattered across the fields. Ram them or shoot them down.
- **Demo barriers** at the training ground (spawn) and at roadblocks: concrete jersey barriers,
  concrete blocks, crates, explosive barrels (chain reactions!), dragon's teeth, sandbags and a brick
  compound. Props are rigid bodies: they slide, spin and get knocked around by shells and the tank.

## How the tank handles

The physics follows the classic 1996 2D vehicle model described in
[Pat Kerr's "2D Vehicles" write-up](https://patkerr.co.uk/2d-vehicles/) (reimplemented from the
description, no code copied):

- The hull is a single **2D rigid body** (position, velocity, angle, angular velocity). Forces applied
  away from the centre also produce torque.
- Each **track contact point** (four per track) measures its own velocity and splits it into a
  component along the track and one sideways. It resists rolling a little and sideways sliding a lot
  (with a grip limit, so the tank can still slide).
- Instead of steered wheels, the tank **skid-steers**: the left and right tracks are driven with
  different forces, and that difference is what turns the hull.
- Firing applies a recoil impulse at the turret ring. Collisions use SAT polygon contacts with
  impulses at the contact points, so off-centre hits spin things.

## Project layout

```
index.html          page + HUD
css/style.css       HUD / overlay styling
js/core.js          math, noise, rigid bodies, collision + contact solver, raycasts
js/tank.js          tank dynamics (track forces, turret, gun)
js/world.js         map generation + simulation (props, shells, explosions, effects)
js/render.js        Canvas renderer (terrain tiles, roads, buildings, trees, tank, minimap)
js/audio.js         synthesised engine / gun / explosion sounds
js/main.js          input, camera, HUD, game loop
assets/*.svg        self-made tank hull, turret and gun sprites + favicon
```

## Hosting (free)

**GitHub Pages** — this repo includes `.github/workflows/pages.yml`:

1. Push to the `main` branch.
2. In the repo go to **Settings → Pages** and set **Source** to **GitHub Actions**.
3. The game is published at `https://<user>.github.io/<repo>/`.

(Alternatively choose *Deploy from a branch → main / root* — no workflow needed.)

**Other free hosts** — it's a static folder, so any of these work by just uploading the repo:
Netlify (drag-and-drop the folder at app.netlify.com/drop), Cloudflare Pages, Vercel, or itch.io
(zip the folder and upload it as an HTML game with `index.html` at the root).
