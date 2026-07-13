<div align="center">

# Vela — AI Novel Writing IDE

**The next-generation AI-powered novel & fiction writing IDE for web novel authors, indie writers and creative professionals.**

[![React](https://img.shields.io/badge/React-19-blue.svg)](https://reactjs.org/)
[![Electron](https://img.shields.io/badge/Electron-41-black.svg)](https://www.electronjs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-6-3178C6.svg)](https://www.typescriptlang.org/)
[![License: GPL-3.0](https://img.shields.io/badge/License-GPLv3-yellow.svg)](https://opensource.org/licenses/GPL-3.0)

[Read in Chinese (中文)](README.md) | [Read in Russian (Русский)](README_RU.md)

[Download](#installation) | [Sponsor](#sponsor)

</div>

---

> **Vela** is an open-source, privacy-first, local-first AI writing IDE purpose-built for **novel writing**, **web fiction**, and **creative writing**. It deeply integrates LLM-powered workflows (outline generation, chapter drafting, intelligent rewriting, automated review) with a local RAG knowledge base, giving authors an IDE-level immersive creative experience — all running on your own machine with your own API keys (BYOK).

---

## Screenshots

|<img src="public/screenshot/1.png" width="800" alt="Vela AI Novel Writing IDE - Main Editor Interface"/>|
|:---:|
|*Immersive writing workspace with side-by-side AI panel, IDE-grade window management*|

|<img src="public/screenshot/2.png" width="800" alt="Vela AI Writing Workflow - Outline and Chapter Generation"/>|
|:---:|
|*End-to-end AI novel writing pipeline: from worldbuilding to chapter generation*|

<details>
<summary><b>More Screenshots</b></summary>
<br>

<img src="public/screenshot/3.png" width="800" alt="Vela AI Writer - Character Management and World Building"/>
<br/><br/>
<img src="public/screenshot/4.png" width="800" alt="Vela Novel IDE - AI Rewrite and Refinement Pipeline"/>
<br/><br/>
<img src="public/screenshot/5.png" width="800" alt="Vela Writing Tool - Local RAG Knowledge Base Search"/>
<br/><br/>
<img src="public/screenshot/6.png" width="800" alt="Vela Creative Writing IDE - Dark Theme Full View"/>

</details>

---

## Key Features

Vela is not just another chat-based text editor — it is a **production-grade novel writing engine** that deeply integrates LLM capabilities, long-context retrieval (RAG), and automated pipelines for fiction authoring.

### AI-Powered Novel Writing Pipeline

| Capability | Description |
|---|---|
| Worldbuilding | Custom global world settings, core plot axes, character profiles (with cross-chapter dynamic state tracking) |
| Auto Outline | One-click AI generation of "structural skeleton → chapter outlines → scene/emotion/rhythm requirements", supports Three-Act, Hero's Journey and other narrative structures |
| Chapter Drafting | Single-chapter streaming generation, accurately responding to prior context and preset outlines, can be stopped at any time |
| AI Rewrite | Supports paragraph-level or full-chapter rewriting while maintaining character and plot consistency |
| Refine | AI automatically detects grammar errors, typos, and logic gaps, outputting polished suggestions |
| Review | AI evaluates chapters from a reader/editor perspective, identifying pacing, character arc, and foreshadowing issues |
| Triple Post-Process Pipeline | Rewrite → Refine → Review three-stage chain ensuring high-quality chapter output |

### Million-Word Local RAG Knowledge Base

| Capability | Description |
|---|---|
| Bulk Import | One-click import of millions of words of reference novels, world settings documents, character setting collections |
| Vector Semantic Search | Automatically recalls the most relevant setting chunks based on current chapter semantics — say goodbye to character/setting inconsistencies |
| Pure Local Storage | Built-in SQLite + lightweight vector engine, all data stored locally, works offline |

### Extensible Architecture

| Capability | Description |
|---|---|
| BYOK (Bring Your Own Key) | Natively compatible with OpenAI, DeepSeek, Gemini, Claude, Ollama (local offline), Zhipu GLM, etc. Smart routing: use DeepSeek for outlines, Claude for polishing, local models for privacy review |
| MCP Protocol | Native Model Context Protocol integration, attach custom tool servers to extend AI capabilities |
| Usage Analytics | Built-in statistics panel for LLM calls, token consumption, and cost trends |

### IDE-Grade Productivity UI

| Capability | Description |
|---|---|
| Resizable Panels | File tree + editor + AI panel + bottom terminal, flexible combination like VSCode/JetBrains |
| Dark Theme | Optimized dark mode with custom floating title bar and status bar micro-interactions |
| Keyboard Shortcuts | Global shortcuts: Cmd+N new, Cmd+O open, Cmd+=/- zoom |
| Cross-Platform | macOS (dmg) / Windows (nsis) / Linux (AppImage) |

---

## Installation

### Direct Download

Go to [Releases](https://github.com/Izya12/vela/releases) to download the latest version for your OS:
- **macOS**: `.dmg` installer
- **Windows**: `.exe` installer (NSIS)

### Build from Source

```bash
# Requirements: Node.js >= 18, npm >= 9

# 1. Clone the project
git clone https://github.com/Izya12/vela.git
cd vela

# 2. Install dependencies
npm install

# 3. Start dev server (with hot reload)
npm run dev

# 4. Build for distribution
npm run build
```

> **Note**: You need build tools for native SQLite modules (macOS: Xcode Command Line Tools, Windows: Visual Studio Build Tools).

---

## Model Configuration

Vela supports multiple mainstream LLM providers. Quick setup:

1. Open the app → click **Settings** in the bottom-left
2. Go to **Model Configuration**
3. Click **Add Model**:
   - Select provider: OpenAI / DeepSeek / Gemini / Ollama / Zhipu / Custom
   - Fill in `API Key` and `Base URL` (if using a proxy)
   - Assign recommended models for different tasks (writing / polishing / Embedding retrieval)
4. **Start writing!**

**Supported LLM Providers:**

`OpenAI` · `DeepSeek` · `Google Gemini` · `Anthropic Claude` · `Ollama (Local)` · `Zhipu GLM` · `MiniMax` · `SiliconFlow` · `Any OpenAI-compatible API`

---

## Sponsor

Vela's open-source edition is driven by passion in spare time. If this tool has improved your writing efficiency or you see its commercial potential, feel free to sponsor! Your support is my biggest motivation to keep iterating.

---

## Tech Stack

| Layer | Technology |
|---|---|
| **UI Framework** | React 19 + TypeScript + Zustand |
| **Styling** | Tailwind CSS v4 + Radix UI + Lucide Icons |
| **Desktop** | Electron 41 + Vite 8 |
| **Local Storage** | better-sqlite3 (relational) + Lightweight vector engine (RAG) |
| **IPC** | Type-safe IPC channels |
| **AI Integration** | OpenAI-compatible + Gemini Protocol + MCP |

---

## Contributing

We welcome community contributions, including but not limited to:
- Bug fixes
- New AI provider adapters
- UI/UX improvements
- Internationalization (i18n) translations
- Documentation improvements

> For major feature refactors, please discuss with the author first in [Issues](https://github.com/Izya12/vela/issues) to avoid direction conflicts.

---

## License

This project is licensed under [GPL-3.0 License](LICENSE). You are free to run, study, share, and modify the code, but new software based on this modified distribution **must also be open-sourced under GPL-3.0**.

For closed-source commercial licensing, please contact the author via email.

---

<div align="center">

*Vela — Your AI-powered novel writing companion. Write smarter, not harder.*

</div>

<!--
  SEO Keywords:
  AI novel writing, AI writer, novel writing tool, fiction writing software,
  web novel, creative writing IDE, AI story generator, novel outline generator,
  RAG knowledge base, LLM writing assistant, Electron writing app,
  open source writing tool, DeepSeek writing, Claude writing, BYOK AI
-->
