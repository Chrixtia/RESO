/**
 * @fileoverview RESO - Options Page Controller
 *
 * @description Controller managing user settings, scheduling window configurations, and real-time status badges for the options page.
 * @author @Chrixtia
 */
import { isWithinTimeWindow } from "./utils/time.js";
/**
 * @function initOptionsPage
 *
 * @description Binds event handlers, loads existing preferences from local storage, and initializes status display.
 * @returns Void.
 */
function initOptionsPage() {
    const rpcToggle = document.getElementById("rpc-toggle");
    const startTimeInput = document.getElementById("start-time");
    const endTimeInput = document.getElementById("end-time");
    const statusBadge = document.getElementById("status-badge");
    const statusToast = document.getElementById("status-toast");
    if (!rpcToggle || !startTimeInput || !endTimeInput || !statusBadge || !statusToast) {
        return;
    }
    let settings = {
        automationEnabled: true,
        startTime: "08:00",
        endTime: "22:00"
    };
    /**
     * @function updateStatusBadge
     *
     * @description Updates UI badges to reflect whether automation is currently active, idle outside time window, or disabled.
     * @returns Void.
     */
    const updateStatusBadge = () => {
        if (!settings.automationEnabled) {
            statusBadge.textContent = "Turned Off";
            statusBadge.className = "px-3 py-1 text-xs font-semibold rounded-full border bg-rose-500/10 text-rose-400 border-rose-500/20";
            return;
        }
        const active = isWithinTimeWindow(settings.startTime, settings.endTime);
        if (active) {
            statusBadge.textContent = "Active (Within Window)";
            statusBadge.className = "px-3 py-1 text-xs font-semibold rounded-full border bg-emerald-500/10 text-emerald-400 border-emerald-500/20 shadow-glow-success";
        }
        else {
            statusBadge.textContent = "Idle (Outside Window)";
            statusBadge.className = "px-3 py-1 text-xs font-semibold rounded-full border bg-amber-500/10 text-amber-400 border-amber-500/20";
        }
    };
    /**
     * @function showToast
     *
     * @description Displays a brief confirmation toast indicating settings were saved and synchronised.
     * @returns Void.
     */
    const showToast = () => {
        statusToast.style.opacity = "1";
        setTimeout(() => {
            statusToast.style.opacity = "0";
        }, 2000);
    };
    /**
     * @function saveSettings
     *
     * @description Reads values from form inputs, persists them to Chrome local storage, and broadcasts change notifications.
     * @returns Void.
     */
    const saveSettings = () => {
        settings.automationEnabled = rpcToggle.checked;
        settings.startTime = startTimeInput.value;
        settings.endTime = endTimeInput.value;
        chrome.storage.local.set(settings, () => {
            updateStatusBadge();
            showToast();
            chrome.runtime.sendMessage({
                type: "SETTINGS_CHANGED",
                settings: settings
            }, () => {
                void chrome.runtime.lastError;
            });
        });
    };
    chrome.storage.local.get(settings, (items) => {
        settings = items;
        rpcToggle.checked = Boolean(settings.automationEnabled);
        startTimeInput.value = settings.startTime || "08:00";
        endTimeInput.value = settings.endTime || "22:00";
        updateStatusBadge();
    });
    rpcToggle.addEventListener("change", saveSettings);
    startTimeInput.addEventListener("change", saveSettings);
    endTimeInput.addEventListener("change", saveSettings);
    setInterval(updateStatusBadge, 5000);
}
document.addEventListener("DOMContentLoaded", initOptionsPage);
