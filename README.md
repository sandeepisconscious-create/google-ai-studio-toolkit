<p align="center">
  <img src="icons/logo.png" width="120" height="120" alt="Google AI Studio Toolkit Logo">
</p>

<h1 align="center">Google AI Studio Toolkit</h1>

<p align="center">
  <a href="https://github.com/sandeepisconscious-create/google-ai-studio-toolkit/releases/download/v1.9.0/google-ai-studio-toolkit-v1.9.0.zip">
    <img src="https://img.shields.io/badge/⬇%EF%B8%8F_Download_Extension_(v1.9.0)-ZIP-2563EB?style=for-the-badge&logo=googlechrome&logoColor=white" alt="Download Extension ZIP">
  </a>
</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-blue.svg" alt="License: MIT"></a>
  <a href="manifest.json"><img src="https://img.shields.io/badge/Chrome-Manifest%20V3-4285F4.svg?logo=google-chrome&logoColor=white" alt="Manifest V3"></a>
  <a href="https://github.com/sandeepisconscious-create/google-ai-studio-toolkit/releases/latest"><img src="https://img.shields.io/github/v/release/sandeepisconscious-create/google-ai-studio-toolkit?color=green&label=Latest%20Release" alt="Latest Release"></a>
  <a href="https://aistudio.google.com"><img src="https://img.shields.io/badge/Platform-Google%20AI%20Studio-0F9D58.svg" alt="Platform"></a>
</p>

<p align="center">
  <strong>An all-in-one productivity Chrome extension for Google AI Studio that eliminates daily workflow friction by bringing instant applet screenshots, in-prompt model switching, suggestion suppression, and customizable messaging controls right into your prompt bar.</strong>
</p>

> [!NOTE]
> **Disclaimer**: This is an independent, open-source community project created purely to contribute and make developer workflows easier. It is not affiliated, associated, authorized, endorsed by, or in any way officially connected with Google or any of its subsidiaries.

---

## 🎯 Pain Points & How This Toolkit Solves Them

| Friction Point in Native Google AI Studio | How Google AI Studio Toolkit Solves It |
| :--- | :--- |
| **📸 Clunky Applet UI Debugging**<br>When an AI-generated applet has a visual glitch or broken layout, you have to capture an OS screenshot, crop it, save it locally, browse for the file, and upload it back into the chat. | **One-Click In-Prompt Screenshot (<kbd>Option</kbd>+<kbd>S</kbd>)**<br>Injects a camera button `[📷]` right next to `(+)`. One click immediately crops the live preview iframe, stages it directly into the prompt box as an image chip, and copies it to clipboard without polluting your disk. |
| **🎛️ Buried Model Settings & Forgotten Selections**<br>Switching models natively requires opening the right-hand settings drawer, scrolling through options, and re-selecting every time you open a new tab or chat. | **In-Prompt Model Switcher & Permanent Memory**<br>Places a switcher right inside the prompt bar with an active checkmark (`✓`). Your choice is saved permanently and automatically synchronized across all open AI Studio tabs via UI automation and network interception. |
| **🚫 Annoying Suggestion Cards Reappearing**<br>Large "Suggestions" prompt cards repeatedly pop up above the prompt input across chats and reloads, cluttering your screen and pushing chat history up. | **One-Click Hide Suggestions Toggle**<br>Automatically suppresses suggestion card containers via instant CSS rules and active DOM observers, with an on/off toggle in the extension popup. |
| **⌨️ Inflexible Message Submission (<kbd>Enter</kbd> vs. Multiline)**<br>Developers who prefer pressing <kbd>Enter</kbd> to send messages quickly are stuck with Google AI Studio's default behavior (<kbd>Enter</kbd> only inserts a newline). | **Toggleable Enter to Send Mode**<br>Toggle between fast message submission on <kbd>Enter</kbd> (<kbd>Shift</kbd>+<kbd>Enter</kbd> for newline) or native multiline mode directly from the extension toolbar popup. |
| **⏱️ Unpredictable Quota Resets**<br>Free-tier rate limits reset at Midnight Pacific Time, but Google AI Studio never shows a timer, leaving developers guessing when their requests will unblock. | **Real-Time Quota Countdown**<br>The model menu header displays an active countdown timer to Midnight PT (`Resets in Xh Ym`), so you always know when quota refreshes. |
| **🛡️ Extension Breakage on New Model Releases**<br>Extensions with hardcoded model lists break every time Google updates Gemini versions (e.g. Gemini 4, Flash Lite, Pro). | **Dynamic Model Discovery Engine**<br>Dynamically scans native UI and API payloads, canonicalizes model keys, filters duplicate aliases, and auto-sorts new models to the top without requiring extension updates. |

