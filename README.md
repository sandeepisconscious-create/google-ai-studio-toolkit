# Google AI Studio Toolkit

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Manifest V3](https://img.shields.io/badge/Chrome-Manifest%20V3-4285F4.svg?logo=google-chrome&logoColor=white)](manifest.json)
[![Platform](https://img.shields.io/badge/Platform-Google%20AI%20Studio-0F9D58.svg)](https://aistudio.google.com)

A minimalist, monochromatic Chrome extension designed for power users of **Google AI Studio** (`aistudio.google.com`). 

> [!NOTE]
> **Disclaimer**: This is an independent, open-source community project created purely to contribute and make developer workflows easier. It is not affiliated, associated, authorized, endorsed by, or in any way officially connected with Google or any of its subsidiaries.

It adds one-click live applet screenshot capture directly into prompt input, an in-prompt model switcher with quota reset tracking, and smart task auto-routing.

---

## ⚡ Features

### 1. 📸 In-Prompt Applet Screenshot Capture
- **One-click staging**: Capture whatever is currently rendered in the live web applet preview by clicking the `[📷]` button right next to `(+)` (or pressing <kbd>Option</kbd> + <kbd>S</kbd> / <kbd>Alt</kbd> + <kbd>S</kbd>).
- **Direct Prompt Staging**: Automatically attaches the screenshot chip into the prompt input box and copies the image to your clipboard.
- **Workspace-Safe**: Does not pollute or create temporary files inside your project directory.

### 2. 🎛️ In-Prompt Model Switcher & Dynamic Discovery
- **Accessible Right in Prompt Bar**: Switch models directly from the bottom prompt bar without having to open the right-hand Chat Settings drawer.
- **Dynamic Model Discovery (No Stale Hardcoded Models)**:
  - **Tier 1 (DOM Inspector)**: Automatically extracts options directly from Google AI Studio's native `Select model to use in Chat` menu.
  - **Tier 2 (Main-World Network Interceptor)**: Sniffs Google's internal `ListModels` API response on startup.
  - **Tier 3 (Chat History Harvester)**: Automatically discovers newly released models from chat run headers (`• Ran for ...`).
  - **Persistent Local Cache**: Discovered models are saved in `chrome.storage.local` so new models appear seamlessly without requiring extension updates.
- **Daily Quota Reset Timer**: Live countdown to the daily quota reset (**00:00 Pacific Time**).
- **Session Usage Counter**: Reads actual chat run history to track how many prompts each model has processed today.

### 3. 🧠 Smart Task Auto-Router
- When set to **Auto**, the toolkit analyzes prompt complexity on dispatch:
  - **Complex Tasks**: Architecture, algorithmic logic, refactoring, and multi-file debugging route to **Gemini 4 Argon**.
  - **Fast Tasks**: Styling, CSS tweaks, UI adjustments, and simple questions route to **Gemini 3.8 / 3.6 Flash**.

### 4. 🎨 Monochromatic & Non-Intrusive Design
- Built to match Google AI Studio's native dark interface (`#18191a`, `#282a2c`).
- Zero intrusive pop-overs, banners, or floating toasts obstructing the prompt box.

---

## 📥 Installation

Since this extension is open source, anyone can install and run it locally in Chrome, Brave, Edge, or any Chromium browser.

### Option A: Clone with Git
```bash
git clone https://github.com/sandeepisconscious-create/google-ai-studio-toolkit.git
```

### Option B: Download ZIP
1. Click **Code** > **Download ZIP** on GitHub.
2. Unzip the folder onto your computer.

### Load into Chrome:
1. Open Google Chrome and navigate to:
   ```text
   chrome://extensions
   ```
2. Enable **Developer mode** via the toggle switch in the top right corner.
3. Click the **Load unpacked** button in the top left.
4. Select the `google-ai-studio-toolkit` folder.
5. Open or refresh [Google AI Studio](https://aistudio.google.com).

---

## ⌨️ Shortcuts

| Shortcut | Action |
| :--- | :--- |
| <kbd>Option</kbd> + <kbd>S</kbd> *(macOS)* | Capture applet preview & attach to prompt |
| <kbd>Alt</kbd> + <kbd>S</kbd> *(Windows / Linux)* | Capture applet preview & attach to prompt |

---

## 📁 Project Structure

```text
google-ai-studio-toolkit/
├── manifest.json       # Chrome Manifest V3 configuration
├── background.js       # Background tab capture service worker
├── interceptor.js      # Main-world network listener (dynamic model discovery)
├── content.js          # Injected UI (camera button, model switcher, auto-router)
├── content.css         # Dark monochromatic styling
├── popup.html          # Context-aware browser action popup
├── popup.css           # Extension popup styles
├── popup.js            # Popup logic & navigation
├── icons/              # Extension icons (16px, 32px, 48px, 128px)
├── LICENSE             # MIT License
└── README.md           # Documentation
```

---

## 🤝 Contributing

Contributions, issues, and feature requests are welcome!
Feel free to open an issue or submit a pull request:

1. Fork the Project
2. Create your Feature Branch (`git checkout -b feature/AmazingFeature`)
3. Commit your Changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the Branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

---

## ⚠️ Disclaimer

This project is an independent open-source contribution developed solely to enhance developer productivity and make everyday workflows in Google AI Studio easier. 

It has **no official connection, sponsorship, or affiliation with Google LLC**. "Google" and "Google AI Studio" are trademarks of Google LLC.

---

## 📄 License

Distributed under the MIT License. See [`LICENSE`](LICENSE) for more information.
