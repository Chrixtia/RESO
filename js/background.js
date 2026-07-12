const extractTokens = (cookie, html) => {
  const userId = extractUserId(cookie);
  const fb_dtsg = sanitizeToken(extractFbDtsg(html));
  const jazoest = extractJazoest(fb_dtsg);
  const lsd = sanitizeToken(extractLsd(html));
  if (!userId || !fb_dtsg) {
    return null;
  }
  return { fb_dtsg, jazoest, userId, lsd };
};
const extractUserId = (cookie) => {
  const regex = /c_user=(\d+);/gm;
  const match = regex.exec(cookie);
  return match ? match[1] : "";
};
const extractFbDtsg = (html) => {
  const regex = /"DTSG(?:Initia|Init)l?Data",\[],\{"token":"([^"\\]{8,300})"/m;
  const match = regex.exec(html);
  return match ? match[1] : "";
};
const extractJazoest = (dtsg) => {
  if (!dtsg) return "";
  let sum = 0;
  for (let i = 0; i < dtsg.length; i++) {
    sum += dtsg.charCodeAt(i);
  }
  return "2" + sum;
};
const extractLsd = (html) => {
  let match = /name="lsd" value="([^"\\]{6,300})"/m.exec(html);
  if (match) return match[1];
  match = /"LSD",\[],\{"token":"([^"\\]{6,300})"/m.exec(html);
  return match ? match[1] : "";
};
const sanitizeToken = (value) => {
  if (!value) return "";
  const trimmed = value.trim();
  if (trimmed.length < 6 || trimmed.length > 300) return "";
  if (!/^[A-Za-z0-9:_\-]+$/.test(trimmed)) return "";
  return trimmed;
};

let activeMediaTabId = null;

