# WordCraft Project Planning Document v1.5

> **中文版文档**：[README-zh.md](README-zh.md)
> **技术架构文档**（面向开发者）：[docs/architecture.md](docs/architecture.md)

## Overview

**WordCraft (言筑)** is an open-source, pure front-end web application focused on rapidly generating 3D spatial structure models through natural-language conversation. The project follows a minimalist design philosophy, emphasizing accuracy of structural parameters and spatial planning over complex visual rendering.

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
- **2D view**: One-click switch to top-down plan view
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

#### Phase 1: Property Panel (V1.0 required - precise control)
- **Trigger**: Click any module (furniture/wall) in the 3D scene
- **Interface**: A property panel slides out from the right
- **Function**: Shows the module's parameters (name, length, width, height, X/Y/Z coordinates)
- **Operation**: Users modify values in input boxes; on Enter or blur, the 3D scene updates in real time
- **Advantage**: CAD-like habits, satisfying hard requirements for precise dimension design

#### Phase 2: Gizmo Assistance (V2.0 iteration - intuitive interaction)
- **Trigger**: After selecting a module, a 3D coordinate gizmo appears at its center
- **Interface**: Manipulation handles based on TransformControls
- **Function**: Drag arrows to move objects, drag boxes to resize
- **Data linkage**: While dragging, Zustand global state updates in real time, and the property panel reflects the values

### Model Management

#### New / Reset Design
- One-click clear of the current scene to start fresh

#### Local Project Library
- Save multiple designs to browser local storage (IndexedDB)
- List, switch, delete, and rename operations
- Auto-save to prevent accidental data loss

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
- [ ] Property panel editing
- [ ] Local project save & switch
- [x] Model connectivity detection
- [ ] Mobile basic adaptation
- [x] Unit & integration tests
- [ ] Release v1.0.0

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
- **Nested sub-rooms (en-suite bathrooms)**: when the user says "bedroom has a bathroom inside", the bathroom renders *inside* the bedroom (not flattened to a neighbor); placed against the parent's corresponding side via `side` (north/south/east/west), or in a corner by default; position auto-constrained within the parent
- **Precision geometry layer**: house bounding box auto-centered; furniture relative to room center, auto-clamped inside walls; walls rendered as **segments by adjacency** (solid / door / open), with uncovered parts of partially-shared walls rendered as exterior walls — no openings to the outside except the front door
- **Walls & doors**: solid floors + solid walls (door openings full height, equal to wall height); open spaces (living/dining/kitchen) have no wall to the corridor; private rooms (bedrooms/study) keep walls and doors and do not connect to each other; **bathrooms open only to their owner room** (master-bathroom → master bedroom, corridor-bathroom → corridor); shared walls deduplicated and colored by room, corridor uses default color
- **Front door**: forced on the entrance room's south exterior wall, centered, rendered as a **prominent warm door leaf + bright yellow marker** (the only exterior opening)
- **Camera & compass**: initial 45° south view facing the front door; arrow keys / WASD pan the view, reset view; a **real-time N/S/E/W compass** in the viewport's top-right corner (N points to world north)
- **Interaction**: click a room to enter focus mode (interior furniture solid, other rooms ghosted); breadcrumb navigation; selected modules show dimensions + **center X/Z coordinates**
- **Conversation generation**: SSE streaming (compatible with reasoning models' long thinking), multi-turn modification, deep-thinking toggle (fast / deep / follow-model)
- **Debug mode**: toggle in Settings; logs request params / raw LLM reply / v2 parse / layout result, copyable from a panel on the Home page

## License

MIT — see the [LICENSE](LICENSE) file.

## Contact

- Project: https://github.com/joyfish666/WordCraft
- Issues: https://github.com/joyfish666/WordCraft/issues
- Discussions: https://github.com/joyfish666/WordCraft/discussions

---

**Last updated**: 2026-08-05
**Doc version**: v1.5
**Maintainer**: JoyFish
