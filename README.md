# Google AI Studio Toolkit

<p align="center">
  <img src="icons/icon128.png" width="96" height="96" alt="Google AI Studio Toolkit Logo">
</p>

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Manifest V3](https://img.shields.io/badge/Chrome-Manifest%20V3-4285F4.svg?logo=google-chrome&logoColor=white)](manifest.json)
[![Platform](https://img.shields.io/badge/Platform-Google%20AI%20Studio-0F9D58.svg)](https://aistudio.google.com)

A minimalist, monochromatic Chrome extension designed for power users of **Google AI Studio** (`aistudio.google.com`). 

> [!NOTE]
> **Disclaimer**: This is an independent, open-source community project created purely to contribute and make developer workflows easier. It is not affiliated, associated, authorized, endorsed by, or in any way officially connected with Google or any of its subsidiaries.

It adds one-click live applet screenshot capture directly into the prompt input, an in-prompt model switcher with persistent selection, a toggleable Enter-to-Send mode, and a daily quota reset countdown.

---

## ⚡ Features

### 1. 📸 In-Prompt Applet Screenshot Capture
- **One-Click Staging**: Capture whatever is currently rendered in the live web applet preview by clicking the `[📷]` button right next to `(+)` (or pressing <kbd>Option</kbd> + <kbd>S</kbd> / <kbd>Alt</kbd> + <kbd>S</kbd>).
- **Direct Input Staging**: Automatically attaches the screenshot chip into the prompt input box and copies the image to your clipboard.
- **Workspace-Safe**: Does not pollute or create temporary files inside your project codebase.

### 2. 🎛️ In-Prompt Model Switcher & Persistent Selection
- **Accessible in Prompt Bar**: Switch models directly from the bottom prompt bar without needing to open the native settings drawer.
- **Persistent Selection Memory**: Whichever model you select is remembered permanently across sessions and tab reloads until you explicitly choose a different one.
- **Dual-Layer Synchronization**:
  - **Native Drawer Driver**: Programmatically selects the model inside Google AI Studio's native `Chat settings` drawer.
  - **Network Request Override**: A main-world service worker intercepts outgoing prompt requests to ensure Google's backend always executes your chosen model.
- **Daily Quota Reset Countdown**: Real-time timer countdown to the daily quota reset (**00:00 Pacific Time**) in the menu header.

### 3. 🛡️ Future-Proof Model Discovery & Canonical Deduplication
- **Dynamic Discovery**: Scans Google AI Studio's native options and API responses so newly released models (e.g. *Gemini 4.5 Pro*, *Gemini 5 Flash*) appear automatically without requiring extension updates.
- **Alias & Duplicate Filtering**: Automatically drops redundant floating aliases (`Gemini Flash Latest`, `Default (...)`) and strips UI badge text (`Paid`, `Beta`), keeping the dropdown clean and distinct.
- **Version-Aware Sorting**: New models automatically sort to the top by generation and version number.

### 4. ⌨️ Enter to Send (Toggleable)
- **Fast Messaging Mode**: Choose whether pressing <kbd>Enter</kbd> sends your prompt immediately (<kbd>Shift</kbd>+<kbd>Enter</kbd> for newline) or keeps Google AI Studio's default behavior (<kbd>Enter</kbd> inserts a newline).
- **Dual Controls**: Toggle on/off with a single click inside the prompt bar dropdown or from the extension toolbar popup.
- **Safe Defaults**: Defaults to Google AI Studio's standard multiline behavior until you choose to enable it.

### 5. 🎨 Monochromatic & Native Interface
- Styled with dark monochromatic tones (`#18191a`, `#282a2c`, `#3c4043`) that seamlessly blend with Google AI Studio's native UI.
- Zero intrusive pop-overs, floating toasts, or layout shifts over your prompt box.

---

## 📥 Installation

Anyone can install and run this extension locally in Google Chrome, Brave, Edge, or any Chromium browser.

### Option A: Clone with Git
```bash
git clone https://github.com/sandeepisconscious-create/google-ai-studio-toolkit.git
```

### Option B: Download ZIP
1. Click **Code** > **Download ZIP** on GitHub.
2. Unzip the downloaded folder.

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

## ⌨️ Shortcuts & Controls

| Shortcut / Action | Behavior |
| :--- | :--- |
| <kbd>Option</kbd> + <kbd>S</kbd> *(macOS)* | Capture applet preview & attach to prompt |
| <kbd>Alt</kbd> + <kbd>S</kbd> *(Windows / Linux)* | Capture applet preview & attach to prompt |
| <kbd>Enter</kbd> *(when Enter to Send is ON)* | Send prompt immediately |
| <kbd>Shift</kbd> + <kbd>Enter</kbd> *(when Enter to Send is ON)* | Insert new line in prompt |
| <kbd>Enter</kbd> *(when Enter to Send is OFF)* | Insert new line (Google AI Studio default) |

---

## 📁 Project Structure

```text
google-ai-studio-toolkit/
├── manifest.json       # Chrome Manifest V3 configuration
├── background.js       # Background tab capture service worker
├── interceptor.js      # Main-world network listener & model request override
├── content.js          # Injected UI (camera button, model switcher, Enter to Send)
├── content.css         # Monochromatic dark theme styling
├── popup.html          # Extension toolbar popup with preferences
├── popup.css           # Popup styles & toggle switch
├── popup.js            # Popup controller & preference sync
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