chrome.webNavigation.onCompleted.addListener((details) => {
  if (details.url.includes("facebook.com")) {
    chrome.scripting.executeScript({
      target: { tabId: details.tabId },
      func: checkInitialState
    });
  }
});
function checkInitialState() {
  chrome.runtime.sendMessage({
    type: "PAGE_LOADED",
    url: window.location.href
  });
}
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "GET_TOKENS") {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (!tabs[0]?.id) {
        sendResponse({ error: "No active tab found" });
        return;
      }
      chrome.scripting.executeScript({
        target: { tabId: tabs[0].id },
        func: getPageInfo
      }, (results) => {
        if (chrome.runtime.lastError || !results?.[0]) {
          sendResponse({ error: "Failed to extract page info" });
          return;
        }
        const { cookie, html } = results[0].result;
        const tokens = extractTokens(cookie, html);
        sendResponse({ tokens });
      });
    });
    return true;
  }
  if (message.type === "CREATE_NOTE") {
    let replied = false;
    const replyOnce = (payload) => {
      if (replied) return;
      replied = true;
      sendResponse(payload);
    };
    const timeoutId = setTimeout(() => {
      replyOnce({ success: false, error: "CREATE_NOTE timeout: no response from tab context" });
    }, 2e4);
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (!tabs[0]?.id) {
        clearTimeout(timeoutId);
        replyOnce({ success: false, error: "No active tab found" });
        return;
      }
      const activeUrl = tabs[0].url || "";
      if (!activeUrl.includes("facebook.com")) {
        clearTimeout(timeoutId);
        replyOnce({ success: false, error: "Open facebook.com tab before creating a note" });
        return;
      }
      chrome.scripting.executeScript({
        target: { tabId: tabs[0].id },
        func: createNoteFromPage,
        args: [message.tokens, message.description, message.duration, message.audienceSetting, message.selectedFriendIds || [], message.selectedMusic || null, message.musicTrimStartMs || 0]
      }, (results) => {
        if (chrome.runtime.lastError || !results?.[0]) {
          clearTimeout(timeoutId);
          replyOnce({ success: false, error: chrome.runtime.lastError?.message || "Failed to run request in page context" });
          return;
        }
        clearTimeout(timeoutId);
        replyOnce(results[0].result);
      });
    });
    return true;
  }
  if (message.type === "GET_CURRENT_NOTE_STATUS") {
    let replied = false;
    const replyOnce = (payload) => {
      if (replied) return;
      replied = true;
      sendResponse(payload);
    };
    const timeoutId = setTimeout(() => {
      replyOnce({ success: false, error: "GET_CURRENT_NOTE_STATUS timeout: no response from tab context" });
    }, 2e4);
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (!tabs[0]?.id) {
        clearTimeout(timeoutId);
        replyOnce({ success: false, error: "No active tab found" });
        return;
      }
      const activeUrl = tabs[0].url || "";
      if (!activeUrl.includes("facebook.com")) {
        clearTimeout(timeoutId);
        replyOnce({ success: false, error: "Open facebook.com tab before fetching note status" });
        return;
      }
      chrome.scripting.executeScript({
        target: { tabId: tabs[0].id },
        func: fetchCurrentNoteStatusFromPage,
        args: [message.tokens]
      }, (results) => {
        if (chrome.runtime.lastError || !results?.[0]) {
          clearTimeout(timeoutId);
          replyOnce({ success: false, error: chrome.runtime.lastError?.message || "Failed to fetch current note status in page context" });
          return;
        }
        clearTimeout(timeoutId);
        replyOnce(results[0].result);
      });
    });
    return true;
  }
  if (message.type === "SEARCH_MUSIC") {
    let replied = false;
    const replyOnce = (payload) => {
      if (replied) return;
      replied = true;
      sendResponse(payload);
    };
    const timeoutId = setTimeout(() => {
      replyOnce({ success: false, error: "SEARCH_MUSIC timeout: no response from tab context" });
    }, 2e4);
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (!tabs[0]?.id) {
        clearTimeout(timeoutId);
        replyOnce({ success: false, error: "No active tab found" });
        return;
      }
      const activeUrl = tabs[0].url || "";
      if (!activeUrl.includes("facebook.com")) {
        clearTimeout(timeoutId);
        replyOnce({ success: false, error: "Open facebook.com tab before searching music" });
        return;
      }
      chrome.scripting.executeScript({
        target: { tabId: tabs[0].id },
        func: searchMusicFromPage,
        args: [message.tokens, message.query, message.count ?? 80]
      }, (results) => {
        if (chrome.runtime.lastError || !results?.[0]) {
          clearTimeout(timeoutId);
          replyOnce({ success: false, error: chrome.runtime.lastError?.message || "Failed to search music in page context" });
          return;
        }
        clearTimeout(timeoutId);
        replyOnce(results[0].result);
      });
    });
    return true;
  }
  if (message.type === "SEARCH_FRIENDS") {
    let replied = false;
    const replyOnce = (payload) => {
      if (replied) return;
      replied = true;
      sendResponse(payload);
    };
    const timeoutId = setTimeout(() => {
      replyOnce({ success: false, error: "SEARCH_FRIENDS timeout: no response from tab context" });
    }, 2e4);
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (!tabs[0]?.id) {
        clearTimeout(timeoutId);
        replyOnce({ success: false, error: "No active tab found" });
        return;
      }
      const activeUrl = tabs[0].url || "";
      if (!activeUrl.includes("facebook.com")) {
        clearTimeout(timeoutId);
        replyOnce({ success: false, error: "Open facebook.com tab before searching friends" });
        return;
      }
      chrome.scripting.executeScript({
        target: { tabId: tabs[0].id },
        func: searchFriendsFromPage,
        args: [message.tokens, message.query, message.cursor ?? null, message.count ?? 20]
      }, (results) => {
        if (chrome.runtime.lastError || !results?.[0]) {
          clearTimeout(timeoutId);
          replyOnce({ success: false, error: chrome.runtime.lastError?.message || "Failed to search friends in page context" });
          return;
        }
        clearTimeout(timeoutId);
        replyOnce(results[0].result);
      });
    });
    return true;
  }
  if (message.type === "DELETE_NOTE") {
    let replied = false;
    const replyOnce = (payload) => {
      if (replied) return;
      replied = true;
      sendResponse(payload);
    };
    const timeoutId = setTimeout(() => {
      replyOnce({ success: false, error: "DELETE_NOTE timeout: no response from tab context" });
    }, 2e4);
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (!tabs[0]?.id) {
        clearTimeout(timeoutId);
        replyOnce({ success: false, error: "No active tab found" });
        return;
      }
      const activeUrl = tabs[0].url || "";
      if (!activeUrl.includes("facebook.com")) {
        clearTimeout(timeoutId);
        replyOnce({ success: false, error: "Open facebook.com tab before deleting a note" });
        return;
      }
      chrome.scripting.executeScript({
        target: { tabId: tabs[0].id },
        func: deleteNoteFromPage,
        args: [message.tokens, message.richStatusId]
      }, (results) => {
        if (chrome.runtime.lastError || !results?.[0]) {
          clearTimeout(timeoutId);
          replyOnce({ success: false, error: chrome.runtime.lastError?.message || "Failed to run delete request in page context" });
          return;
        }
        clearTimeout(timeoutId);
        replyOnce(results[0].result);
      });
    });
    return true;
  }
  if (message.type === "PLAY_MUSIC") {
    let replied = false;
    const replyOnce = (payload) => {
      if (replied) return;
      replied = true;
      sendResponse(payload);
    };
    const timeoutId = setTimeout(() => {
      replyOnce({ success: false, error: "PLAY_MUSIC timeout: no response from tab context" });
    }, 2e4);
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (!tabs[0]?.id) {
        clearTimeout(timeoutId);
        replyOnce({ success: false, error: "No active tab found" });
        return;
      }
      const activeUrl = tabs[0].url || "";
      if (!activeUrl.includes("facebook.com")) {
        clearTimeout(timeoutId);
        replyOnce({ success: false, error: "Open facebook.com tab before playing music" });
        return;
      }
      chrome.scripting.executeScript({
        target: { tabId: tabs[0].id },
        func: playMusicFromPage,
        args: [message.tokens, message.musicId, message.songId, message.audioClusterId]
      }, (results) => {
        if (chrome.runtime.lastError || !results?.[0]) {
          clearTimeout(timeoutId);
          replyOnce({ success: false, error: chrome.runtime.lastError?.message || "Failed to play music in page context" });
          return;
        }
        clearTimeout(timeoutId);
        replyOnce(results[0].result);
      });
    });
    return true;
  }

  if (message.type === "MEDIA_PLAYBACK_STATE") {
    const playback = message.playback;
    if (sender.tab) {
      activeMediaTabId = sender.tab.id;
    }

    chrome.storage.local.get({
      automationEnabled: true,
      startTime: "08:00",
      endTime: "22:00",
      lastSentSong: null
    }, (settings) => {
      if (!settings.automationEnabled) return;

      if (!isWithinTimeWindow(settings.startTime, settings.endTime)) {
        console.log("[NotesRPC] Outside active time window. Automation halted.");
        return;
      }

      const lastSent = settings.lastSentSong;
      const isSameSong = lastSent && 
        lastSent.title === playback.title && 
        lastSent.artist === playback.artist && 
        lastSent.isPlaying === playback.isPlaying;

      if (isSameSong) {
        return;
      }

      routeUpdateToFacebook(playback);
    });
  }

  if (message.type === "SETTINGS_CHANGED") {
    chrome.storage.local.get({
      automationEnabled: true,
      startTime: "08:00",
      endTime: "22:00"
    }, (settings) => {
      if (!settings.automationEnabled || !isWithinTimeWindow(settings.startTime, settings.endTime)) {
        // Clear note immediately
        const idlePlayback = { title: "", artist: "", isPlaying: false };
        routeUpdateToFacebook(idlePlayback);
      } else {
        // Active and enabled. Probe open media tabs to report state immediately
        chrome.tabs.query({}, (tabs) => {
          const mediaTabs = tabs.filter(tab => tab.url && tab.url.includes("music.youtube.com"));
          mediaTabs.forEach(tab => {
            chrome.tabs.sendMessage(tab.id, { type: "FORCE_REPORT_STATE" }, () => {
              if (chrome.runtime.lastError) {
                // normal
              }
            });
          });
        });
      }
    });
  }
});

// Watch tab closure to handle idle state (tab closed)
chrome.tabs.onRemoved.addListener((tabId, removeInfo) => {
  if (tabId === activeMediaTabId) {
    activeMediaTabId = null;
    
    chrome.storage.local.get({
      automationEnabled: true,
      startTime: "08:00",
      endTime: "22:00"
    }, (settings) => {
      if (!settings.automationEnabled) return;
      if (!isWithinTimeWindow(settings.startTime, settings.endTime)) return;

      // Closed media tab -> transition to no music playing
      const idlePlayback = { title: "", artist: "", isPlaying: false };
      routeUpdateToFacebook(idlePlayback);
    });
  }
});

