# WordCraft Project Planning Document v1.5

> **中文版文档**：[README-zh.md](README-zh.md)
> **技术架构文档**（面向开发者）：[docs/architecture.md](docs/architecture.md)
> **项目交接文档**（现状/坑/下一步）：[docs/handoff.md](docs/handoff.md)

## Overview

**WordCraft (言筑)** is an open-source, pure front-end web application focused on rapidly generating 3D spatial structure models through natural-language conversation. The project follows a minimalist design philosophy, emphasizing accuracy of structural parameters and spatial planning over complex visual rendering.

> 🚀 **Live v1.0.0**: https://joyfish666.github.io/WordCraft/ (GitHub Pages, no backend, all data stays local)

### Core Features

- 🚀 **Text-to-3D**: Automatically generate hierarchical spatial models from natural-language descriptions
- 🎨 **Minimalist Visuals**: Focus on structure and dimension information, free from the burden of shading and materials
- 🔧 **Precise Editing**: Dual editing modes of property panel + Gizmo assistance
- 🔒 **Privacy First**: Pure front-end architecture, local data storage, user-controlled API Keys
- 📤 **Easy Sharing**: One-click generation of HD design images and data codes
- 🌐 **Open Collaboration**: Transparent development and community contribution on GitHub

### Technical Highlights

- Pure front-end architecture, no backend server required
- Declarative 3D scenes built with React Three Fiber
- Lightweight state management with Zustand
- Structured data validation with Zod
- Efficient data compression with lz-string

## Principles & Constraints

- **Product form**: Web application, pure front-end, open source
- **Data storage**: User conversations, API Keys, and model data are all stored in local browser storage
- **API management**: Users fill in their own LLM API Key (supports OpenAI/DeepSeek/LocalAI and other compatible endpoints)
- **Model representation**: Models consist of hierarchical containers and sub-modules (e.g., house → rooms → furniture)
- **Visual strategy**: Minimalist wireframe and color-block style, focusing on model structure and dimensions
- **Target users**: Geeks, interior-design beginners, and practitioners needing rapid spatial reasoning
- **Sharing mechanism**: Share via generated HD images with a code/QR watermark

## Feature Specification

### Home

#### Conversation Generation
- Users describe requirements in natural language (e.g., "design me a 3×3 meter bedroom with a double bed")
- The LLM generates corresponding hierarchical JSON data
- Multi-turn conversation supported to progressively refine design details

#### Model Display
- **3D view**: CAD-style rotate / zoom / pan
- **2D view**: One-click switch to top-down plan view ✅ implemented (v1.1, see "Current Implementation Progress")
- **Dimension display**: When a module is selected, its length/width/height and volume are shown in real time

#### Connectivity Detection
- Automatically checks API Key validity before starting a conversation
- On failure, prompts the user to visit Settings to troubleshoot

### Model Browsing & Interaction

#### Hierarchical Model Structure
- Drill down and navigate back level by level (house → room → furniture)
- Each container lists its sub-modules

#### Color Marking System
- **House mode**: Adjacent rooms distinguished by different color blocks
- **Focus mode**: Clicking into a room removes the room's background color, focusing on the interior furniture layout
- Support toggling between standard mode and colorblind mode in Settings

#### Breadcrumb Navigation
- Breadcrumb path at the top (e.g., House / Master Bedroom / Bed)
- Click any level to jump quickly

### Manual Editing Mode (Core Interaction Strategy)

Implemented in two phases to balance precision and intuitiveness:

#### Phase 1: Property Panel (V1.0 required - precise control) ✅ implemented
- **Trigger**: Click any module (furniture/wall) in the 3D scene
- **Interface**: A property panel slides out from the right
- **Function**: Shows the module's parameters (name, length, width, height, X/Y/Z coordinates)
- **Operation**: Users modify values in input boxes; on Enter or blur, the 3D scene updates in real time
- **Advantage**: CAD-like habits, satisfying hard requirements for precise dimension design
- **Extras**: position nudging with an adjustable step (0.1 / 0.5 / 1 m), a "reset position" that returns to the load-time snapshot, and **undo / redo** (toolbar buttons or Ctrl+Z / Ctrl+Y / Ctrl+Shift+Z)

#### Phase 2: Gizmo Assistance (V2.0 iteration - intuitive interaction)
- **Trigger**: After selecting a module, a 3D coordinate gizmo appears at its center
- **Interface**: Manipulation handles based on TransformControls
- **Function**: Drag arrows to move objects, drag boxes to resize
- **Data linkage**: While dragging, Zustand global state updates in real time, and the property panel reflects the values

### Model Management

#### New / Reset Design
- One-click clear of the current scene to start fresh

