# WordCraft（言筑）

> A pure-frontend "text-to-3D" house designer — describe your home in one sentence, and an AI generates an editable 3D spatial model.

🚀 **Live**: <https://joyfish666.github.io/WordCraft/>

- Deployed on GitHub Pages · no backend · all data stays local
- Auto-updated to the latest code on every push
- On first visit, click "加载示例" to load a ready-made house

📄 [中文 README](README-zh.md) · [Architecture](docs/architecture.md) · [Handoff](docs/handoff.md)

## Features

- 🚀 **Text-to-3D**: describe your requirements in one sentence (e.g. "three bedrooms, a living room and a kitchen, en-suite in the master"), the LLM outputs a semantic contract and the code lays it out into a 3D model deterministically
- 🎨 **Minimalist visuals**: wireframe + color blocks focused on structure and dimensions
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
| Testing | **Vitest + Testing Library** | Unit and component tests (190 cases) |

## Progress

- **v1.4.0**: furniture part models (13 kinds assembled by name, facing follows the wall) · balanced corridor layout · entrance-room preservation · furniture-completeness prompt
- **v1.3.0**: true embedded nested rooms · Gizmo editing · screenshot share + codes
- **v1.2.0**: bilingual UI (中文/EN)
- **v1.1.0**: local project library · 2D plan view
- **v1.0.0**: conversation generation · property-panel editing · undo/redo · GitHub Pages deploy

## Roadmap

- [ ] Mobile adaptation
- [ ] 2D plan enhancements (furniture footprints / door symbols / dimension labels)
- [ ] Performance, more furniture kinds
- [ ] Collaborative editing, more LLM providers

## Contributing

1. **Fork** the repo: https://github.com/joyfish666/WordCraft
2. **Branch**: `git checkout -b feature/amazing-feature`
3. **Commit**: `git commit -m 'feat: add amazing feature'`
4. **Push**: `git push origin feature/amazing-feature`
5. **Open a Pull Request**

Code style: follow ESLint + Prettier; make sure `npm test` passes.

## License

MIT — see the [LICENSE](LICENSE) file.

## Contact

- Project: https://github.com/joyfish666/WordCraft
- Issues: https://github.com/joyfish666/WordCraft/issues
- Discussions: https://github.com/joyfish666/WordCraft/discussions

---

**Last updated**: 2026-08-07 · **Maintainer**: JoyFish