function isWithinTimeWindow(startTimeStr, endTimeStr) {
  if (!startTimeStr || !endTimeStr) return true;
  
  const now = new Date();
  const currentMinutes = now.getHours() * 60 + now.getMinutes();
  
  const parseTimeToMinutes = (timeStr) => {
    const match = timeStr.match(/^(\d+):(\d+)\s*(AM|PM)?$/i);
    if (!match) return null;
    
    let hours = parseInt(match[1], 10);
    const minutes = parseInt(match[2], 10);
    const ampm = match[3];
    
    if (ampm) {
      if (ampm.toUpperCase() === "PM" && hours < 12) hours += 12;
      if (ampm.toUpperCase() === "AM" && hours === 12) hours = 0;
    }
    
    return hours * 60 + minutes;
  };
  
  const startMinutes = parseTimeToMinutes(startTimeStr);
  const endMinutes = parseTimeToMinutes(endTimeStr);
  
  if (startMinutes === null || endMinutes === null) return true;
  
  if (startMinutes <= endMinutes) {
    return currentMinutes >= startMinutes && currentMinutes <= endMinutes;
  } else {
    return currentMinutes >= startMinutes || currentMinutes <= endMinutes;
  }
}

let isRouting = false;
let pendingPlayback = null;

async function saveToHistory(title, success) {
  if (!title) return;
  const data = await chrome.storage.local.get({ history: [] });
  const history = data.history;
  history.unshift({
    title,
    timestamp: Date.now(),
    status: success ? 'success' : 'error'
  });
  if (history.length > 20) history.pop();
  await chrome.storage.local.set({ history });
}

async function routeUpdateToFacebook(playback) {
  if (isRouting) {
    pendingPlayback = playback;
    return;
  }
  isRouting = true;

  try {
    const allTabs = await chrome.tabs.query({});
    const fbTabs = allTabs.filter(tab =>
      tab.url && (tab.url.includes("facebook.com") || tab.url.includes("messenger.com"))
    );

    if (fbTabs.length === 0) {
      console.warn("[NotesRPC] No Facebook/Messenger tab open.");
      return;
    }

    const fbTab = fbTabs[0];

    // Step 1: Extract tokens directly from the Facebook page
    const tokenResults = await chrome.scripting.executeScript({
      target: { tabId: fbTab.id },
      func: getPageInfo
    });

    if (!tokenResults?.[0]?.result) {
      console.warn("[NotesRPC] Failed to get page info from Facebook tab.");
      return;
    }

    const { cookie, html } = tokenResults[0].result;
    const tokens = extractTokens(cookie, html);

    if (!tokens) {
      console.warn("[NotesRPC] Could not extract tokens. Ensure you are logged into Facebook.");
      return;
    }

    // Persist last sent song for popup display
    chrome.storage.local.set({ lastSentSong: playback });

    const { audienceSetting = "FRIENDS", customFriendIds = [] } = await chrome.storage.local.get(["audienceSetting", "customFriendIds"]);

    // Case 1: No song loaded — post a placeholder note
    if (!playback.title) {
      const r = await chrome.scripting.executeScript({
        target: { tabId: fbTab.id },
        func: createNoteFromPage,
        args: [tokens, "\uD83D\uDEAB No music playing", 86400, audienceSetting, customFriendIds, null, 0]
      });
      console.log("[NotesRPC] Note set to: 🚫 No music playing", r?.[0]?.result);
      return;
    }

    // Case 2: Song loaded — search Facebook music catalogue
    const searchQuery = `${playback.title} ${playback.artist}`;
    const searchResults = await chrome.scripting.executeScript({
      target: { tabId: fbTab.id },
      func: searchMusicFromPage,
      args: [tokens, searchQuery, 20]
    });

    const musicResult = searchResults?.[0]?.result;
    if (!musicResult?.success || !musicResult.items?.length) {
      console.warn(`[NotesRPC] No music search results for: "${searchQuery}"`);
      return;
    }

    const bestMatch = findBestMusicMatch(musicResult.items, playback.title, playback.artist);
    if (!bestMatch) {
      console.warn(`[NotesRPC] Could not match track: "${searchQuery}"`);
      return;
    }

    // Playing → attach playing label; Paused → attach pause label
    const description = playback.isPlaying ? "🎵 Playing on YT Music" : "⏸️ Song paused";

    const createResult = await chrome.scripting.executeScript({
      target: { tabId: fbTab.id },
      func: createNoteFromPage,
      args: [tokens, description, 86400, audienceSetting, customFriendIds, bestMatch, 0]
    });

    const result = createResult?.[0]?.result;
    if (result?.success) {
      console.log(`[NotesRPC] ✅ Note posted: "${playback.title}" | Paused: ${!playback.isPlaying}`);
      saveToHistory(playback.title, true);
    } else {
      console.warn("[NotesRPC] ❌ Note creation failed:", result?.error);
      saveToHistory(playback.title, false);
    }

  } catch (err) {
    console.error("[NotesRPC] routeUpdateToFacebook threw:", err);
  } finally {
    isRouting = false;
    if (pendingPlayback) {
      const nextPlayback = pendingPlayback;
      pendingPlayback = null;
      routeUpdateToFacebook(nextPlayback);
    }
  }
}