#### Local Project Library
- Save multiple designs to browser local storage (IndexedDB) ✅ implemented (v1.1)
- List, switch, delete, and rename operations ✅
- Manual-save model: toolbar "保存" + "项目库" dialog; unsaved changes are confirmed before switching / loading sample / clearing

#### Data Export
- Export raw JSON for secondary development
- Export standardized model description text

### Sharing & Collaboration

#### Screenshot Sharing
- **One-click screenshot**: Generate a high-resolution PNG from the current 3D view
- **Smart watermark**: The share code or QR is auto-attached to the bottom-right
- **Scene cleanup**: Auxiliary elements (grid, gizmo, selection box) are auto-hidden during capture

#### Code Mechanism
- Compress JSON into a short code with lz-string
- Pasting a code fully restores the model
- Copy and history support

### Settings

#### API Key Configuration
- Custom Base URL support (for proxies or local models)
- Manage and switch multiple API Keys
- Real-time API Key connectivity detection

#### Visual Preferences
- Toggle standard / colorblind mode
- Adjust wireframe thickness and display precision
- Custom color themes

## Recommended Tech Stack

| Layer | Choice | Notes |
|-------|--------|-------|
| Frontend | **React 18** | Componentized, mature ecosystem, good for open source |
| 3D Rendering | **React Three Fiber** | Declarative Three.js wrapper, build 3D scenes with React components |
| 3D Interaction | **@react-three/drei** | OrbitControls, TransformControls (Gizmo editing), etc. |
| State | **Zustand** | Lightweight global state for editor-style apps |
| Validation | **Zod** | Define the JSON Schema of LLM output, ensure data correctness |
| Local storage | **IndexedDB (Dexie.js)** | Store large model data and user config |
| Compression | **lz-string** | Efficient JSON compression |
| Screenshot | **R3F Canvas Snapshot** | Capture WebGL buffer directly for lossless 3D images |
| HTTP | **Axios** | API requests with interceptors and error handling |
| Build | **Vite** | Fast dev/build tooling |
| Linting | **ESLint + Prettier** | Consistent code style |
| Testing | **Vitest + Testing Library** | Unit and component tests |

## Development Workflow & Versioning

### GitHub Collaboration

#### 1. Repository
- **URL**: https://github.com/joyfish666/WordCraft.git
- **Branches**:
  - `main`: stable releases
  - `develop`: main development branch
  - `feature/*`: feature branches
  - `bugfix/*`: bug-fix branches

#### 2. Contribution Flow
1. **Fork** the repository
2. **Branch**: `git checkout -b feature/amazing-feature`
3. **Commit**: `git commit -m 'feat: add amazing feature'`
4. **Push**: `git push origin feature/amazing-feature`
5. **Open a Pull Request**

## Roadmap

### Phase 0: Base Architecture
- [x] Project initialization and GitHub repo setup
- [x] React + R3F base environment
- [x] API Key local storage & detection
- [x] Basic 3D rendering (grid, axes)
- [x] Dev environment & linting tools

### Phase 1: Generation & Display MVP
- [x] LLM API integration with Zod schema
- [x] "Conversation-to-JSON" core feature
- [x] Parse JSON and build hierarchical models in R3F
- [x] Click-to-drill-down and breadcrumb navigation
- [x] Color mode switching (colorblind / standard)
- [x] Basic user-interaction tests