---

## ⚡ Features

### 1. 📸 In-Prompt Applet Screenshot Capture
- **One-Click Staging**: Capture whatever is currently rendered in the live web applet preview by clicking the `[📷]` button right next to `(+)` (or pressing <kbd>Option</kbd> + <kbd>S</kbd> / <kbd>Alt</kbd> + <kbd>S</kbd>).
- **Direct Input Staging**: Automatically attaches the screenshot chip into the prompt input box and copies the image to your clipboard.
- **Workspace-Safe**: Does not pollute or create temporary files inside your project codebase.

### 2. 🎛️ In-Prompt Model Switcher & Multi-Tab Sync
- **Accessible in Prompt Bar**: Switch models directly from the bottom prompt bar without needing to open the native settings drawer.
- **Active Model Indicator**: Clear visual checkmark (`✓`) indicates your active selection at a glance.
- **Instant Multi-Tab Synchronization**: Switching models in one tab instantly propagates to all other open AI Studio tabs via `chrome.storage.onChanged` without page refresh.
- **Persistent Selection Memory**: Whichever model you select is remembered permanently across sessions and reloads.
- **Dual-Layer Synchronization**:
  - **Native Drawer Driver**: Programmatically selects the model inside Google AI Studio's native `Chat settings` drawer.
  - **Network Request Override**: A main-world service worker intercepts outgoing prompt requests to ensure Google's backend always executes your chosen model.
- **Daily Quota Reset Countdown**: Real-time timer countdown to the daily quota reset (**00:00 Pacific Time**) in the menu header.

### 3. 🛡️ Future-Proof Model Discovery & Canonical Deduplication
- **Dynamic Discovery**: Scans Google AI Studio's native options and API responses so newly released models (e.g. *Gemini 4.5 Pro*, *Gemini 5 Flash*) appear automatically without requiring extension updates.
- **Alias & Duplicate Filtering**: Automatically drops redundant floating aliases (`Gemini Flash Latest`, `Default (...)`) and strips UI badge text (`Paid`, `Beta`), keeping the dropdown clean and distinct.
- **Version-Aware Sorting**: New models automatically sort to the top by generation and version number.

### 4. 🚫 Hide Suggestions (Toggleable)
- **Distraction-Free Prompting**: Automatically hide the large suggestion cards that repeatedly pop up above the prompt input.
- **Instant Control**: Easily toggle suggestions on or off anytime via the extension popup settings.
- **Clean Workspace**: Keeps your chat interface uncluttered and focused purely on your prompt and model settings.

### 5. ⌨️ Enter to Send (Toggleable)
- **Fast Messaging Mode**: Choose whether pressing <kbd>Enter</kbd> sends your prompt immediately (<kbd>Shift</kbd>+<kbd>Enter</kbd> for newline) or keeps Google AI Studio's default behavior (<kbd>Enter</kbd> inserts a newline).
- **Extension Settings**: Easily toggle on/off from the extension toolbar popup without cluttering the in-prompt model switcher.
- **Safe Defaults**: Defaults to Google AI Studio's standard multiline behavior until you choose to enable it.

### 6. 🎨 Monochromatic & Native Interface
- Styled with dark monochromatic tones (`#18191a`, `#282a2c`, `#3c4043`) that seamlessly blend with Google AI Studio's native UI.
- Zero intrusive pop-overs, floating toasts, or layout shifts over your prompt box.

---

## 📥 Installation

Anyone can install and run this extension locally in Google Chrome, Brave, Edge, or any Chromium browser.

### Option A: Direct Download ZIP (Recommended)
1. Click the **[⬇️ Download Extension ZIP](https://github.com/sandeepisconscious-create/google-ai-studio-toolkit/releases/download/v1.9.0/google-ai-studio-toolkit-v1.9.0.zip)** button.
2. Unzip `google-ai-studio-toolkit-v1.9.0.zip` to a folder on your computer.

### Option B: Clone with Git
```bash
git clone https://github.com/sandeepisconscious-create/google-ai-studio-toolkit.git
```

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

> [!TIP]
> You can customize the capture shortcut anytime by opening `chrome://extensions/shortcuts` in your browser.

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
