document.addEventListener("DOMContentLoaded", () => {
  const rpcToggle = document.getElementById("rpc-toggle");
  const startTimeInput = document.getElementById("start-time");
  const endTimeInput = document.getElementById("end-time");
  const statusBadge = document.getElementById("status-badge");
  const statusToast = document.getElementById("status-toast");

  let settings = {
    automationEnabled: true,
    startTime: "08:00",
    endTime: "22:00"
  };

  // Load settings from storage
  chrome.storage.local.get(settings, (items) => {
    settings = items;
    rpcToggle.checked = settings.automationEnabled;
    startTimeInput.value = settings.startTime;
    endTimeInput.value = settings.endTime;
    updateStatusBadge();
  });

  // Helper to parse "HH:MM" to minutes
  function parseTimeToMinutes(timeStr) {
    if (!timeStr) return 0;
    const [hours, minutes] = timeStr.split(":").map(Number);
    return hours * 60 + minutes;
  }

  // Check if current time is within active time window
  function isCurrentTimeActive(startStr, endStr) {
    const now = new Date();
    const currentMinutes = now.getHours() * 60 + now.getMinutes();
    const startMinutes = parseTimeToMinutes(startStr);
    const endMinutes = parseTimeToMinutes(endStr);

    if (startMinutes <= endMinutes) {
      return currentMinutes >= startMinutes && currentMinutes <= endMinutes;
    } else {
      // Overnight window (e.g. 22:00 - 08:00)
      return currentMinutes >= startMinutes || currentMinutes <= endMinutes;
    }
  }

  // Update Status Badge styling and text
  function updateStatusBadge() {
    if (!settings.automationEnabled) {
      statusBadge.textContent = "Turned Off";
      statusBadge.className = "px-3 py-1 text-xs font-semibold rounded-full border bg-rose-500/10 text-rose-400 border-rose-500/20";
      return;
    }

    const active = isCurrentTimeActive(settings.startTime, settings.endTime);
    if (active) {
      statusBadge.textContent = "Active (Within Window)";
      statusBadge.className = "px-3 py-1 text-xs font-semibold rounded-full border bg-emerald-500/10 text-emerald-400 border-emerald-500/20 shadow-glow-success";
    } else {
      statusBadge.textContent = "Idle (Outside Window)";
      statusBadge.className = "px-3 py-1 text-xs font-semibold rounded-full border bg-amber-500/10 text-amber-400 border-amber-500/20";
    }
  }

  // Save changes to storage
  function saveSettings() {
    settings.automationEnabled = rpcToggle.checked;
    settings.startTime = startTimeInput.value;
    settings.endTime = endTimeInput.value;

    chrome.storage.local.set(settings, () => {
      updateStatusBadge();
      showToast();
      
      // Notify background script of settings change to re-evaluate state immediately
      chrome.runtime.sendMessage({
        type: "SETTINGS_CHANGED",
        settings: settings
      }, () => {
        if (chrome.runtime.lastError) {
          // SW might be asleep/not running, safe to ignore
        }
      });
    });
  }

  function showToast() {
    statusToast.style.opacity = "1";
    setTimeout(() => {
      statusToast.style.opacity = "0";
    }, 2000);
  }

  // Add event listeners for direct auto-save
  rpcToggle.addEventListener("change", saveSettings);
  startTimeInput.addEventListener("change", saveSettings);
  endTimeInput.addEventListener("change", saveSettings);

  // Keep badge updated in real-time (every 5 seconds for dashboard freshness)
  setInterval(updateStatusBadge, 5000);
});
