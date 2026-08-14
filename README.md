# WordCraft（言筑）

> A pure-frontend "text-to-3D" house designer — describe your home in one sentence, and an AI generates an editable 3D spatial model.

🛑 **Recommended on desktop (PC)**: the app is built for desktop browsers — mobile gets only basic adaptations (landscape-only, compact layout). For the best experience, please use a computer.

🚀 **Live demo**: <https://joyfish666.github.io/WordCraft/>

- Deployed on GitHub Pages · no backend · all data stays in the browser
- Click "示例" or an example chip on the empty-state card on first visit to load a ready-made house

<p align="center">
  <img src="docs/images/screenshot-3d.png" alt="3D view — generated house with realistic materials" width="72%" />
  <br />
  <img src="docs/images/screenshot-plan.png" alt="2D plan view — editable room footprints" width="72%" />
</p>

📄 [中文 README](README-zh.md) · [Design](docs/design.md) · [Architecture](docs/architecture.md) · [History](docs/history.md) · [Dev Notes](docs/notes.md)

## Features

- 🚀 **Text-to-3D**: describe your requirements in one sentence (e.g. "three bedrooms, a living room and a kitchen, en-suite in the master"), the LLM outputs operation sequences (ops) and the code executes them deterministically; multi-turn chat only makes local changes
- 🔄 **Bidirectional sync**: manual edits (drag / resize) are recorded as an op log that flows back into the chat — the AI always works on your latest version
- 🎨 **Brand-new warm light UI**: paper-toned theme with a sidebar-free full-width canvas; a grouped toolbar (sample / clear / undo-redo / save / screenshot / help); a **bottom chat drawer** (collapses to just the input bar, no canvas space wasted); an **empty-state guide card** (one-sentence generation prompt + clickable example chips); a **draggable property panel**; when no API key is set, the empty state suggests loading the sample first
- 🧭 **Consistent directions**: world-anchored compass + corner compass; both 3D and the plan view share the same orientation — north up, west left, east right (standard map)
- 🏠 **House material & form layer (realistic)**: procedural materials (wood / tile / fabric / metal / exterior plaster…, zero external assets) auto-matched by room type and furniture kind; floors keep a subtle warm room-color tint while walls go neutral; skirting / door & window frames / exterior plinth details; **realistic lighting** (ACES tone mapping + procedural sky & horizon fog + environment reflections + soft shadows, all zero-asset); outdoor ground with an entrance stone path aligned to the door; **no roof — the interior is fully visible**; shadows are toggleable in Settings
- 🔧 **Precise editing**: a property panel (exact values) + Gizmo handles (direct dragging), with undo/redo; **free plan-view editing** (drag vertices to reshape / move rooms / click walls to place doors & windows / split & merge rooms — every action is undoable and flows back into the chat); **plan-view enhancements** (furniture footprints / door symbols / room dimension lines, with a one-click toggle for dimension annotations)
- 🔒 **Privacy-first**: pure frontend, conversations / models / API keys all stay in the browser
- 📱 **Mobile landscape support**: portrait screens are prompted to rotate; narrow landscape gets a compact layout with a plan toolbar split into dedicated "Tools" / "Dims" buttons and a smaller compass (desktop untouched)
- 📤 **Easy sharing**: one-click HD screenshot + a share code that fully restores the model; the toolbar "Screenshot" button downloads a watermark-free PNG
- 🌐 **Open source**: MIT licensed, contributions welcome

## Quick Start

1. **Add a key**: fill in your LLM API key in Settings (DeepSeek by default, OpenAI-compatible endpoints supported)
2. **Generate**: on the home page, click an example chip on the empty-state card (3+1 with kitchen / modern minimalist house / study studio), or type in the bottom drawer → generate a 3D model; refine it through multi-turn conversation
3. **Edit**: click a room or piece of furniture in the scene → adjust dimensions/position in the property panel (drag the panel by its header), or drag with the Gizmo
4. **Plan view**: toggle "3D / 平面图" in the top-left for a top-down view; in plan mode use the top-left toolbar to edit directly (move rooms / drag vertices / place doors & windows / split & merge)
5. **Share**: the "Share" toolbar button produces an HD screenshot + a share code; anyone can paste the code to restore the model
6. **Camera**: arrow keys / WASD to pan, R to reset the view

## Tech Stack

| Layer | Choice | Notes |
|-------|--------|-------|
| Framework | **React 18** | Component-based, mature ecosystem |
| 3D rendering | **React Three Fiber** | Declarative Three.js, React components build the scene |
| 3D interaction | **@react-three/drei** | OrbitControls (camera), TransformControls (Gizmo editing), etc. |
| State | **Zustand** | Lightweight global state for an editor app |
| Validation | **Zod** | JSON Schema for LLM output, keeps data correct |
| Storage | **IndexedDB (Dexie.js)** | Large model data and user config |
| Code compression | **lz-string** | Efficient JSON compression |
| HTTP | **fetch (streaming SSE)** | OpenAI-compatible chat completions, unified fetch stack |
| Build | **Vite** | Fast dev/build tooling |
| Testing | **Vitest + Testing Library** | Unit and component tests (700+, run in CI) |

