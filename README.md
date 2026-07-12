# RESO - Real-Time Facebook Notes Presence

RESO is a Chrome extension that automatically updates your Facebook Note with the music you are currently listening to on YouTube Music. It provides a sleek, modern dashboard and seamless background syncing so your friends always know what you're jamming to.

## Features

-  **Real-Time Sync**: Automatically updates your Facebook Note when a new song plays on YouTube Music.
-  **Active Hours**: Set a custom time window (e.g., 08:00 AM to 10:00 PM) for the automation to run.
-  **Privacy Controls**: Choose whether your notes are visible to **Friends** or **Public**.
-  **Dynamic Ambience**: The extension dashboard automatically extracts the dominant color from the current album art and casts a matching ambient glow.
-  **History Log**: View a log of your most recent track updates to see if posts succeeded or failed.
-  **Lightweight**: Uses background service workers and targeted DOM observers to ensure minimal performance impact on your browser.

## Installation (Developer Mode)

1. Clone or download this repository.
2. Open your Chromium-based browser (Chrome, Edge, Brave, etc.) and navigate to your extensions page (`chrome://extensions`).
3. Enable **Developer mode** in the top right corner.
4. Click **Load unpacked** and select the folder containing the extension files.
5. The RESO icon will appear in your browser toolbar.

## Usage

1. Click the RESO icon in your extension toolbar to open the dashboard.
2. Toggle **Auto-Post Notes** to enable the automation.
3. Open a tab with **YouTube Music** (`music.youtube.com`) and play a song.
4. Open a tab with **Facebook** (ensure you are logged in). The extension will automatically route the playback state from YT Music and update your active Facebook Note.
5. Click the **Settings (Gear)** icon in the top right of the dashboard to configure your Active Hours, Note Visibility, and Color Ambience.
6. Click the **History (Clock)** icon to view the status of recent note updates.

## Technical Structure

The project follows a clean architectural layout:
- `/html` - Contains the Popup and Modal UI structure.
- `/css` - Contains styling, including custom scrollbars and animated gradient borders.
- `/js` - Contains the background service worker for GraphQL routing, content scripts for DOM extraction, and popup logic.
- `/icons` - Extension logos and icons.

## Disclaimer

This extension relies on undocumented Facebook internal GraphQL APIs and DOM structures on YouTube Music. Changes to either platform's frontend may temporarily break the extension until updated.
