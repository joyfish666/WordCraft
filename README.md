# WordCraft（言筑）

> A pure-frontend "text-to-3D" house designer — describe your home in one sentence, and an AI generates an editable 3D spatial model.

🚀 **Live demo**: <https://joyfish666.github.io/WordCraft/>

- Deployed on GitHub Pages · no backend · all data stays in the browser
- Click "加载示例" on first visit to load a ready-made house

📄 [中文 README](README-zh.md) · [Design](docs/design.md) · [Architecture](docs/architecture.md) · [History](docs/history.md) · [Dev Notes](docs/notes.md)

## Features

- 🚀 **Text-to-3D**: describe your requirements in one sentence (e.g. "three bedrooms, a living room and a kitchen, en-suite in the master"), the LLM outputs operation sequences (ops) and the code executes them deterministically; multi-turn chat only makes local changes
- 🔄 **Bidirectional sync**: manual edits (drag / resize) are recorded as an op log that flows back into the chat — the AI always works on your latest version
- 🎨 **Minimalist visuals**: wireframe + color blocks focused on structure and dimensions
- 🧭 **Consistent directions**: world-anchored compass + corner compass + a standard plan view (north up, east right)
- 🔧 **Precise editing**: a property panel (exact values) + Gizmo handles (direct dragging), with undo/redo
- 🔒 **Privacy-first**: pure frontend, conversations / models / API keys all stay in the browser
- 📤 **Easy sharing**: one-click HD screenshot + a share code that fully restores the model
- 🌐 **Open source**: MIT licensed, contributions welcome

## Quick Start

1. **Add a key**: fill in your LLM API key in Settings (DeepSeek by default, OpenAI-compatible endpoints supported)
2. **Generate**: describe your needs in the home dialog → generate a 3D model; refine it through multi-turn conversation
3. **Edit**: click a room or piece of furniture in the scene → adjust dimensions/position in the property panel, or drag with the Gizmo
4. **Plan view**: toggle "3D / 平面图" in the top-left for a top-down view
5. **Share**: the "Share" toolbar button produces an HD screenshot + a share code; anyone can paste the code to restore the model

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
| Testing | **Vitest + Testing Library** | Unit and component tests (307 cases) |

## Project Docs

| Doc | Content |
|-----|---------|
| [docs/design.md](docs/design.md) | Current design plan: v3 architecture (operation contract + footprint geometry + bidirectional sync + free editing, P1/P2/P3 implemented) |
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

- [ ] **v3 free design**: ~~P1 data model v3~~ (footprints + migration + window segments, ✅ done) → ~~P2 operation-contract generation~~ (op sequence + executor + prompt rewrite, ✅ done) → ~~P3 bidirectional sync~~ (edits flow back into chat + slimmed context, ✅ done) → plan-view editing (draw walls / drag vertices / place doors & windows)
- [ ] Mobile adaptation
- [ ] 2D plan enhancements (furniture footprints / door symbols / dimension labels)
- [ ] More furniture kinds, performance tuning
- [ ] Collaborative editing, more LLM providers

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