## Project Docs

| Doc | Content |
|-----|---------|
| [docs/architecture.md](docs/architecture.md) | Technical architecture of the current implementation — single source of truth for "current facts" (v3 footprint model + ops operation contract) |
| [docs/design.md](docs/design.md) | Design decision record (historical): the v3 "free design" plan and rationale — all phases implemented |
| [docs/history.md](docs/history.md) | Key decisions across three generations of the architecture |
| [docs/notes.md](docs/notes.md) | Pitfall log (坑) — root causes and "don't regress" warnings; read before touching the code |

## Local Development

```bash
npm install
npm run dev      # dev server, http://localhost:5173
npm run test     # Vitest unit tests
npm run lint     # ESLint
npm run build    # type check + build
```

## Deployment (GitHub Pages)

Pushing to the `main` branch triggers `.github/workflows/deploy.yml` to build and deploy to GitHub Pages (tests run before the build; a red test suite blocks the deploy):

1. **First-time setup**: repo Settings → Pages → Source → **GitHub Actions**;
2. The bundle deploys at the project-site base path (`base=/WordCraft/` in `vite.config.ts`, repo name WordCraft);
3. Deep links (e.g. opening/refreshing `/WordCraft/settings` directly) are restored by `public/404.html` + the inline script in `index.html` (pitfalls 89/130); the restore keeps the base prefix (`BrowserRouter basename` derives from `import.meta.env.BASE_URL`), so the URL survives repeated refreshes;
4. **When changing the repo name or `base`**, update `pathSegmentsToKeep` in `public/404.html` accordingly (segment count = repo-name prefix segments; the `basename` in `src/main.tsx` follows `BASE_URL` automatically; see docs/notes.md pitfall 89/130).

Preview the production build locally: `npm run build && npm run preview`.

## Roadmap

- [x] **v3 free design**: ~~P1 data model v3~~ (footprints + migration + window segments, ✅ done) → ~~P2 operation-contract generation~~ (op sequence + executor + prompt rewrite, ✅ done) → ~~P3 bidirectional sync~~ (edits flow back into chat + slimmed context, ✅ done) → ~~P4 plan-view editing~~ (drag vertices / move rooms / place doors & windows / split walls / merge rooms, all undoable, ✅ done)
- [x] **Mobile base adaptation** (landscape-only; portrait screens are prompted to rotate, ✅ done)
- [x] **2D plan enhancements** (furniture footprints / door symbols / dimension labels, ✅ done)
- [x] **Brand-new UI redesign** (warm light theme / no sidebar / bottom chat drawer / empty-state guide / draggable property panel / screenshot button, ✅ done)
- [x] **House material & form layer + realistic lighting** (procedural textures / material classification / skirting·jambs·frames·plinth / sky·fog·env reflections·soft shadows / roof removed, ✅ done)

## FAQ

**Q: Where do I get an API Key?**
A: The app is pure front-end; you configure an OpenAI-compatible API Key yourself on the Settings page (DeepSeek by default). Keys stay in browser local storage (localStorage) and are never sent anywhere but the provider.

**Q: Room classification (corridor/bathroom) doesn't work in English UI?**
A: Room/furniture classifiers now ship **bilingual word lists** (corridor/open/private/bathroom detection, 20 furniture kinds, wall-anchored vs free-standing). In English UI the LLM receives an English system prompt and produces English names, which are matched by the English half of each word list. Boundary: classification depends on the name matching the word lists — unconventional compound names (e.g. "Master En-suite") or words outside the lists may miss. Chinese and English word lists are maintained in sync (`roomGeometry.ts` / `furniturePresets.ts` / `furniturePlacement.ts`).

**Q: Can I save and share the generated model?**
A: Yes. "Save" stores into the local project library (IndexedDB); "Share" generates a compressed code + watermarked screenshot — pasting the code restores the model (old versions auto-migrate).

## Contributing

1. **Fork** the repo: https://github.com/joyfish666/WordCraft
2. **Branch**: `git checkout -b feature/amazing-feature`
3. **Commit**: `git commit -m 'feat: add amazing feature'`
4. **Push**: `git push origin feature/amazing-feature`
5. **Open a Pull Request**

Code style: follow ESLint + Prettier; make sure `npm test` passes. Read the [dev notes](docs/notes.md) before changing code.

## License

MIT — see the [LICENSE](LICENSE) file.

## Contact

- Project: https://github.com/joyfish666/WordCraft
- Issues: https://github.com/joyfish666/WordCraft/issues
- Discussions: https://github.com/joyfish666/WordCraft/discussions
