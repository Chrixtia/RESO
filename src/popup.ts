/**
 * @fileoverview RESO - Popup Dashboard Controller
 *
 * @description Manages popup UI state, dynamic album art color ambience extraction, modal views, playback status indicators, and settings synchronization.
 * @author @Chrixtia
 */

import { isWithinTimeWindow } from "./utils/time.js";
import type { ExtensionSettings, PlaybackState, HistoryItem } from "./types/index.js";

/**
 * @function initPopupDashboard
 *
 * @description Initializes the popup UI, connects event listeners for modals and switches, and subscribes to storage changes.
 * @returns Void.
 */
function initPopupDashboard(): void {
  const masterToggle = document.getElementById("master-toggle") as HTMLInputElement | null;
  const ambienceToggle = document.getElementById("ambience-toggle") as HTMLInputElement | null;
  const startTimeInput = document.getElementById("start-time") as HTMLInputElement | null;
  const endTimeInput = document.getElementById("end-time") as HTMLInputElement | null;
  const audienceSettingInput = document.getElementById("audience-setting") as HTMLSelectElement | null;

  const loadingScreen = document.getElementById("loading-screen");
  const statusIcon = document.getElementById("status-icon");
  const statusLabel = document.getElementById("status-label");
  const statusValue = document.getElementById("status-value");
  const ambienceGlow = document.getElementById("ambience-glow");
  const progressBar = document.getElementById("progress-bar");

  const btnSettings = document.getElementById("btn-settings");
  const btnHistory = document.getElementById("btn-history");
  const modalSettings = document.getElementById("settings-modal");
  const modalHistory = document.getElementById("history-modal");
  const closeSettings = document.getElementById("close-settings");
  const closeHistory = document.getElementById("close-history");
  const historyList = document.getElementById("history-list");

  if (
    !masterToggle ||
    !ambienceToggle ||
    !startTimeInput ||
    !endTimeInput ||
    !audienceSettingInput ||
    !loadingScreen ||
    !statusIcon ||
    !statusLabel ||
    !statusValue ||
    !ambienceGlow ||
    !progressBar ||
    !btnSettings ||
    !btnHistory ||
    !modalSettings ||
    !modalHistory ||
    !closeSettings ||
    !closeHistory ||
    !historyList
  ) {
    return;
  }

  const svgIdle = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"></line></svg>`;
  const svgMusic = `<svg class="active-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l12-2v13"></path><circle cx="6" cy="18" r="3"></circle><circle cx="18" cy="16" r="3"></circle></svg>`;

  /**
   * @function extractDominantColor
   *
   * @description Renders a downsampled thumbnail of an image to an offscreen canvas and computes the average RGB color, filtering out extreme whites and blacks.
   * @param imgEl HTMLImageElement containing the source artwork.
   * @returns Promise resolving to an rgb CSS color string or null if calculation fails.
   */
  const extractDominantColor = (imgEl: HTMLImageElement): Promise<string | null> => {
    return new Promise((resolve) => {
      const canvas = document.createElement("canvas");
      const size = 20;
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        resolve(null);
        return;
      }

      try {
        ctx.drawImage(imgEl, 0, 0, size, size);
        const data = ctx.getImageData(0, 0, size, size).data;
        let r = 0;
        let g = 0;
        let b = 0;
        let count = 0;
        for (let i = 0; i < data.length; i += 4) {
          const brightness = (data[i] + data[i + 1] + data[i + 2]) / 3;
          if (brightness > 20 && brightness < 235) {
            r += data[i];
            g += data[i + 1];
            b += data[i + 2];
            count++;
          }
        }
        if (count === 0) {
          resolve(null);
          return;
        }
        resolve(`rgb(${Math.round(r / count)}, ${Math.round(g / count)}, ${Math.round(b / count)})`);
      } catch {
        resolve(null);
      }
    });
  };

  /**
   * @function applyAmbience
   *
   * @description Applies dynamic radial gradient ambient glow derived from artwork color to the player card background.
   * @param imgEl HTMLImageElement source or null.
   * @param ambienceEnabled Whether ambient color feature is toggled on.
   * @returns Promise resolving when ambience style has been applied.
   */
  const applyAmbience = async (imgEl: HTMLImageElement | null, ambienceEnabled: boolean): Promise<void> => {
    if (!ambienceEnabled || !imgEl) {
      ambienceGlow.style.background = "";
      ambienceGlow.classList.remove("visible");
      return;
    }

    const applyColor = async (): Promise<void> => {
      const color = await extractDominantColor(imgEl);
      if (color) {
        ambienceGlow.style.background = `radial-gradient(ellipse at 15% 50%, ${color} 0%, transparent 75%)`;
        ambienceGlow.classList.add("visible");
      }
    };

    if (imgEl.complete && imgEl.naturalWidth > 0) {
      void applyColor();
    } else {
      imgEl.onload = (): void => {
        void applyColor();
      };
    }
  };

  /**
   * @function updateUIState
   *
   * @description Evaluates active schedules and playback information to render player card content, badges, and album artwork.
   * @param settings User extension configuration object.
   * @param lastSentSong Latest playback state cached in local storage.
   * @returns Void.
   */
  const updateUIState = (settings: ExtensionSettings, lastSentSong?: PlaybackState | null): void => {
    const isEnabled = settings.automationEnabled;
    const isWithinWindow = isWithinTimeWindow(settings.startTime, settings.endTime);
    const isActive = isEnabled && isWithinWindow;
    const ambienceOn = settings.ambienceEnabled ?? false;

    if (isActive && lastSentSong && lastSentSong.title) {
      statusLabel.textContent = lastSentSong.isPlaying ? "Now Playing" : "Paused";
      statusValue.textContent = lastSentSong.title;

      if (lastSentSong.imageUrl) {
        const img = new Image();
        img.crossOrigin = "anonymous";
        img.src = lastSentSong.imageUrl;
        img.className = "status-image";
        img.alt = "Album Art";
        statusIcon.innerHTML = "";
        statusIcon.appendChild(img);
        void applyAmbience(img, ambienceOn);
      } else {
        statusIcon.innerHTML = svgMusic;
        ambienceGlow.classList.remove("visible");
      }
    } else if (isActive) {
      statusLabel.textContent = "Listening";
      statusValue.textContent = "Waiting for music...";
      statusIcon.innerHTML = svgMusic;
      ambienceGlow.classList.remove("visible");
    } else {
      statusIcon.innerHTML = svgIdle;
      ambienceGlow.classList.remove("visible");
      if (!isEnabled) {
        statusLabel.textContent = "Turned Off";
        statusValue.textContent = "Automation Disabled";
      } else {
        statusLabel.textContent = "Idle";
        statusValue.textContent = "Outside Time Window";
      }
    }
  };

  /**
   * @function saveSettings
   *
   * @description Persists form changes into Chrome storage, displays animated progress bar, and re-renders UI state.
   * @returns Void.
   */
  const saveSettings = (): void => {
    progressBar.classList.add("loading");
    setTimeout(() => progressBar.classList.remove("loading"), 800);

    const settings: ExtensionSettings = {
      automationEnabled: masterToggle.checked,
      ambienceEnabled: ambienceToggle.checked,
      startTime: startTimeInput.value,
      endTime: endTimeInput.value,
      audienceSetting: audienceSettingInput.value as "FRIENDS" | "PUBLIC" | "CUSTOM"
    };

    chrome.storage.local.set(settings, () => {
      chrome.runtime.sendMessage({ type: "SETTINGS_CHANGED" });
      chrome.storage.local.get("lastSentSong", (data) => {
        updateUIState(settings, data.lastSentSong as PlaybackState | null);
      });
    });
  };

  /**
   * @function renderHistory
   *
   * @description Reads recent post history records from storage and renders status items inside the history modal.
   * @returns Void.
   */
  const renderHistory = (): void => {
    chrome.storage.local.get({ history: [] }, (data) => {
      const history = (data.history || []) as HistoryItem[];
      if (history.length === 0) {
        historyList.innerHTML = `<div class="empty-state">No history yet</div>`;
        return;
      }

      historyList.innerHTML = history
        .map((item) => {
          const time = new Date(item.timestamp).toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit"
          });
          const isSuccess = item.status === "success";
          const statusClass = isSuccess ? "success" : "error";
          const statusText = isSuccess ? "Posted" : "Failed";

          return `
          <div class="history-item">
            <div class="history-info">
              <span class="history-title" title="${item.title}">${item.title}</span>
              <span class="history-meta">${time}</span>
            </div>
            <span class="history-status ${statusClass}">${statusText}</span>
          </div>
        `;
        })
        .join("");
    });
  };

  chrome.storage.local.get(
    {
      automationEnabled: true,
      ambienceEnabled: false,
      startTime: "08:00",
      endTime: "22:00",
      audienceSetting: "FRIENDS",
      lastSentSong: null
    },
    (data) => {
      const settings = data as ExtensionSettings;
      masterToggle.checked = Boolean(settings.automationEnabled);
      ambienceToggle.checked = Boolean(settings.ambienceEnabled);
      startTimeInput.value = settings.startTime || "08:00";
      endTimeInput.value = settings.endTime || "22:00";
      audienceSettingInput.value = settings.audienceSetting || "FRIENDS";

      updateUIState(settings, settings.lastSentSong);

      setTimeout(() => {
        loadingScreen.classList.add("hidden-loading");
      }, 400);
    }
  );

  masterToggle.addEventListener("change", saveSettings);
  ambienceToggle.addEventListener("change", saveSettings);
  startTimeInput.addEventListener("change", saveSettings);
  endTimeInput.addEventListener("change", saveSettings);
  audienceSettingInput.addEventListener("change", saveSettings);

  btnSettings.addEventListener("click", () => modalSettings.classList.add("open"));
  closeSettings.addEventListener("click", () => modalSettings.classList.remove("open"));

  btnHistory.addEventListener("click", () => {
    modalHistory.classList.add("open");
    renderHistory();
  });
  closeHistory.addEventListener("click", () => modalHistory.classList.remove("open"));

  chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace === "local") {
      if (changes.lastSentSong) {
        chrome.storage.local.get(
          ["automationEnabled", "ambienceEnabled", "startTime", "endTime"],
          (settings) => {
            updateUIState(settings as ExtensionSettings, changes.lastSentSong.newValue as PlaybackState);
          }
        );
      }
      if (changes.history && modalHistory.classList.contains("open")) {
        renderHistory();
      }
    }
  });
}

document.addEventListener("DOMContentLoaded", initPopupDashboard);
