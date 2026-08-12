# WordCraft（言筑）

> A pure-frontend "text-to-3D" house designer — describe your home in one sentence, and an AI generates an editable 3D spatial model.

🚀 **Live demo**: <https://joyfish666.github.io/WordCraft/>

- Deployed on GitHub Pages · no backend · all data stays in the browser
- Click "示例" or an example chip on the empty-state card on first visit to load a ready-made house

📄 [中文 README](README-zh.md) · [Design](docs/design.md) · [Architecture](docs/architecture.md) · [History](docs/history.md) · [Dev Notes](docs/notes.md)

## Features

- 🚀 **Text-to-3D**: describe your requirements in one sentence (e.g. "three bedrooms, a living room and a kitchen, en-suite in the master"), the LLM outputs operation sequences (ops) and the code executes them deterministically; multi-turn chat only makes local changes
- 🔄 **Bidirectional sync**: manual edits (drag / resize) are recorded as an op log that flows back into the chat — the AI always works on your latest version
- 🎨 **Brand-new warm light UI**: paper-toned theme with a sidebar-free full-width canvas; a grouped toolbar (sample / clear / undo-redo / save / screenshot / help); a **bottom chat drawer** (collapses to just the input bar, no canvas space wasted); an **empty-state guide card** (one-sentence generation prompt + clickable example chips); a **draggable property panel**; when no API key is set, the empty state suggests loading the sample first
- 🧭 **Consistent directions**: world-anchored compass + corner compass; both 3D and the plan view share the same orientation — north up, west left, east right (standard map)
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
| HTTP | **Axios** | API requests with interceptors and error handling |
| Build | **Vite** | Fast dev/build tooling |
| Testing | **Vitest + Testing Library** | Unit and component tests (403 cases, run in CI) |

## Project Docs

| Doc | Content |
|-----|---------|
| [docs/design.md](docs/design.md) | Current design plan: v3 architecture (operation contract + footprint geometry + bidirectional sync + free plan editing, P1/P2/P3/P4 implemented) |
| [docs/architecture.md](docs/architecture.md) | Technical architecture of the current implementation (v3 footprint model + ops operation contract) |
| [docs/history.md](docs/history.md) | Key decisions across three generations of the architecture |
| [docs/notes.md](docs/notes.md) | Dev notes and pitfalls — read before touching the code |

## Local Development

```bash
npm install
npm run dev      # dev server, http://localhost:5173
npm run test     # Vitest unit tests
npm run lint     # ESLint
npm run build    # type check + build
```

## Roadmap

- [x] **v3 free design**: ~~P1 data model v3~~ (footprints + migration + window segments, ✅ done) → ~~P2 operation-contract generation~~ (op sequence + executor + prompt rewrite, ✅ done) → ~~P3 bidirectional sync~~ (edits flow back into chat + slimmed context, ✅ done) → ~~P4 plan-view editing~~ (drag vertices / move rooms / place doors & windows / split walls / merge rooms, all undoable, ✅ done)
- [x] **Mobile base adaptation** (landscape-only; portrait screens are prompted to rotate, ✅ done)
- [x] **2D plan enhancements** (furniture footprints / door symbols / dimension labels, ✅ done)
- [x] **Brand-new UI redesign** (warm light theme / no sidebar / bottom chat drawer / empty-state guide / draggable property panel / screenshot button, ✅ done)

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
