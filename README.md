<h1 align="center">Dify as Code</h1>

<p align="center">
  <strong>🚀 Manage Dify apps as code — Harness AI coding assistants to build, optimize, and version control your workflows.</strong>
</p>

<p align="center">
  <a href="https://marketplace.visualstudio.com/items?itemName=prom-ai.dify-as-code">
    <img src="https://img.shields.io/visual-studio-marketplace/v/prom-ai.dify-as-code?label=VS%20Code%20Marketplace&logo=visual-studio-code&logoColor=white" alt="VS Code Marketplace">
  </a>
  <a href="https://github.com/prom-ai/dify-as-code">
    <img src="https://img.shields.io/github/stars/prom-ai/dify-as-code?style=social" alt="GitHub Stars">
  </a>
  <a href="https://github.com/prom-ai/dify-as-code/blob/main/LICENSE">
    <img src="https://img.shields.io/github/license/prom-ai/dify-as-code" alt="License">
  </a>
</p>

---

## 🤔 Why Dify as Code?

Building AI apps with [Dify](https://dify.ai) is amazing, but managing them in a browser has limitations:

| Pain Point | With Dify as Code |
|------------|-------------------|
| 😫 Editing in a tiny web textarea | ✨ Full IDE power with VS Code / Cursor |
| 🔄 No version history | 📚 Git tracks every change with full history |
| 🤖 Can't use AI to build workflows | 🚀 **Let AI assistants create & optimize entire workflows** |
| 👥 Hard to collaborate | 🤝 Standard Git workflows: branch, PR, merge |
| 💾 No backup | 🔒 Local files = your backup |
| 🏢 Managing multiple instances | 🌐 One place for all platforms & accounts |

**Dify as Code** brings the "Infrastructure as Code" philosophy to Dify — your app configurations become versionable, reviewable, and collaborative text files.

---

## ✨ Key Features

### 🔄 Bi-directional Sync
Pull app configurations (DSL) from Dify to local files, edit with your favorite tools, then push changes back. Your local `app.yml` is the single source of truth.

### 🏢 Multi-Platform & Multi-Account
Manage Dify Cloud, self-hosted instances, and multiple accounts — all from one sidebar. Switch between environments effortlessly.

### 📊 Smart Sync Status
Visual indicators show what's changed:
- ✅ **Synced** — Local matches cloud
- ⬆️ **Local Modified** — You have unpushed changes  
- ⬇️ **Remote Updated** — Cloud has newer version

### 🔐 Secure by Design
Credentials stored in `.secrets.yml` are automatically added to `.gitignore`. Your passwords never get committed.

### 🤖 AI-Powered Development
Dify's DSL is just YAML — and AI understands it perfectly. With AI coding assistants (Cursor, GitHub Copilot, etc.), you can:
- **Create entire workflows from scratch** — Describe what you want, AI generates the DSL
- **Optimize existing apps** — AI analyzes and improves your prompts and logic
- **Add new nodes & connections** — Let AI handle the complex YAML structure
- **Debug issues** — AI can spot problems in your workflow configuration
- **Translate & localize** — Convert prompts to other languages instantly

---

## 🚀 Quick Start

### 1. Install the Extension
Search **"Dify as Code"** in VS Code / Cursor Extensions, or install from VSIX.

### 2. Add Your Dify Platform
Click the **Dify as Code** icon in the Activity Bar → **[+]** → Choose platform type → Enter credentials.

### 3. Pull Your Apps
Apps are automatically pulled after login. Each app becomes a folder with `app.yml` inside.

### 4. Edit & Push
Modify `app.yml` with full IDE support → Right-click → **Push to Dify** → Changes sync to draft.

---

## 🔄 Workflow

```
┌─────────────┐     Pull      ┌─────────────┐      Edit       ┌─────────────┐
│   Dify      │ ───────────▶  │   Local     │  ───────────▶   │   VS Code   │
│   Cloud     │               │   app.yml   │                 │   / Cursor  │
└─────────────┘               └─────────────┘                 └─────────────┘
       ▲                             │                               │
       │                             │          Git Commit           │
       │         Push                │◀──────────────────────────────┘
       └─────────────────────────────┘
```

**Recommended Git Workflow:**
1. `git pull` — Get latest from team
2. Pull from Dify — Sync cloud changes
3. Edit locally — Use AI assistance
4. `git commit` — Save your changes
5. Push to Dify — Deploy to draft
6. Test & Publish in Dify UI

---

## 📋 Commands

| Command | Description |
|---------|-------------|
| **Add Platform** | Connect to Dify Cloud or self-hosted instance |
| **Add Account** | Add login credentials under a platform |
| **Pull Updates** | Download latest app configurations |
| **Push to Dify** | Upload local changes to cloud draft |
| **Copy as New App** | Duplicate an app with new name |
| **Open in Dify** | Jump to Dify editor in browser |
| **View Sync Status** | Check sync state and timestamps |

---

## 📁 Project Structure

```
your-workspace/
├── MyCompanyDify/                    # Platform
│   ├── .platform.yml                 # Platform config
│   └── dev@company.com/              # Account
│       ├── .account.yml              # Account config  
│       ├── .secrets.yml              # Credentials (gitignored)
│       ├── CustomerServiceBot/       # App
│       │   ├── app.yml               # ← Edit this file!
│       │   └── .sync.yml             # Sync metadata
│       └── SalesWorkflow/
│           └── ...
└── DifyCloud/
    └── ...
```

---

## 💡 Pro Tips

### Build Workflows with AI
Just describe what you want in natural language:
```
"Create a customer service workflow that:
1. Classifies user intent (complaint/inquiry/feedback)
2. Routes to different LLM prompts based on intent  
3. Generates a response and logs to database"
```
AI generates the complete `app.yml` — nodes, connections, prompts, everything.

### Optimize Existing Apps
```
"Analyze this workflow and suggest improvements for better accuracy and lower latency"
```
AI reviews your DSL and provides actionable suggestions.

### Version Control Best Practices
- Commit after each logical change
- Use meaningful commit messages: `"feat: add order tracking to chatbot"`
- Create branches for experimental prompt changes

### Team Collaboration
- Share platform configs (without `.secrets.yml`)
- Review prompt changes in Pull Requests
- Use Git blame to see who changed what

---

## 🛠️ Requirements

- VS Code 1.85.0+ or Cursor
- Node.js 18+ (for development)
- A Dify account (Cloud or self-hosted)

---

## 📄 License

MIT License — Use freely, contribute back!

---

## 🤝 Contributing

Issues and Pull Requests are welcome on [GitHub](https://github.com/your-repo/dify-as-code).

---

<p align="center">
  <strong>Build AI apps with AI — Let your coding assistant write your Dify workflows.</strong>
</p>