### Phase 2: Editing & Interaction V1.0
- [x] Property panel editing
- [x] Local project save & switch
- [x] Model connectivity detection
- [ ] Mobile basic adaptation
- [x] Unit & integration tests
- [x] Release v1.0.0 (GitHub Pages: https://joyfish666.github.io/WordCraft/)

### Phase 3: Experience Optimization V2.0
- [ ] Gizmo-assisted editing (TransformControls)
- [ ] Data linkage (drag ↔ property panel)
- [ ] Screenshot sharing
- [ ] Performance & UX optimization
- [ ] Documentation & examples
- [ ] Release v2.0.0

### Phase 4: Advanced Features (continuous)
- [ ] More LLM providers
- [ ] Collaborative editing
- [ ] Plugin system
- [ ] Native mobile app
- [ ] AI design suggestions

## Current Implementation Progress (as of 2026-08)

Beyond the checked roadmap items above:

- **v2 Semantic Layout Engine**: the LLM no longer outputs absolute coordinates, but a *semantic contract* (room list + dimensions + arrangement intent) that code lays out deterministically —
  - `auto / corridor`: corridor runs east–west with rooms on both sides; the entrance room (living) is forced to the south and placed first
  - `auto / living`: living room centered, other rooms arranged around it
  - `custom`: for explicitly unconventional layouts, keeps the LLM's free coordinates with code fallback
  - The layout mode is auto-selected by the LLM based on the user's request
- **Nested sub-rooms (en-suite bathrooms)**: when the user says "bedroom has a bathroom inside", the bathroom renders *inside* the bedroom (not flattened to a neighbor); placed in the parent's **corner** on the corresponding `side` (north/south/east/west) or in the NE corner by default; position auto-constrained within the parent; **the door opens toward the parent's interior**
- **Precision geometry layer**: house bounding box auto-centered; furniture relative to room center, auto-clamped inside walls; walls rendered as **segments by adjacency** (solid / door / open), with uncovered parts of partially-shared walls rendered as exterior walls — no openings to the outside except the front door
- **Walls & doors**: solid floors + solid walls (door openings full height, equal to wall height); open spaces (living/dining/kitchen) have no wall to the corridor; **private rooms (bedrooms/study) connect only to the corridor, not directly to open spaces (kitchen/living)** and not to each other; **bathrooms open only to their owner room** (master-bathroom → master bedroom, corridor-bathroom → corridor), and **public/shared bathrooms open to the corridor**; shared walls deduplicated and colored by room, corridor uses default color
- **Front door**: forced on the entrance room's south exterior wall, centered, rendered as a **prominent warm door leaf + bright yellow marker** (the only exterior opening)
- **Camera & compass**: initial 45° south view facing the front door; arrow keys / WASD pan the view, reset view; a **real-time N/S/E/W compass** in the viewport's top-right corner (N points to world north)
- **Interaction**: click a room to enter focus mode (interior furniture solid, other rooms ghosted); **click to select furniture/parts inside a room** and show their info; breadcrumb navigation; selected modules show dimensions + **center X/Z coordinates**
- **Manual editing (property panel)**: click any module → the panel slides out on the right; edit name / length / width / height / X·Y·Z, committed on Enter or blur, changes auto-constrained inside walls; position nudging with an adjustable step; "reset position" returns to the load-time snapshot
- **Undo / redo**: snapshot-based history (session-only, capped at 50 steps); toolbar buttons or Ctrl+Z / Ctrl+Y / Ctrl+Shift+Z; loading a new model clears history
- **Furniture conventions**: at generation (auto layouts) wall-anchored furniture (beds / wardrobes / cabinets / desks / sofas...) snaps flush to its **nearest wall** with the **larger face against the wall** (long side along the wall, rotating by swapping length/width when needed), then **slides along the wall to avoid nested sub-rooms** (e.g. an en-suite bathroom), **room doorways** (extracted from the same wall plan, incl. the front door) and previously placed furniture; free-standing pieces (coffee table / dining table / chairs...) stay where placed, only clamped inside walls — code-level fallback so "bed against the wall, not blocking the door" no longer depends on the model following the prompt
- **Debug log**: de-duplicated (the duplicated parsed-JSON dump is skipped when the reply is already pure JSON, and the noisy per-render front-door log is removed), with a **download** button in the debug panel that saves a `.log` file
- **Nudge directions follow the compass**: at the default south view world +x projects to the screen-left, so the property panel's 东/西 nudge buttons map to world −x / +x to match the compass (北=+z, 南=−z)
- **Conversation generation**: SSE streaming (compatible with reasoning models' long thinking), multi-turn modification, deep-thinking toggle (fast / deep / follow-model)
- **Debug mode**: toggle in Settings; logs request params / raw LLM reply / v2 parse / layout result, copyable from a panel on the Home page
- **v1.0.0 release**: first stable release on 2026-08-05, deployed to GitHub Pages (`vite base=/WordCraft/` + GitHub Actions auto build & deploy); 86 tests green, lint/build pass
- **Local project library (v1.1.0)**: Dexie (IndexedDB) stores multiple designs; toolbar "保存" writes the scene to the current project, "项目库" dialog supports new / open / rename / delete; unsaved changes are confirmed before switching / loading sample / clearing; the active project survives reload
- **2D top-down plan view (v1.1.0)**: "3D / 平面图" toggle at the viewport's top-left; orthographic top-down camera (north up, pan + zoom only, auto-framed to the house); per-room "name W×L" labels colored exactly like 3D; overall "length / width" dimension lines outside the house outline; selection / focus syncs with 3D
- **v1.1.0 release**: on 2026-08-05 adds the project library and 2D plan view; tests grow to 109, all green, lint/build pass

## License

MIT — see the [LICENSE](LICENSE) file.

## Contact

- Project: https://github.com/joyfish666/WordCraft
- Issues: https://github.com/joyfish666/WordCraft/issues
- Discussions: https://github.com/joyfish666/WordCraft/discussions

---

**Last updated**: 2026-08-05
**Doc version**: v1.10
**Maintainer**: JoyFish
