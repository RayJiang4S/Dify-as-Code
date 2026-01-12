# Dify as Code Installation Guide

This document provides detailed instructions on how to install and run the Dify as Code extension in Cursor/VS Code.

## 📋 Prerequisites

Ensure your system has the following installed:

- **Node.js** >= 18.x
- **npm** >= 9.x
- **VS Code** >= 1.85.0 or **Cursor** (latest version)

### Check Node.js Version

```bash
node --version  # Should display v18.x.x or higher
npm --version   # Should display 9.x.x or higher
```

If Node.js is not installed, visit the [Node.js official website](https://nodejs.org/) to download and install.

---

## 🚀 Option 1: Development Mode (Recommended for Development Testing)

This is the simplest way to debug the extension directly in Cursor.

### Step 1: Open Project

1. Open Cursor
2. Select **File → Open Folder**
3. Select the `dify-as-code` folder

### Step 2: Install Dependencies

In Cursor's terminal, run:

```bash
npm install
```

### Step 3: Compile Project

```bash
npm run compile
```

### Step 4: Launch Extension Development Host

1. Press **F5** key (or menu **Run → Start Debugging**)
2. A new Cursor/VS Code window will open automatically
3. This new window is the **Extension Development Host**, where the extension is activated

### Step 5: Use Extension

In the Extension Development Host window:

1. Open any workspace folder (**File → Open Folder**)
2. Click the **Dify as Code** icon in the Activity Bar
3. Start using!

---

## 📦 Option 2: Package Installation (Recommended for Daily Use)

Package the extension as a `.vsix` file and install it.

### Step 1: Install vsce Tool

```bash
npm install -g @vscode/vsce
```

### Step 2: Install Dependencies and Compile

```bash
cd dify-as-code
npm install
npm run compile
```

### Step 3: Package Extension

```bash
npm run package
# or
vsce package
```

This will generate a `dify-as-code-0.1.0.vsix` file.

### Step 4: Install VSIX

**Method A: Via Command Palette**

1. Open Cursor/VS Code
2. Press `Cmd+Shift+P` (Mac) or `Ctrl+Shift+P` (Windows/Linux)
3. Type **Extensions: Install from VSIX**
4. Select the generated `.vsix` file

**Method B: Via Command Line**

```bash
# VS Code
code --install-extension dify-as-code-0.1.0.vsix

# Cursor (if cursor command is available)
cursor --install-extension dify-as-code-0.1.0.vsix
```

### Step 5: Restart Cursor

After installation, restart Cursor to activate the extension.

---

## 🔄 Updating Extension

### Development Mode

1. After modifying code, run `npm run compile` in terminal
2. In Extension Development Host window, press `Cmd+Shift+P`, type **Developer: Reload Window**

Or use watch mode for automatic compilation:

```bash
npm run watch
```

### VSIX Installation

1. Repackage: `npm run package`
2. Uninstall old version: **Extensions → Find Dify as Code → Uninstall**
3. Install new version (same as Step 4 above)

---

## 🛒 Option 3: Install from Marketplace (Coming Soon)

> 🚧 Extension will be published to VS Code Marketplace soon

Once published, search for **"Dify as Code"** in the Extensions Marketplace to install.

---

## 🐛 Troubleshooting

### Q: Pressing F5 doesn't work?

Make sure:
1. All dependencies are installed (`npm install`)
2. Project is compiled (`npm run compile`)
3. `.vscode/launch.json` file exists

### Q: Can't find Dify as Code icon?

1. Check if extension is activated: **Extensions → Search Dify as Code**
2. Try restarting Cursor/VS Code
3. Open a workspace folder (workspace is required to use the extension)

### Q: Login failed?

1. Confirm Dify platform URL is correct (including http/https)
2. Confirm email and password are correct
3. Check network connection
4. For self-hosted version, confirm Dify service is running properly

### Q: npm install error?

Try:
```bash
# Clear cache
npm cache clean --force

# Delete node_modules and reinstall
rm -rf node_modules package-lock.json
npm install
```

### Q: TypeScript compilation error?

Ensure TypeScript version is correct:
```bash
npm install typescript@^5.3.2 --save-dev
```

---

## 📁 Project Structure

```
dify-as-code/
├── package.json              # Extension configuration
├── tsconfig.json             # TypeScript configuration
├── README.md                 # Documentation
├── INSTALL.md                # Installation guide (this file)
├── resources/                # Icon resources
│   ├── dify-icon.svg
│   └── icon.png
├── src/                      # Source code
│   ├── extension.ts          # Extension entry point
│   ├── types.ts              # Type definitions
│   ├── difyApi.ts            # Dify API client
│   ├── configManager.ts      # Configuration file manager
│   ├── treeDataProvider.ts   # Sidebar tree view
│   ├── commands.ts           # Command implementations
│   └── types/
│       └── js-yaml.d.ts      # Type declarations
├── out/                      # Compiled output (auto-generated)
└── .vscode/
    ├── launch.json           # Debug configuration
    └── tasks.json            # Task configuration
```

---

## 📞 Getting Help

If you encounter issues:

1. Check [README.md](./README.md) for feature documentation
2. Submit an issue on GitHub Issues
3. Check Cursor/VS Code's **Output** panel (select Dify as Code) for logs
