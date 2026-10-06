# Basketball

A self-contained Three.js scene inspired by the supplied freeze frame. All code and procedural textures live in this folder. No runtime asset services or API keys are required.

Click or tap the ball to toss it. Hold briefly for a higher toss. You can catch and re-toss it in the air. Space also tosses; R resets. The scene has no visible UI.

## Run

```sh
cd gpt
npm ci
npm run dev
```

## Build and deploy to Netlify

```sh
npm run build
```

For a Netlify site connected to the repository, set **Base directory** to `gpt`, **Build command** to `npm run build`, and **Publish directory** to `dist`. The included `netlify.toml` sets the command, output folder, Node version, and asset caching. You can also deploy the contents of `gpt/dist` directly.

## Physics and rendering

- SI units: 0.12 m radius, 0.62 kg mass, 9.81 m/s² gravity.
- Fixed 960 Hz contact solver, independent of the display refresh rate.
- Compliant spring/damper impacts, approximately 0.77 coefficient of restitution, contact friction, rolling resistance, and stable rest.
- World-space, volume-preserving impact squash with damped recovery. Rotation is independent of deformation.
- Continuous recessed seams forming the traditional eight congruent panels, leather pebble bump, procedural hardwood with staggered planks/grain/knots, physical lighting, dynamic shadows, and height-dependent contact occlusion.
- Responsive portrait and landscape camera composition. The screenshot's portrait framing is the primary reference.

The ball is an ellipsoid deformation model driven by physical contact forces, rather than a full finite-element soft-body simulation.

## Verification

```sh
npm test
npm run build
```

Tests cover gravity, launch height, impact energy loss, floor contact, conserved deformation volume, frame-rate independence, stable settling, normalized rotation, and midair re-tossing. Seam tests additionally check the entire sphere for eight connected equal-area panels, continuous closed curves, correct intersections, symmetry, and uniform groove width.

For local six-sided visual inspection, open `/qa/seams.html` on the Vite dev server. This inspection page is not included in the production build.
