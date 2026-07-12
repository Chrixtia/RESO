document.addEventListener("DOMContentLoaded", () => {
  const masterToggle       = document.getElementById("master-toggle");
  const ambienceToggle     = document.getElementById("ambience-toggle");
  const startTimeInput     = document.getElementById("start-time");
  const endTimeInput       = document.getElementById("end-time");
  const audienceSettingInput = document.getElementById("audience-setting");

  const loadingScreen  = document.getElementById("loading-screen");
  const statusIcon     = document.getElementById("status-icon");
  const statusLabel    = document.getElementById("status-label");
  const statusValue    = document.getElementById("status-value");
  const ambienceGlow   = document.getElementById("ambience-glow");
  const progressBar    = document.getElementById("progress-bar");

  // Modals
  const btnSettings   = document.getElementById("btn-settings");
  const btnHistory    = document.getElementById("btn-history");
  const modalSettings = document.getElementById("settings-modal");
  const modalHistory  = document.getElementById("history-modal");
  const closeSettings = document.getElementById("close-settings");
  const closeHistory  = document.getElementById("close-history");
  const historyList   = document.getElementById("history-list");

  // SVG Icons
  const svgIdle = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"></line></svg>`;
  const svgMusic = `<svg class="active-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l12-2v13"></path><circle cx="6" cy="18" r="3"></circle><circle cx="18" cy="16" r="3"></circle></svg>`;

  // Helper: check if current time is within window
  const isTimeActive = (start, end) => {
    if (!start || !end) return false;
    const now = new Date();
    const currentMins = now.getHours() * 60 + now.getMinutes();
    const [startH, startM] = start.split(':').map(Number);
    const startMins = startH * 60 + startM;
    const [endH, endM] = end.split(':').map(Number);
    const endMins = endH * 60 + endM;
    if (startMins <= endMins) {
      return currentMins >= startMins && currentMins < endMins;
    } else {
      return currentMins >= startMins || currentMins < endMins;
    }
  };

  // ── Ambience: extract dominant color from image ──────────
  const extractDominantColor = (imgEl) => {
    return new Promise((resolve) => {
      const canvas = document.createElement("canvas");
      const size = 20; // small sample for speed
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext("2d");
      try {
        ctx.drawImage(imgEl, 0, 0, size, size);
        const data = ctx.getImageData(0, 0, size, size).data;
        let r = 0, g = 0, b = 0, count = 0;
        for (let i = 0; i < data.length; i += 4) {
          // Skip very dark or very light pixels for a truer accent color
          const brightness = (data[i] + data[i+1] + data[i+2]) / 3;
          if (brightness > 20 && brightness < 235) {
            r += data[i];
            g += data[i+1];
            b += data[i+2];
            count++;
          }
        }
        if (count === 0) { resolve(null); return; }
        resolve(`rgb(${Math.round(r/count)}, ${Math.round(g/count)}, ${Math.round(b/count)})`);
      } catch {
        resolve(null);
      }
    });
  };

  const applyAmbience = async (imgEl, ambienceEnabled) => {
    if (!ambienceEnabled || !imgEl) {
      ambienceGlow.style.background = "";
      ambienceGlow.classList.remove("visible");
      return;
    }

    const applyColor = async () => {
      const color = await extractDominantColor(imgEl);
      if (color) {
        // Full-card radial gradient: blooms from the left (album art side) across the whole card
        ambienceGlow.style.background = `radial-gradient(ellipse at 15% 50%, ${color} 0%, transparent 75%)`;
        ambienceGlow.classList.add("visible");
      }
    };

    if (imgEl.complete && imgEl.naturalWidth > 0) {
      applyColor();
    } else {
      imgEl.onload = applyColor;
    }
  };

  // ── UI State ──────────────────────────────────────────────
  const updateUIState = (settings, lastSentSong) => {
    const isEnabled      = settings.automationEnabled;
    const isWithinWindow = isTimeActive(settings.startTime, settings.endTime);
    const isActive       = isEnabled && isWithinWindow;
    const ambienceOn     = settings.ambienceEnabled ?? false;

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
        applyAmbience(img, ambienceOn);
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

  // ── Save settings ─────────────────────────────────────────
  const saveSettings = () => {
    progressBar.classList.add("loading");
    setTimeout(() => progressBar.classList.remove("loading"), 800);

    const settings = {
      automationEnabled: masterToggle.checked,
      ambienceEnabled:   ambienceToggle.checked,
      startTime:         startTimeInput.value,
      endTime:           endTimeInput.value,
      audienceSetting:   audienceSettingInput.value
    };

    chrome.storage.local.set(settings, () => {
      chrome.runtime.sendMessage({ type: "SETTINGS_CHANGED" });
      chrome.storage.local.get("lastSentSong", (data) => {
        updateUIState(settings, data.lastSentSong);
      });
    });
  };

  // ── Initial Load ──────────────────────────────────────────
  chrome.storage.local.get({
    automationEnabled: true,
    ambienceEnabled:   false,
    startTime:         "08:00",
    endTime:           "22:00",
    audienceSetting:   "FRIENDS",
    lastSentSong:      null
  }, (data) => {
    masterToggle.checked          = data.automationEnabled;
    ambienceToggle.checked        = data.ambienceEnabled;
    startTimeInput.value          = data.startTime;
    endTimeInput.value            = data.endTime;
    audienceSettingInput.value    = data.audienceSetting;

    updateUIState(data, data.lastSentSong);

    setTimeout(() => {
      loadingScreen.classList.add("hidden-loading");
    }, 400);
  });

  // ── Event Listeners ───────────────────────────────────────
  masterToggle.addEventListener("change", saveSettings);
  ambienceToggle.addEventListener("change", saveSettings);
  startTimeInput.addEventListener("change", saveSettings);
  endTimeInput.addEventListener("change", saveSettings);
  audienceSettingInput.addEventListener("change", saveSettings);

  // ── Modals Logic ──────────────────────────────────────────
  btnSettings.addEventListener("click", () => modalSettings.classList.add("open"));
  closeSettings.addEventListener("click", () => modalSettings.classList.remove("open"));

  btnHistory.addEventListener("click", () => {
    modalHistory.classList.add("open");
    renderHistory();
  });
  closeHistory.addEventListener("click", () => modalHistory.classList.remove("open"));

  // ── History Logic ─────────────────────────────────────────
  const renderHistory = () => {
    chrome.storage.local.get({ history: [] }, (data) => {
      if (!data.history || data.history.length === 0) {
        historyList.innerHTML = `<div class="empty-state">No history yet</div>`;
        return;
      }

      historyList.innerHTML = data.history.map(item => {
        const time = new Date(item.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        const isSuccess = item.status === 'success';
        const statusClass = isSuccess ? 'success' : 'error';
        const statusText = isSuccess ? 'Posted' : 'Failed';
        
        return `
          <div class="history-item">
            <div class="history-info">
              <span class="history-title" title="${item.title}">${item.title}</span>
              <span class="history-meta">${time}</span>
            </div>
            <span class="history-status ${statusClass}">${statusText}</span>
          </div>
        `;
      }).join('');
    });
  };

  // Real-time song updates from background
  chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace === "local") {
      if (changes.lastSentSong) {
        chrome.storage.local.get(
          ["automationEnabled", "ambienceEnabled", "startTime", "endTime"],
          (settings) => {
            updateUIState(settings, changes.lastSentSong.newValue);
          }
        );
      }
      if (changes.history && modalHistory.classList.contains("open")) {
        renderHistory();
      }
    }
  });
});