function findBestMusicMatch(items, targetTitle, targetArtist) {
  const n = (s) => (s || "").toLowerCase().replace(/[^a-z0-9\s]/g, "").trim();
  const t = n(targetTitle);
  const a = n(targetArtist);
  // 1. Exact match
  for (const item of items) {
    if (n(item.title) === t && n(item.artist) === a) return item;
  }
  // 2. Substring match on both
  for (const item of items) {
    const it = n(item.title);
    const ia = n(item.artist);
    if ((it.includes(t) || t.includes(it)) && (ia.includes(a) || a.includes(ia))) return item;
  }
  // 3. Title only
  for (const item of items) {
    const it = n(item.title);
    if (it.includes(t) || t.includes(it)) return item;
  }
  // 4. First result fallback
  return items[0] || null;
}
function getPageInfo() {
  return {
    cookie: document.cookie,
    html: document.documentElement.innerHTML
  };
}
async function createNoteFromPage(tokens, description, duration, audienceSetting, selectedFriendIds, selectedMusic, musicTrimStartMs) {
  const isSafeToken = (value) => {
    return typeof value === "string" && /^[A-Za-z0-9:_-]{6,300}$/.test(value);
  };
  const extract = (source, regex) => {
    const match = regex.exec(source);
    return match?.[1] || "";
  };
  const pageHtml = document.documentElement.outerHTML;
  const spinR = extract(pageHtml, /"__spin_r":(\d+)/);
  const spinB = extract(pageHtml, /"__spin_b":"([^"]+)"/);
  const spinT = extract(pageHtml, /"__spin_t":(\d+)/);
  const rev = extract(pageHtml, /"client_revision":(\d+)/);
  const hsi = extract(pageHtml, /"hsi":"(\d+)"/);
  const ccg = extract(pageHtml, /"__ccg":"([^"]+)"/);
  const cometReq = extract(pageHtml, /"__comet_req":"?([^",}]+)"?/);
  const sendGraphQL = async (friendlyName, docId, variables) => {
    const body = new URLSearchParams();
    body.append("av", tokens.userId);
    body.append("__user", tokens.userId);
    body.append("__a", "1");
    body.append("__comet_req", cometReq || "15");
    if (ccg) body.append("__ccg", ccg);
    body.append("dpr", String(self.devicePixelRatio || 1));
    body.append("fb_dtsg", tokens.fb_dtsg);
    body.append("jazoest", tokens.jazoest);
    if (isSafeToken(tokens.lsd)) body.append("lsd", tokens.lsd);
    if (spinR) body.append("__spin_r", spinR);
    if (spinB) body.append("__spin_b", spinB);
    body.append("__spin_t", spinT || String(Math.floor(Date.now() / 1e3)));
    if (rev) body.append("__rev", rev);
    if (hsi) body.append("__hsi", hsi);
    body.append("fb_api_caller_class", "RelayModern");
    body.append("fb_api_req_friendly_name", friendlyName);
    body.append("server_timestamps", "true");
    body.append("variables", JSON.stringify(variables));
    body.append("doc_id", docId);
    const response = await fetch("/api/graphql/", {
      method: "POST",
      credentials: "include",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "X-FB-Friendly-Name": friendlyName
      },
      body: body.toString()
    });
    const text = await response.text();
    const jsonText = text.replace("for (;;);", "").trim();
    let json;
    try {
      json = JSON.parse(jsonText);
    } catch {
      return { ok: false, error: `Invalid JSON response: ${jsonText.slice(0, 220)}` };
    }
    if (json?.error) {
      const summary = json.errorSummary || "GraphQL request failed";
      const descriptionText = json.errorDescription || "";
      return { ok: false, error: `${summary}${descriptionText ? ` - ${descriptionText}` : ""} (code: ${json.error})` };
    }
    if (Array.isArray(json?.errors) && json.errors.length > 0) {
      return { ok: false, error: json.errors[0]?.message || "GraphQL error" };
    }
    return { ok: true, json };
  };
  const normalizedDescription = typeof description === "string" ? description.trim() : "";
  const hasMusic = Boolean(selectedMusic?.id);
  if (!normalizedDescription && !hasMusic) {
    return { success: false, error: "Note content is empty and no music selected" };
  }
  const mapAudienceToPrivacy = (setting) => {
    switch (setting) {
      case "PUBLIC": return "PUBLIC";
      case "FRIENDS": return "FRIENDS";
      default: return "FRIENDS"; // DEFAULT -> FRIENDS
    }
  };
  const baseInput = {
    actor_id: tokens.userId,
    client_mutation_id: String(Math.round(Math.random() * 1000000)),
    audience_list_type: "BLOCKLIST",
    description: normalizedDescription,
    duration,
    note_type: "TEXT_NOTE",
    privacy: mapAudienceToPrivacy(audienceSetting),
    session_id: ""
  };
  const preferredAudioClusterId = selectedMusic ? selectedMusic.songId || selectedMusic.audioClusterId || null : null;
  const withMusicInput = selectedMusic ? normalizedDescription ? {
    ...baseInput,
    description: normalizedDescription,
    note_type: "MUSIC_NOTE_WITH_TEXT",
    audio_cluster_id: preferredAudioClusterId,
    song_start_time_ms: musicTrimStartMs
  } : {
    ...baseInput,
    description: null,
    note_type: "MUSIC_NOTE_MUSIC_ONLY",
    audio_cluster_id: preferredAudioClusterId,
    song_start_time_ms: musicTrimStartMs
  } : null;
  const buildMusicInputVariants = () => {
    if (!selectedMusic) return [];
    const audioClusterCandidates = Array.from(
      new Set(
        [selectedMusic.songId, selectedMusic.audioClusterId].filter((v) => typeof v === "string" && v.length > 0)
      )
    );
    const variants = [];
    for (const audioClusterId of audioClusterCandidates) {
      if (normalizedDescription) {
        variants.push({
          ...baseInput,
          client_mutation_id: String(Date.now() % 9 + 1),
          description: normalizedDescription,
          note_type: "MUSIC_NOTE_WITH_TEXT",
          audio_cluster_id: audioClusterId,
          song_start_time_ms: musicTrimStartMs
        });
        variants.push({
          ...baseInput,
          client_mutation_id: String(Date.now() % 9 + 1),
          description: normalizedDescription,
          note_type: "MUSIC_NOTE",
          audio_cluster_id: audioClusterId,
          song_start_time_ms: musicTrimStartMs
        });
      } else {
        variants.push({
          ...baseInput,
          client_mutation_id: String(Date.now() % 9 + 1),
          description: null,
          note_type: "MUSIC_NOTE_MUSIC_ONLY",
          audio_cluster_id: audioClusterId,
          song_start_time_ms: musicTrimStartMs
        });
        variants.push({
          ...baseInput,
          client_mutation_id: String(Date.now() % 9 + 1),
          description: "",
          note_type: "MUSIC_NOTE",
          audio_cluster_id: audioClusterId,
          song_start_time_ms: musicTrimStartMs
        });
      }
    }
    return variants;
  };
  try {
    if (selectedMusic && !preferredAudioClusterId) {
      return { success: false, error: "Music metadata missing song ID/audio cluster ID. Please reselect the track." };
    }
    if (audienceSetting === "CUSTOM") {
      if (!Array.isArray(selectedFriendIds) || selectedFriendIds.length === 0) {
        return { success: false, error: "Please select at least one friend for Custom audience" };
      }
      const customParticipantsResult = await sendGraphQL(
        "MWInboxTrayNoteCreationSelectorCustomParticipantsMutation",
        "23863727389920891",
        {
          input: {
            user_ids: selectedFriendIds,
            actor_id: tokens.userId,
            client_mutation_id: String(Date.now())
          }
        }
      );
      if (!customParticipantsResult.ok) {
        return { success: false, error: `Custom friends save failed: ${customParticipantsResult.error}` };
      }
    }
    const createInputCandidates = [];
    if (withMusicInput) {
      createInputCandidates.push(withMusicInput, ...buildMusicInputVariants());
    } else {
      createInputCandidates.push(baseInput);
    }
    const seenInputs = /* @__PURE__ */ new Set();
    const uniqueCandidates = createInputCandidates.filter((candidate) => {
      const key = JSON.stringify(candidate);
      if (seenInputs.has(key)) return false;
      seenInputs.add(key);
      return true;
    });
    let createResult = { ok: false, error: "No mutation candidates generated" };
    const createErrors = [];
    for (const candidate of uniqueCandidates) {
      createResult = await sendGraphQL(
        "useMWInboxTrayCreateNoteMutation",
        "25742693715382390",
        { input: candidate }
      );
      if (createResult.ok) {
        break;
      }
      if (createResult.error) {
        createErrors.push(createResult.error);
      }
    }
    if (!createResult.ok) {
      if (withMusicInput) {
        return {
          success: false,
          error: `Failed to create music note. The request was not downgraded to TEXT_NOTE. ${createErrors.slice(0, 3).join(" | ") || createResult.error || ""}`
        };
      }
      const mergedErrors = createErrors.length > 0 ? ` (${createErrors.slice(0, 3).join(" | ")})` : "";
      return { success: false, error: `${createResult.error || "Failed to create note"}${mergedErrors}` };
    }
    const data = createResult.json?.data;
    if (!data || typeof data !== "object") {
      return { success: false, error: `No data returned from GraphQL: ${JSON.stringify(createResult.json).slice(0, 220)}` };
    }
    const createdStatus = data.xfb_rich_status_create?.status;
    const hasCreatedStatus = Boolean(createdStatus?.id);
    const hasMutationPayload = hasCreatedStatus || Object.entries(data).some(([key, value]) => {
      const normalized = key.toLowerCase();
      if (!normalized.includes("createnote") && !normalized.includes("inboxtray") && !normalized.includes("rich_status")) {
        return false;
      }
      return value !== null && value !== void 0;
    });
    if (!hasMutationPayload) {
      return { success: false, error: `Mutation result is empty: ${JSON.stringify(data).slice(0, 220)}` };
    }
    return { success: true };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Unknown error from page request"
    };
  }
}
async function deleteNoteFromPage(tokens, richStatusId) {
  const isSafeToken = (value) => {
    return typeof value === "string" && /^[A-Za-z0-9:_-]{6,300}$/.test(value);
  };
  const extract = (source, regex) => {
    const match = regex.exec(source);
    return match?.[1] || "";
  };
  const safeRichStatusId = typeof richStatusId === "string" ? richStatusId.trim() : "";
  if (!/^[0-9]{5,30}$/.test(safeRichStatusId)) {
    return { success: false, error: "Invalid rich status id" };
  }
  const pageHtml = document.documentElement.outerHTML;
  const spinR = extract(pageHtml, /"__spin_r":(\d+)/);
  const spinB = extract(pageHtml, /"__spin_b":"([^"]+)"/);
  const spinT = extract(pageHtml, /"__spin_t":(\d+)/);
  const rev = extract(pageHtml, /"client_revision":(\d+)/);
  const hsi = extract(pageHtml, /"hsi":"(\d+)"/);
  const ccg = extract(pageHtml, /"__ccg":"([^"]+)"/);
  const cometReq = extract(pageHtml, /"__comet_req":"?([^",}]+)"?/);
  const body = new URLSearchParams();
  body.append("av", tokens.userId);
  body.append("__user", tokens.userId);
  body.append("__a", "1");
  body.append("__comet_req", cometReq || "15");
  if (ccg) body.append("__ccg", ccg);
  body.append("dpr", String(self.devicePixelRatio || 1));
  body.append("fb_dtsg", tokens.fb_dtsg);
  body.append("jazoest", tokens.jazoest);
  if (isSafeToken(tokens.lsd)) body.append("lsd", tokens.lsd);
  if (spinR) body.append("__spin_r", spinR);
  if (spinB) body.append("__spin_b", spinB);
  body.append("__spin_t", spinT || String(Math.floor(Date.now() / 1e3)));
  if (rev) body.append("__rev", rev);
  if (hsi) body.append("__hsi", hsi);
  body.append("fb_api_caller_class", "RelayModern");
  body.append("fb_api_req_friendly_name", "useMWInboxTrayDeleteNoteMutation");
  body.append("server_timestamps", "true");
  body.append("variables", JSON.stringify({
    input: {
      actor_id: tokens.userId,
      client_mutation_id: String(Date.now() % 9 + 1),
      rich_status_id: safeRichStatusId
    }
  }));
  body.append("doc_id", "9532619970198958");
  try {
    const response = await fetch("/api/graphql/", {
      method: "POST",
      credentials: "include",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "X-FB-Friendly-Name": "useMWInboxTrayDeleteNoteMutation"
      },
      body: body.toString()
    });
    const text = await response.text();
    const jsonText = text.replace("for (;;);", "").trim();
    let json;
    try {
      json = JSON.parse(jsonText);
    } catch {
      return { success: false, error: `Invalid JSON response: ${jsonText.slice(0, 220)}` };
    }
    if (json?.error) {
      const summary = json.errorSummary || "GraphQL request failed";
      const descriptionText = json.errorDescription || "";
      return { success: false, error: `${summary}${descriptionText ? ` - ${descriptionText}` : ""} (code: ${json.error})` };
    }
    if (Array.isArray(json?.errors) && json.errors.length > 0) {
      return { success: false, error: json.errors[0]?.message || "GraphQL error" };
    }
    return { success: true };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Unknown error while deleting note"
    };
  }
}
async function searchFriendsFromPage(tokens, query, cursor, count) {
  const extract = (source, regex) => {
    const match = regex.exec(source);
    return match?.[1] || "";
  };
  const pageHtml = document.documentElement.outerHTML;
  const spinR = extract(pageHtml, /"__spin_r":(\d+)/);
  const spinB = extract(pageHtml, /"__spin_b":"([^"]+)"/);
  const spinT = extract(pageHtml, /"__spin_t":(\d+)/);
  const rev = extract(pageHtml, /"client_revision":(\d+)/);
  const hsi = extract(pageHtml, /"hsi":"(\d+)"/);
  const ccg = extract(pageHtml, /"__ccg":"([^"]+)"/);
  const cometReq = extract(pageHtml, /"__comet_req":"?([^",}]+)"?/);
  const normalizedQuery = (query || "").normalize("NFC");
  const body = new URLSearchParams();
  body.append("av", tokens.userId);
  body.append("__user", tokens.userId);
  body.append("__a", "1");
  body.append("__comet_req", cometReq || "15");
  if (ccg) body.append("__ccg", ccg);
  body.append("dpr", String(self.devicePixelRatio || 1));
  body.append("fb_dtsg", tokens.fb_dtsg);
  body.append("jazoest", tokens.jazoest);
  if (tokens.lsd) body.append("lsd", tokens.lsd);
  if (spinR) body.append("__spin_r", spinR);
  if (spinB) body.append("__spin_b", spinB);
  body.append("__spin_t", spinT || String(Math.floor(Date.now() / 1e3)));
  if (rev) body.append("__rev", rev);
  if (hsi) body.append("__hsi", hsi);
  body.append("fb_api_caller_class", "RelayModern");
  const isPagination = Boolean(cursor);
  body.append(
    "fb_api_req_friendly_name",
    isPagination ? "StoriesCometPrivacySelectorFriendsBootstrapPaginationQuery" : "StoriesCometPrivacySelectorFriendsBootstrapViewQuery"
  );
  body.append("server_timestamps", "true");
  body.append("variables", JSON.stringify({ query: normalizedQuery, count, cursor, id: tokens.userId }));
  body.append("doc_id", isPagination ? "30431034176487438" : "9876530802468059");
  try {
    const response = await fetch("/api/graphql/", {
      method: "POST",
      credentials: "include",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "X-FB-Friendly-Name": isPagination ? "StoriesCometPrivacySelectorFriendsBootstrapPaginationQuery" : "StoriesCometPrivacySelectorFriendsBootstrapViewQuery"
      },
      body: body.toString()
    });
    const text = await response.text();
    const jsonText = text.replace("for (;;);", "").trim();
    let json;
    try {
      json = JSON.parse(jsonText);
    } catch {
      return { success: false, error: `Invalid JSON response: ${jsonText.slice(0, 220)}` };
    }
    if (json?.error) {
      const summary = json.errorSummary || "GraphQL request failed";
      const descriptionText = json.errorDescription || "";
      return { success: false, error: `${summary}${descriptionText ? ` - ${descriptionText}` : ""} (code: ${json.error})` };
    }
    if (Array.isArray(json?.errors) && json.errors.length > 0) {
      return { success: false, error: json.errors[0]?.message || "GraphQL error" };
    }
    const edges = json?.data?.user?.friends?.edges;
    const pageInfo = json?.data?.user?.friends?.page_info;
    if (!Array.isArray(edges)) {
      return { success: true, items: [], nextCursor: null, hasNextPage: false };
    }
    const items = [];
    for (const edge of edges) {
      const node = edge?.node;
      if (!node || typeof node !== "object") continue;
      const id = typeof node.id === "string" ? node.id : "";
      const name = typeof node.name === "string" ? node.name : "";
      const imageUri = typeof node?.photo?.uri === "string" ? node.photo.uri : void 0;
      if (!id || !name) continue;
      items.push({ id, name, imageUri });
    }
    const nextCursor = typeof pageInfo?.end_cursor === "string" ? pageInfo.end_cursor : null;
    const hasNextPage = Boolean(pageInfo?.has_next_page);
    return { success: true, items, nextCursor, hasNextPage };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Unknown error while searching friends"
    };
  }
}
async function searchMusicFromPage(tokens, query, count) {
  const extract = (source, regex) => {
    const match = regex.exec(source);
    return match?.[1] || "";
  };
  const pageHtml = document.documentElement.outerHTML;
  const spinR = extract(pageHtml, /"__spin_r":(\d+)/);
  const spinB = extract(pageHtml, /"__spin_b":"([^"]+)"/);
  const spinT = extract(pageHtml, /"__spin_t":(\d+)/);
  const rev = extract(pageHtml, /"client_revision":(\d+)/);
  const hsi = extract(pageHtml, /"hsi":"(\d+)"/);
  const ccg = extract(pageHtml, /"__ccg":"([^"]+)"/);
  const cometReq = extract(pageHtml, /"__comet_req":"?([^",}]+)"?/);
  const normalizedQuery = (query || "").normalize("NFC");
  const toStringId = (value) => {
    if (typeof value === "string" && value.length > 0) return value;
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
    return void 0;
  };
  const pickAudioClusterId = (item) => {
    return toStringId(item?.audio_cluster_id) || toStringId(item?.audio_cluster?.id) || toStringId(item?.audio_cluster?.audio_cluster_id) || toStringId(item?.audio_asset?.audio_cluster_id) || toStringId(item?.audio_asset?.id) || toStringId(item?.music_asset?.audio_cluster_id) || toStringId(item?.music_asset?.id) || toStringId(item?.track?.audio_cluster_id) || toStringId(item?.cluster_id);
  };
  const body = new URLSearchParams();
  body.append("av", tokens.userId);
  body.append("__user", tokens.userId);
  body.append("__a", "1");
  body.append("__comet_req", cometReq || "15");
  if (ccg) body.append("__ccg", ccg);
  body.append("dpr", String(self.devicePixelRatio || 1));
  body.append("fb_dtsg", tokens.fb_dtsg);
  body.append("jazoest", tokens.jazoest);
  if (tokens.lsd) body.append("lsd", tokens.lsd);
  if (spinR) body.append("__spin_r", spinR);
  if (spinB) body.append("__spin_b", spinB);
  body.append("__spin_t", spinT || String(Math.floor(Date.now() / 1e3)));
  if (rev) body.append("__rev", rev);
  if (hsi) body.append("__hsi", hsi);
  body.append("fb_api_caller_class", "RelayModern");
  body.append("fb_api_req_friendly_name", "useMWInboxTrayMusicNoteTypeaheadDataSourceQuery");
  body.append("server_timestamps", "true");
  const safeCount = Math.max(1, Math.min(count || 80, 120));
  body.append("variables", JSON.stringify({ params: { first: safeCount, search_text: normalizedQuery }, product: "FB_NOTES" }));
  body.append("doc_id", "24439058322365411");
  try {
    const response = await fetch("/api/graphql/", {
      method: "POST",
      credentials: "include",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "X-FB-Friendly-Name": "useMWInboxTrayMusicNoteTypeaheadDataSourceQuery"
      },
      body: body.toString()
    });
    const text = await response.text();
    const jsonText = text.replace("for (;;);", "").trim();
    let json;
    try {
      json = JSON.parse(jsonText);
    } catch {
      return { success: false, error: `Invalid JSON response: ${jsonText.slice(0, 220)}` };
    }
    if (json?.error) {
      const summary = json.errorSummary || "GraphQL request failed";
      const descriptionText = json.errorDescription || "";
      return { success: false, error: `${summary}${descriptionText ? ` - ${descriptionText}` : ""} (code: ${json.error})` };
    }
    if (Array.isArray(json?.errors) && json.errors.length > 0) {
      return { success: false, error: json.errors[0]?.message || "GraphQL error" };
    }
    const edges = json?.data?.xfb_music_picker_connection_container?.items?.edges;
    const itemsFromEdges = Array.isArray(edges) ? edges.flatMap((edge) => Array.isArray(edge?.node?.sub_items) ? edge.node.sub_items : []).map((item) => ({
      id: String(item?.display_id || item?.id || ""),
      songId: item?.song_id ? String(item.song_id) : void 0,
      audioClusterId: toStringId(item?.song_id) || pickAudioClusterId(item),
      title: String(item?.display_title?.text || ""),
      artist: String(item?.display_subtitle?.text || ""),
      imageUri: item?.display_image?.uri ? String(item.display_image.uri) : void 0,
      durationMs: typeof item?.duration_in_ms === "number" ? item.duration_in_ms : void 0,
      progressiveDownloadUrl: Array.isArray(item?.progressive_download) && item.progressive_download[0]?.url ? String(item.progressive_download[0].url) : void 0
    })).filter((item) => Boolean(item.id) && Boolean(item.title)) : [];
    const items = [];
    const seen = /* @__PURE__ */ new Set();
    for (const item of itemsFromEdges) {
      if (seen.has(item.id)) continue;
      seen.add(item.id);
      items.push(item);
      if (items.length >= safeCount) break;
    }
    if (items.length === 0) {
      const scan = (node) => {
        if (!node || typeof node !== "object") return;
        const isAudioAsset = node.__typename === "AudioAsset" || node.display_id && node.display_title && node.display_subtitle;
        if (isAudioAsset) {
          const id = String(node?.display_id || node?.id || "");
          const title = String(node?.display_title?.text || "");
          if (id && title && !seen.has(id)) {
            seen.add(id);
            items.push({
              id,
              songId: node?.song_id ? String(node.song_id) : void 0,
              audioClusterId: toStringId(node?.song_id) || pickAudioClusterId(node),
              title,
              artist: String(node?.display_subtitle?.text || ""),
              imageUri: node?.display_image?.uri ? String(node.display_image.uri) : void 0,
              durationMs: typeof node?.duration_in_ms === "number" ? node.duration_in_ms : void 0,
              progressiveDownloadUrl: Array.isArray(node?.progressive_download) && node.progressive_download[0]?.url ? String(node.progressive_download[0].url) : void 0
            });
            if (items.length >= safeCount) return;
          }
        }
        for (const value of Object.values(node)) {
          if (items.length >= safeCount) return;
          if (Array.isArray(value)) {
            for (const child of value) {
              scan(child);
              if (items.length >= safeCount) return;
            }
          } else if (value && typeof value === "object") {
            scan(value);
          }
        }
      };
      scan(json?.data);
    }
    return { success: true, items };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Unknown error while searching music"
    };
  }
}
async function fetchCurrentNoteStatusFromPage(tokens) {
  const isSafeToken = (value) => {
    return typeof value === "string" && /^[A-Za-z0-9:_-]{6,300}$/.test(value);
  };
  const extract = (source, regex) => {
    const match = regex.exec(source);
    return match?.[1] || "";
  };
  const pageHtml = document.documentElement.outerHTML;
  const spinR = extract(pageHtml, /"__spin_r":(\d+)/);
  const spinB = extract(pageHtml, /"__spin_b":"([^"]+)"/);
  const spinT = extract(pageHtml, /"__spin_t":(\d+)/);
  const rev = extract(pageHtml, /"client_revision":(\d+)/);
  const hsi = extract(pageHtml, /"hsi":"(\d+)"/);
  const ccg = extract(pageHtml, /"__ccg":"([^"]+)"/);
  const cometReq = extract(pageHtml, /"__comet_req":"?([^",}]+)"?/);
  const body = new URLSearchParams();
  body.append("av", tokens.userId);
  body.append("__user", tokens.userId);
  body.append("__a", "1");
  body.append("__comet_req", cometReq || "15");
  if (ccg) body.append("__ccg", ccg);
  body.append("dpr", String(self.devicePixelRatio || 1));
  body.append("fb_dtsg", tokens.fb_dtsg);
  body.append("jazoest", tokens.jazoest);
  if (isSafeToken(tokens.lsd)) body.append("lsd", tokens.lsd);
  if (spinR) body.append("__spin_r", spinR);
  if (spinB) body.append("__spin_b", spinB);
  body.append("__spin_t", spinT || String(Math.floor(Date.now() / 1e3)));
  if (rev) body.append("__rev", rev);
  if (hsi) body.append("__hsi", hsi);
  body.append("fb_api_caller_class", "RelayModern");
  body.append("fb_api_req_friendly_name", "MWInboxTrayNoteCreationDialogQuery");
  body.append("server_timestamps", "true");
  body.append("variables", JSON.stringify({ scale: 1 }));
  body.append("doc_id", "26067429279547490");
  try {
    const response = await fetch("/api/graphql/", {
      method: "POST",
      credentials: "include",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "X-FB-Friendly-Name": "MWInboxTrayNoteCreationDialogQuery"
      },
      body: body.toString()
    });
    const text = await response.text();
    const jsonText = text.replace("for (;;);", "").trim();
    let json;
    try {
      json = JSON.parse(jsonText);
    } catch {
      return { success: false, error: `Invalid JSON response: ${jsonText.slice(0, 220)}` };
    }
    if (json?.error) {
      const summary = json.errorSummary || "GraphQL request failed";
      const descriptionText = json.errorDescription || "";
      return { success: false, error: `${summary}${descriptionText ? ` - ${descriptionText}` : ""} (code: ${json.error})` };
    }
    if (Array.isArray(json?.errors) && json.errors.length > 0) {
      return { success: false, error: json.errors[0]?.message || "GraphQL error" };
    }
    const actor = json?.data?.viewer?.actor;
    const status = actor?.msgr_user_rich_status;
    const findRichStatusIdDeep = (root) => {
      const seen = /* @__PURE__ */ new Set();
      const stack = [root];
      while (stack.length > 0) {
        const node = stack.pop();
        if (!node || typeof node !== "object") continue;
        if (seen.has(node)) continue;
        seen.add(node);
        const candidate = node.rich_status_id ?? node.richStatusId;
        if (typeof candidate === "string" && /^[0-9]{5,30}$/.test(candidate)) {
          return candidate;
        }
        const maybeId = node.id;
        const maybeType = node.__typename;
        if (typeof maybeId === "string" && /^[0-9]{5,30}$/.test(maybeId) && (typeof maybeType !== "string" || /rich|status/i.test(maybeType))) {
          return maybeId;
        }
        for (const value of Object.values(node)) {
          if (!value) continue;
          if (typeof value === "object") {
            stack.push(value);
          }
        }
      }
      return null;
    };
    const richStatusId = typeof status?.id === "string" && /^[0-9]{5,30}$/.test(status.id) ? status.id : typeof status?.rich_status_id === "string" && /^[0-9]{5,30}$/.test(status.rich_status_id) ? status.rich_status_id : findRichStatusIdDeep(json?.data);
    const musicMeta = status?.music_metadata;
    const licenseMusic = Array.isArray(musicMeta?.license_music) ? musicMeta.license_music[0] : null;
    const musicTitle = typeof licenseMusic?.title?.text === "string" ? licenseMusic.title.text : typeof musicMeta?.title === "string" ? musicMeta.title : null;
    const musicArtist = typeof licenseMusic?.display_artist?.text === "string" ? licenseMusic.display_artist.text : typeof musicMeta?.artist_name === "string" ? musicMeta.artist_name : null;
    const customAudience = Array.isArray(status?.custom_audience) ? status.custom_audience : Array.isArray(actor?.lightweight_status_custom_audience_list) ? actor.lightweight_status_custom_audience_list : [];
    const customAudienceNames = customAudience.map((item) => {
      if (typeof item?.short_name === "string" && item.short_name.length > 0) return item.short_name;
      if (typeof item?.name === "string" && item.name.length > 0) return item.name;
      return null;
    }).filter((name) => Boolean(name));
    return {
      success: true,
      status: {
        richStatusId,
        avatarUri: typeof actor?.profilePicture?.uri === "string" ? actor.profilePicture.uri : void 0,
        description: typeof status?.description === "string" ? status.description : null,
        noteType: typeof status?.note_type === "string" ? status.note_type : null,
        visibility: typeof status?.visibility === "string" ? status.visibility : null,
        expirationTime: typeof status?.expiration_time === "number" ? status.expiration_time : null,
        musicTitle,
        musicArtist,
        customAudienceNames,
        customAudienceSize: typeof status?.custom_audience_size === "number" ? status.custom_audience_size : null,
        defaultAudienceSetting: typeof json?.data?.xfb_fetch_default_note_audience_setting === "string" ? json.data.xfb_fetch_default_note_audience_setting : null
      }
    };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Unknown error while fetching current note status"
    };
  }
}
async function playMusicFromPage(tokens, musicId, songId, audioClusterId) {
  const isSafeToken = (value) => {
    return typeof value === "string" && /^[A-Za-z0-9:_-]{6,300}$/.test(value);
  };
  const extract = (source, regex) => {
    const match = regex.exec(source);
    return match?.[1] || "";
  };
  const pageHtml = document.documentElement.outerHTML;
  const spinR = extract(pageHtml, /"__spin_r":(\d+)/);
  const spinB = extract(pageHtml, /"__spin_b":"([^"]+)"/);
  const spinT = extract(pageHtml, /"__spin_t":(\d+)/);
  const rev = extract(pageHtml, /"client_revision":(\d+)/);
  const hsi = extract(pageHtml, /"hsi":"(\d+)"/);
  const ccg = extract(pageHtml, /"__ccg":"([^"]+)"/);
  const cometReq = extract(pageHtml, /"__comet_req":"?([^",}]+)"?/);
  const audioClusterIdValue = songId || audioClusterId || musicId;
  const body = new URLSearchParams();
  body.append("av", tokens.userId);
  body.append("__user", tokens.userId);
  body.append("__a", "1");
  body.append("__comet_req", cometReq || "15");
  if (ccg) body.append("__ccg", ccg);
  body.append("dpr", String(self.devicePixelRatio || 1));
  body.append("fb_dtsg", tokens.fb_dtsg);
  body.append("jazoest", tokens.jazoest);
  if (isSafeToken(tokens.lsd)) body.append("lsd", tokens.lsd);
  if (spinR) body.append("__spin_r", spinR);
  if (spinB) body.append("__spin_b", spinB);
  body.append("__spin_t", spinT || String(Math.floor(Date.now() / 1e3)));
  if (rev) body.append("__rev", rev);
  if (hsi) body.append("__hsi", hsi);
  body.append("fb_api_caller_class", "RelayModern");
  body.append("fb_api_req_friendly_name", "MWInboxTrayMusicNotePlayerQuery");
  body.append("server_timestamps", "true");
  body.append("variables", JSON.stringify({
    audio_cluster_id: audioClusterIdValue,
    product: "FB_NOTES"
  }));
  body.append("doc_id", "7296254287127256");
  try {
    const response = await fetch("/api/graphql/", {
      method: "POST",
      credentials: "include",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "X-FB-Friendly-Name": "MWInboxTrayMusicNotePlayerQuery"
      },
      body: body.toString()
    });
    const text = await response.text();
    const jsonText = text.replace("for (;;);", "").trim();
    let json;
    try {
      json = JSON.parse(jsonText);
    } catch {
      return { success: false, error: `Invalid JSON response: ${jsonText.slice(0, 220)}` };
    }
    if (json?.error) {
      const summary = json.errorSummary || "GraphQL request failed";
      const descriptionText = json.errorDescription || "";
      return { success: false, error: `${summary}${descriptionText ? ` - ${descriptionText}` : ""} (code: ${json.error})` };
    }
    if (Array.isArray(json?.errors) && json.errors.length > 0) {
      return { success: false, error: json.errors[0]?.message || "GraphQL error" };
    }
    const findProgressiveDownload = (node) => {
      if (!node || typeof node !== "object") return null;
      if (typeof node.progressive_download === "string" && node.progressive_download.length > 0) {
        return node.progressive_download;
      }
      if (typeof node.progressive_download_url === "string" && node.progressive_download_url.length > 0) {
        return node.progressive_download_url;
      }
      if (typeof node.audio_url === "string" && node.audio_url.length > 0) {
        return node.audio_url;
      }
      if (typeof node.play_url === "string" && node.play_url.length > 0) {
        return node.play_url;
      }
      if (typeof node.uri === "string" && node.uri.includes("audio") && node.uri.length > 0) {
        return node.uri;
      }
      if (typeof node.url === "string" && node.url.includes("audio") && node.url.length > 0) {
        return node.url;
      }
      for (const value of Object.values(node)) {
        if (value && typeof value === "object") {
          const result = findProgressiveDownload(value);
          if (result) return result;
        }
      }
      return null;
    };
    const progressiveDownload = findProgressiveDownload(json?.data);
    if (!progressiveDownload) {
      return { success: false, error: "No audio URL found in response" };
    }
    return { success: true, progressiveDownload };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Unknown error while playing music"
    };
  }
}
