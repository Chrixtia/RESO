/**
 * @fileoverview RESO - Background Service Worker
 *
 * @description Central service worker handling Chrome runtime messaging, Facebook GraphQL note creation, media playback synchronization, and active time-window filtering.
 * @author @Chrixtia
 */

import { isWithinTimeWindow } from "./utils/time.js";
import type {
  FacebookTokens,
  PlaybackState,
  ExtensionSettings,
  HistoryItem,
  MusicItem,
  FriendItem,
  PageInfoResult,
  ApiResponse,
  CurrentNoteStatus
} from "./types/index.js";

/**
 * @function extractUserId
 *
 * @description Extracts Facebook user ID numerical identifier from the document cookie string.
 * @param cookie Document cookie string.
 * @returns Facebook user ID string or empty string if not found.
 */
function extractUserId(cookie: string): string {
  const regex = /c_user=(\d+);/gm;
  const match = regex.exec(cookie);
  return match ? match[1] : "";
}

/**
 * @function extractFbDtsg
 *
 * @description Extracts Facebook DTSG anti-CSRF token from page HTML content.
 * @param html Page HTML content string.
 * @returns DTSG token string or empty string.
 */
function extractFbDtsg(html: string): string {
  const regex = /"DTSG(?:Initia|Init)l?Data",\[],\{"token":"([^"\\]{8,300})"/m;
  const match = regex.exec(html);
  return match ? match[1] : "";
}

/**
 * @function extractJazoest
 *
 * @description Computes Facebook jazoest verification value by summing char codes of the DTSG token with prefix 2.
 * @param dtsg Facebook DTSG token string.
 * @returns Jazoest string.
 */
function extractJazoest(dtsg: string): string {
  if (!dtsg) return "";
  let sum = 0;
  for (let i = 0; i < dtsg.length; i++) {
    sum += dtsg.charCodeAt(i);
  }
  return "2" + sum;
}

/**
 * @function extractLsd
 *
 * @description Extracts LSD security token from HTML form input or JavaScript token object.
 * @param html Page HTML content string.
 * @returns LSD token string or empty string.
 */
function extractLsd(html: string): string {
  let match = /name="lsd" value="([^"\\]{6,300})"/m.exec(html);
  if (match) return match[1];
  match = /"LSD",\[],\{"token":"([^"\\]{6,300})"/m.exec(html);
  return match ? match[1] : "";
}

/**
 * @function sanitizeToken
 *
 * @description Validates and trims security tokens, ensuring length constraints and valid alphanumeric character sets.
 * @param value Raw token candidate string.
 * @returns Sanitized token string or empty string if invalid.
 */
function sanitizeToken(value: string): string {
  if (!value) return "";
  const trimmed = value.trim();
  if (trimmed.length < 6 || trimmed.length > 300) return "";
  if (!/^[A-Za-z0-9:_\-]+$/.test(trimmed)) return "";
  return trimmed;
}

/**
 * @function extractTokens
 *
 * @description Parses raw cookie and HTML strings from Facebook to extract authenticated user tokens including fb_dtsg, jazoest, userId, and lsd.
 * @param cookie Document cookie string.
 * @param html Raw HTML source of the Facebook page.
 * @returns FacebookTokens object if required credentials exist, or null otherwise.
 */
function extractTokens(cookie: string, html: string): FacebookTokens | null {
  const userId = extractUserId(cookie);
  const fb_dtsg = sanitizeToken(extractFbDtsg(html));
  const jazoest = extractJazoest(fb_dtsg);
  const lsd = sanitizeToken(extractLsd(html));
  if (!userId || !fb_dtsg) {
    return null;
  }
  return { fb_dtsg, jazoest, userId, lsd };
}

let activeMediaTabId: number | null = null;
let isRouting = false;
let pendingPlayback: PlaybackState | null = null;

/**
 * @function checkInitialState
 *
 * @description Dispatches PAGE_LOADED message to the background service worker when injected into a completed navigation.
 * @returns Void.
 */
function checkInitialState(): void {
  chrome.runtime.sendMessage({
    type: "PAGE_LOADED",
    url: window.location.href
  });
}

/**
 * @function getPageInfo
 *
 * @description Page context extractor retrieving document cookie and inner HTML string.
 * @returns Object containing cookie and html properties.
 */
function getPageInfo(): PageInfoResult {
  return {
    cookie: document.cookie,
    html: document.documentElement.innerHTML
  };
}

/**
 * @function saveToHistory
 *
 * @description Appends a song update outcome entry to persistent extension history, maintaining a capped log of 20 items.
 * @param title Title of the track posted or attempted.
 * @param success Whether the note publication was successful.
 * @returns Promise resolving when history has been persisted.
 */
async function saveToHistory(title: string, success: boolean): Promise<void> {
  if (!title) return;
  const data = (await chrome.storage.local.get({ history: [] })) as { history: HistoryItem[] };
  const history = data.history;
  history.unshift({
    title,
    timestamp: Date.now(),
    status: success ? "success" : "error"
  });
  if (history.length > 20) history.pop();
  await chrome.storage.local.set({ history });
}

/**
 * @function findBestMusicMatch
 *
 * @description Matches target track title and artist against Facebook catalog search results using exact match, substring comparison, or first fallback.
 * @param items Array of music item search results returned by Facebook GraphQL.
 * @param targetTitle Desired track title from media provider.
 * @param targetArtist Desired track artist from media provider.
 * @returns Best matching MusicItem or null if list is empty.
 */
function findBestMusicMatch(items: MusicItem[], targetTitle: string, targetArtist: string): MusicItem | null {
  const n = (s: string) => (s || "").toLowerCase().replace(/[^a-z0-9\s]/g, "").trim();
  const t = n(targetTitle);
  const a = n(targetArtist);

  for (const item of items) {
    if (n(item.title) === t && n(item.artist) === a) return item;
  }

  for (const item of items) {
    const it = n(item.title);
    const ia = n(item.artist);
    if ((it.includes(t) || t.includes(it)) && (ia.includes(a) || a.includes(ia))) return item;
  }

  for (const item of items) {
    const it = n(item.title);
    if (it.includes(t) || t.includes(it)) return item;
  }

  return items[0] || null;
}

/**
 * @function clearActiveFacebookNote
 *
 * @description Locates an open Facebook tab, extracts page authentication tokens, queries the active rich status note ID, and executes a GraphQL deletion mutation to clear the note.
 * @returns Promise resolving when the active note has been cleared and storage reset.
 */
async function clearActiveFacebookNote(): Promise<void> {
  try {
    const allTabs = await chrome.tabs.query({});
    const fbTabs = allTabs.filter(
      (tab) => tab.url && (tab.url.includes("facebook.com") || tab.url.includes("messenger.com"))
    );

    const targetTabId = fbTabs[0]?.id;
    if (!targetTabId) {
      console.warn("[NotesRPC] No Facebook/Messenger tab open to clear note.");
      chrome.storage.local.set({ lastSentSong: null });
      return;
    }

    const tokenResults = await chrome.scripting.executeScript({
      target: { tabId: targetTabId },
      func: getPageInfo
    });

    const pageInfo = tokenResults?.[0]?.result as PageInfoResult | undefined;
    if (!pageInfo) {
      console.warn("[NotesRPC] Failed to extract page info from Facebook tab.");
      chrome.storage.local.set({ lastSentSong: null });
      return;
    }

    const { cookie, html } = pageInfo;
    const tokens = extractTokens(cookie, html);
    if (!tokens) {
      console.warn("[NotesRPC] Failed to extract tokens to clear note.");
      chrome.storage.local.set({ lastSentSong: null });
      return;
    }

    const statusResults = await chrome.scripting.executeScript({
      target: { tabId: targetTabId },
      func: fetchCurrentNoteStatusFromPage,
      args: [tokens]
    });

    const statusRes = statusResults?.[0]?.result as ApiResponse | undefined;
    const richStatusId = statusRes?.status?.richStatusId;

    if (richStatusId) {
      const deleteResults = await chrome.scripting.executeScript({
        target: { tabId: targetTabId },
        func: deleteNoteFromPage,
        args: [tokens, richStatusId]
      });
      console.log("[NotesRPC] Note cleared via deleteNoteFromPage:", deleteResults?.[0]?.result);
    } else {
      console.log("[NotesRPC] No active rich status ID found to delete.");
    }

    chrome.storage.local.set({ lastSentSong: null });
  } catch (err) {
    console.error("[NotesRPC] clearActiveFacebookNote error:", err);
    chrome.storage.local.set({ lastSentSong: null });
  }
}

/**
 * @function routeUpdateToFacebook
 *
 * @description Orchestrates extracting credentials from an open Facebook tab, searching matching audio tracks, and mutating active Facebook Notes with queue concurrency control.
 * @param playback Playback state containing song metadata and play status.
 * @returns Promise resolving when update transaction completes.
 */
async function routeUpdateToFacebook(playback: PlaybackState): Promise<void> {
  if (isRouting) {
    pendingPlayback = playback;
    return;
  }
  isRouting = true;

  try {
    const allTabs = await chrome.tabs.query({});
    const fbTabs = allTabs.filter(
      (tab) => tab.url && (tab.url.includes("facebook.com") || tab.url.includes("messenger.com"))
    );

    const targetTabId = fbTabs[0]?.id;
    if (!targetTabId) {
      console.warn("[NotesRPC] No Facebook/Messenger tab open.");
      return;
    }

    const tokenResults = await chrome.scripting.executeScript({
      target: { tabId: targetTabId },
      func: getPageInfo
    });

    const pageInfo = tokenResults?.[0]?.result as PageInfoResult | undefined;
    if (!pageInfo) {
      console.warn("[NotesRPC] Failed to get page info from Facebook tab.");
      return;
    }

    const { cookie, html } = pageInfo;
    const tokens = extractTokens(cookie, html);

    if (!tokens) {
      console.warn("[NotesRPC] Could not extract tokens. Ensure you are logged into Facebook.");
      return;
    }

    chrome.storage.local.set({ lastSentSong: playback });

    const storageSettings = (await chrome.storage.local.get(["audienceSetting", "customFriendIds"])) as {
      audienceSetting?: "FRIENDS" | "PUBLIC" | "CUSTOM";
      customFriendIds?: string[];
    };
    const audienceSetting = storageSettings.audienceSetting || "FRIENDS";
    const customFriendIds = storageSettings.customFriendIds || [];

    if (!playback.title) {
      await clearActiveFacebookNote();
      return;
    }

    const searchQuery = `${playback.title} ${playback.artist}`;
    const searchResults = await chrome.scripting.executeScript({
      target: { tabId: targetTabId },
      func: searchMusicFromPage,
      args: [tokens, searchQuery, 20]
    });

    const musicResult = searchResults?.[0]?.result as ApiResponse<MusicItem> | undefined;
    if (!musicResult?.success || !musicResult.items?.length) {
      console.warn(`[NotesRPC] No music search results for: "${searchQuery}"`);
      return;
    }

    const bestMatch = findBestMusicMatch(musicResult.items, playback.title, playback.artist);
    if (!bestMatch) {
      console.warn(`[NotesRPC] Could not match track: "${searchQuery}"`);
      return;
    }

    const description = playback.isPlaying ? "🎵 Playing on YT Music" : "⏸️ Song paused";

    const createResult = await chrome.scripting.executeScript({
      target: { tabId: targetTabId },
      func: createNoteFromPage,
      args: [tokens, description, 86400, audienceSetting, customFriendIds, bestMatch, 0]
    });

    const result = createResult?.[0]?.result as ApiResponse | undefined;
    if (result?.success) {
      console.log(`[NotesRPC] ✅ Note posted: "${playback.title}" | Paused: ${!playback.isPlaying}`);
      await saveToHistory(playback.title, true);
    } else {
      console.warn("[NotesRPC] ❌ Note creation failed:", result?.error);
      await saveToHistory(playback.title, false);
    }
  } catch (err) {
    console.error("[NotesRPC] routeUpdateToFacebook threw:", err);
  } finally {
    isRouting = false;
    if (pendingPlayback) {
      const nextPlayback = pendingPlayback;
      pendingPlayback = null;
      void routeUpdateToFacebook(nextPlayback);
    }
  }
}

/**
 * @function createNoteFromPage
 *
 * @description Executes within the Facebook page context to issue Relay Modern GraphQL mutations creating or updating status notes with text or music.
 * @param tokens Authenticated Facebook tokens.
 * @param description Text description or status caption.
 * @param duration Note duration in seconds.
 * @param audienceSetting Privacy setting string: FRIENDS, PUBLIC, or CUSTOM.
 * @param selectedFriendIds Target friend IDs if audience is set to CUSTOM.
 * @param selectedMusic Music item object if note includes audio.
 * @param musicTrimStartMs Start time offset in milliseconds for music preview.
 * @returns Promise resolving to an API response object.
 */
async function createNoteFromPage(
  tokens: FacebookTokens,
  description: string,
  duration: number,
  audienceSetting: string,
  selectedFriendIds: string[],
  selectedMusic: MusicItem | null,
  musicTrimStartMs: number
): Promise<ApiResponse> {
  const isSafeToken = (value: unknown): value is string => {
    return typeof value === "string" && /^[A-Za-z0-9:_-]{6,300}$/.test(value);
  };
  const extract = (source: string, regex: RegExp): string => {
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

  const sendGraphQL = async (friendlyName: string, docId: string, variables: Record<string, unknown>) => {
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
    body.append("__spin_t", spinT || String(Math.floor(Date.now() / 1000)));
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
    let json: { error?: unknown; errorSummary?: string; errorDescription?: string; errors?: Array<{ message?: string }>; data?: Record<string, unknown> };
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

  const mapAudienceToPrivacy = (setting: string): string => {
    switch (setting) {
      case "PUBLIC":
        return "PUBLIC";
      case "FRIENDS":
        return "FRIENDS";
      default:
        return "FRIENDS";
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
  const withMusicInput = selectedMusic
    ? normalizedDescription
      ? {
          ...baseInput,
          description: normalizedDescription,
          note_type: "MUSIC_NOTE_WITH_TEXT",
          audio_cluster_id: preferredAudioClusterId,
          song_start_time_ms: musicTrimStartMs
        }
      : {
          ...baseInput,
          description: null,
          note_type: "MUSIC_NOTE_MUSIC_ONLY",
          audio_cluster_id: preferredAudioClusterId,
          song_start_time_ms: musicTrimStartMs
        }
    : null;

  const buildMusicInputVariants = () => {
    if (!selectedMusic) return [];
    const audioClusterCandidates = Array.from(
      new Set(
        [selectedMusic.songId, selectedMusic.audioClusterId].filter(
          (v): v is string => typeof v === "string" && v.length > 0
        )
      )
    );
    const variants = [];
    for (const audioClusterId of audioClusterCandidates) {
      if (normalizedDescription) {
        variants.push({
          ...baseInput,
          client_mutation_id: String((Date.now() % 9) + 1),
          description: normalizedDescription,
          note_type: "MUSIC_NOTE_WITH_TEXT",
          audio_cluster_id: audioClusterId,
          song_start_time_ms: musicTrimStartMs
        });
        variants.push({
          ...baseInput,
          client_mutation_id: String((Date.now() % 9) + 1),
          description: normalizedDescription,
          note_type: "MUSIC_NOTE",
          audio_cluster_id: audioClusterId,
          song_start_time_ms: musicTrimStartMs
        });
      } else {
        variants.push({
          ...baseInput,
          client_mutation_id: String((Date.now() % 9) + 1),
          description: null,
          note_type: "MUSIC_NOTE_MUSIC_ONLY",
          audio_cluster_id: audioClusterId,
          song_start_time_ms: musicTrimStartMs
        });
        variants.push({
          ...baseInput,
          client_mutation_id: String((Date.now() % 9) + 1),
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

    const seenInputs = new Set<string>();
    const uniqueCandidates = createInputCandidates.filter((candidate) => {
      const key = JSON.stringify(candidate);
      if (seenInputs.has(key)) return false;
      seenInputs.add(key);
      return true;
    });

    let createResult: { ok: boolean; error?: string; json?: { data?: Record<string, unknown> } } = {
      ok: false,
      error: "No mutation candidates generated"
    };
    const createErrors: string[] = [];

    for (const candidate of uniqueCandidates) {
      createResult = await sendGraphQL("useMWInboxTrayCreateNoteMutation", "25742693715382390", {
        input: candidate
      });
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

    const createdStatus = (data as { xfb_rich_status_create?: { status?: { id?: string } } }).xfb_rich_status_create?.status;
    const hasCreatedStatus = Boolean(createdStatus?.id);
    const hasMutationPayload =
      hasCreatedStatus ||
      Object.entries(data).some(([key, value]) => {
        const normalized = key.toLowerCase();
        if (!normalized.includes("createnote") && !normalized.includes("inboxtray") && !normalized.includes("rich_status")) {
          return false;
        }
        return value !== null && value !== undefined;
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

/**
 * @function deleteNoteFromPage
 *
 * @description Executes within the Facebook page context to issue Relay Modern GraphQL mutations deleting an active note by rich status ID.
 * @param tokens Authenticated Facebook tokens.
 * @param richStatusId Facebook rich status ID string to delete.
 * @returns Promise resolving to an API response object.
 */
async function deleteNoteFromPage(tokens: FacebookTokens, richStatusId: string): Promise<ApiResponse> {
  const isSafeToken = (value: unknown): value is string => {
    return typeof value === "string" && /^[A-Za-z0-9:_-]{6,300}$/.test(value);
  };
  const extract = (source: string, regex: RegExp): string => {
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
  body.append("__spin_t", spinT || String(Math.floor(Date.now() / 1000)));
  if (rev) body.append("__rev", rev);
  if (hsi) body.append("__hsi", hsi);
  body.append("fb_api_caller_class", "RelayModern");
  body.append("fb_api_req_friendly_name", "useMWInboxTrayDeleteNoteMutation");
  body.append("server_timestamps", "true");
  body.append(
    "variables",
    JSON.stringify({
      input: {
        actor_id: tokens.userId,
        client_mutation_id: String((Date.now() % 9) + 1),
        rich_status_id: safeRichStatusId
      }
    })
  );
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
    let json: { error?: unknown; errorSummary?: string; errorDescription?: string; errors?: Array<{ message?: string }> };
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

/**
 * @function searchFriendsFromPage
 *
 * @description Executes within Facebook page context querying friends via GraphQL for custom note audience selection.
 * @param tokens Authenticated Facebook tokens.
 * @param query Search query string.
 * @param cursor Pagination cursor token.
 * @param count Page limit size.
 * @returns Promise resolving to friend search result edges.
 */
async function searchFriendsFromPage(
  tokens: FacebookTokens,
  query: string,
  cursor: string | null,
  count: number
): Promise<ApiResponse<FriendItem>> {
  const extract = (source: string, regex: RegExp): string => {
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
  body.append("__spin_t", spinT || String(Math.floor(Date.now() / 1000)));
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
        "X-FB-Friendly-Name": isPagination
          ? "StoriesCometPrivacySelectorFriendsBootstrapPaginationQuery"
          : "StoriesCometPrivacySelectorFriendsBootstrapViewQuery"
      },
      body: body.toString()
    });

    const text = await response.text();
    const jsonText = text.replace("for (;;);", "").trim();
    let json: {
      error?: unknown;
      errorSummary?: string;
      errorDescription?: string;
      errors?: Array<{ message?: string }>;
      data?: { user?: { friends?: { edges?: Array<{ node?: { id?: string; name?: string; photo?: { uri?: string } } }>; page_info?: { end_cursor?: string; has_next_page?: boolean } } } };
    };
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

    const items: FriendItem[] = [];
    for (const edge of edges) {
      const node = edge?.node;
      if (!node || typeof node !== "object") continue;
      const id = typeof node.id === "string" ? node.id : "";
      const name = typeof node.name === "string" ? node.name : "";
      const imageUri = typeof node?.photo?.uri === "string" ? node.photo.uri : undefined;
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

/**
 * @function searchMusicFromPage
 *
 * @description Executes within Facebook page context querying Facebook music catalogue typeahead GraphQL endpoints.
 * @param tokens Authenticated Facebook tokens.
 * @param query Search term combining title and artist.
 * @param count Maximum number of music results to request.
 * @returns Promise resolving to parsed music catalogue items.
 */
async function searchMusicFromPage(tokens: FacebookTokens, query: string, count: number): Promise<ApiResponse<MusicItem>> {
  const extract = (source: string, regex: RegExp): string => {
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

  const toStringId = (value: unknown): string | undefined => {
    if (typeof value === "string" && value.length > 0) return value;
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
    return undefined;
  };

  const pickAudioClusterId = (item: Record<string, unknown> | null | undefined): string | undefined => {
    const anyItem = item as Record<string, Record<string, unknown>> | null | undefined;
    return (
      toStringId(item?.audio_cluster_id) ||
      toStringId(anyItem?.audio_cluster?.id) ||
      toStringId(anyItem?.audio_cluster?.audio_cluster_id) ||
      toStringId(anyItem?.audio_asset?.audio_cluster_id) ||
      toStringId(anyItem?.audio_asset?.id) ||
      toStringId(anyItem?.music_asset?.audio_cluster_id) ||
      toStringId(anyItem?.music_asset?.id) ||
      toStringId(anyItem?.track?.audio_cluster_id) ||
      toStringId(item?.cluster_id)
    );
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
  body.append("__spin_t", spinT || String(Math.floor(Date.now() / 1000)));
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
    let json: {
      error?: unknown;
      errorSummary?: string;
      errorDescription?: string;
      errors?: Array<{ message?: string }>;
      data?: {
        xfb_music_picker_connection_container?: {
          items?: {
            edges?: Array<{
              node?: {
                sub_items?: Array<{
                  display_id?: string;
                  id?: string;
                  song_id?: string;
                  audio_cluster_id?: string;
                  display_title?: { text?: string };
                  display_subtitle?: { text?: string };
                  display_image?: { uri?: string };
                  duration_in_ms?: number;
                  progressive_download?: Array<{ url?: string }>;
                }>;
              };
            }>;
          };
        };
      };
    };

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
    const itemsFromEdges: MusicItem[] = Array.isArray(edges)
      ? edges
          .flatMap((edge) => (Array.isArray(edge?.node?.sub_items) ? edge.node.sub_items : []))
          .map((item) => ({
            id: String(item?.display_id || item?.id || ""),
            songId: item?.song_id ? String(item.song_id) : undefined,
            audioClusterId: toStringId(item?.song_id) || pickAudioClusterId(item as Record<string, unknown>),
            title: String(item?.display_title?.text || ""),
            artist: String(item?.display_subtitle?.text || ""),
            imageUri: item?.display_image?.uri ? String(item.display_image.uri) : undefined,
            durationMs: typeof item?.duration_in_ms === "number" ? item.duration_in_ms : undefined,
            progressiveDownloadUrl:
              Array.isArray(item?.progressive_download) && item.progressive_download[0]?.url
                ? String(item.progressive_download[0].url)
                : undefined
          }))
          .filter((item) => Boolean(item.id) && Boolean(item.title))
      : [];

    const items: MusicItem[] = [];
    const seen = new Set<string>();
    for (const item of itemsFromEdges) {
      if (seen.has(item.id)) continue;
      seen.add(item.id);
      items.push(item);
      if (items.length >= safeCount) break;
    }

    if (items.length === 0) {
      const scan = (node: unknown): void => {
        if (!node || typeof node !== "object") return;
        const obj = node as Record<string, unknown>;
        const isAudioAsset =
          obj.__typename === "AudioAsset" || (Boolean(obj.display_id) && Boolean(obj.display_title) && Boolean(obj.display_subtitle));

        if (isAudioAsset) {
          const id = String(obj.display_id || obj.id || "");
          const titleObj = obj.display_title as { text?: string } | undefined;
          const subtitleObj = obj.display_subtitle as { text?: string } | undefined;
          const imageObj = obj.display_image as { uri?: string } | undefined;
          const title = String(titleObj?.text || "");

          if (id && title && !seen.has(id)) {
            seen.add(id);
            const progressiveDownloadList = obj.progressive_download as Array<{ url?: string }> | undefined;
            items.push({
              id,
              songId: obj.song_id ? String(obj.song_id) : undefined,
              audioClusterId: toStringId(obj.song_id) || pickAudioClusterId(obj),
              title,
              artist: String(subtitleObj?.text || ""),
              imageUri: imageObj?.uri ? String(imageObj.uri) : undefined,
              durationMs: typeof obj.duration_in_ms === "number" ? obj.duration_in_ms : undefined,
              progressiveDownloadUrl:
                Array.isArray(progressiveDownloadList) && progressiveDownloadList[0]?.url
                  ? String(progressiveDownloadList[0].url)
                  : undefined
            });
            if (items.length >= safeCount) return;
          }
        }

        for (const value of Object.values(obj)) {
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

/**
 * @function fetchCurrentNoteStatusFromPage
 *
 * @description Executes within Facebook page context querying the viewer rich status dialog for existing active note metadata.
 * @param tokens Authenticated Facebook tokens.
 * @returns Promise resolving to note status information.
 */
async function fetchCurrentNoteStatusFromPage(tokens: FacebookTokens): Promise<ApiResponse<never>> {
  const isSafeToken = (value: unknown): value is string => {
    return typeof value === "string" && /^[A-Za-z0-9:_-]{6,300}$/.test(value);
  };
  const extract = (source: string, regex: RegExp): string => {
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
  body.append("__spin_t", spinT || String(Math.floor(Date.now() / 1000)));
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
    let json: {
      error?: unknown;
      errorSummary?: string;
      errorDescription?: string;
      errors?: Array<{ message?: string }>;
      data?: {
        viewer?: {
          actor?: {
            msgr_user_rich_status?: {
              id?: string;
              rich_status_id?: string;
              description?: string;
              note_type?: string;
              visibility?: string;
              expiration_time?: number;
              custom_audience?: Array<{ short_name?: string; name?: string }>;
              custom_audience_size?: number;
              music_metadata?: {
                title?: string;
                artist_name?: string;
                license_music?: Array<{ title?: { text?: string }; display_artist?: { text?: string } }>;
              };
            };
            profilePicture?: { uri?: string };
            lightweight_status_custom_audience_list?: Array<{ short_name?: string; name?: string }>;
          };
        };
        xfb_fetch_default_note_audience_setting?: string;
      };
    };

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

    const findRichStatusIdDeep = (root: unknown): string | null => {
      const seen = new Set<unknown>();
      const stack = [root];
      while (stack.length > 0) {
        const node = stack.pop();
        if (!node || typeof node !== "object") continue;
        if (seen.has(node)) continue;
        seen.add(node);
        const obj = node as Record<string, unknown>;
        const candidate = obj.rich_status_id ?? obj.richStatusId;
        if (typeof candidate === "string" && /^[0-9]{5,30}$/.test(candidate)) {
          return candidate;
        }
        const maybeId = obj.id;
        const maybeType = obj.__typename;
        if (typeof maybeId === "string" && /^[0-9]{5,30}$/.test(maybeId) && (typeof maybeType !== "string" || /rich|status/i.test(maybeType))) {
          return maybeId;
        }
        for (const value of Object.values(obj)) {
          if (!value) continue;
          if (typeof value === "object") {
            stack.push(value);
          }
        }
      }
      return null;
    };

    const richStatusId =
      typeof status?.id === "string" && /^[0-9]{5,30}$/.test(status.id)
        ? status.id
        : typeof status?.rich_status_id === "string" && /^[0-9]{5,30}$/.test(status.rich_status_id)
          ? status.rich_status_id
          : findRichStatusIdDeep(json?.data);

    const musicMeta = status?.music_metadata;
    const licenseMusic = Array.isArray(musicMeta?.license_music) ? musicMeta.license_music[0] : null;
    const musicTitle = typeof licenseMusic?.title?.text === "string" ? licenseMusic.title.text : typeof musicMeta?.title === "string" ? musicMeta.title : null;
    const musicArtist = typeof licenseMusic?.display_artist?.text === "string" ? licenseMusic.display_artist.text : typeof musicMeta?.artist_name === "string" ? musicMeta.artist_name : null;

    const customAudience = Array.isArray(status?.custom_audience)
      ? status.custom_audience
      : Array.isArray(actor?.lightweight_status_custom_audience_list)
        ? actor.lightweight_status_custom_audience_list
        : [];

    const customAudienceNames = customAudience
      .map((item) => {
        if (typeof item?.short_name === "string" && item.short_name.length > 0) return item.short_name;
        if (typeof item?.name === "string" && item.name.length > 0) return item.name;
        return null;
      })
      .filter((name): name is string => Boolean(name));

    const statusResult: CurrentNoteStatus = {
      richStatusId,
      avatarUri: typeof actor?.profilePicture?.uri === "string" ? actor.profilePicture.uri : undefined,
      description: typeof status?.description === "string" ? status.description : null,
      noteType: typeof status?.note_type === "string" ? status.note_type : null,
      visibility: typeof status?.visibility === "string" ? status.visibility : null,
      expirationTime: typeof status?.expiration_time === "number" ? status.expiration_time : null,
      musicTitle,
      musicArtist,
      customAudienceNames,
      customAudienceSize: typeof status?.custom_audience_size === "number" ? status.custom_audience_size : null,
      defaultAudienceSetting: typeof json?.data?.xfb_fetch_default_note_audience_setting === "string" ? json.data.xfb_fetch_default_note_audience_setting : null
    };

    return {
      success: true,
      status: statusResult
    };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Unknown error while fetching current note status"
    };
  }
}

/**
 * @function playMusicFromPage
 *
 * @description Executes within Facebook page context resolving progressive audio download URLs for playing note audio clips.
 * @param tokens Authenticated Facebook tokens.
 * @param musicId Audio asset ID.
 * @param songId Song identifier.
 * @param audioClusterId Cluster ID for audio asset.
 * @returns Promise resolving to audio playback URL payload.
 */
async function playMusicFromPage(
  tokens: FacebookTokens,
  musicId?: string,
  songId?: string,
  audioClusterId?: string
): Promise<ApiResponse<never>> {
  const isSafeToken = (value: unknown): value is string => {
    return typeof value === "string" && /^[A-Za-z0-9:_-]{6,300}$/.test(value);
  };
  const extract = (source: string, regex: RegExp): string => {
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
  body.append("__spin_t", spinT || String(Math.floor(Date.now() / 1000)));
  if (rev) body.append("__rev", rev);
  if (hsi) body.append("__hsi", hsi);
  body.append("fb_api_caller_class", "RelayModern");
  body.append("fb_api_req_friendly_name", "MWInboxTrayMusicNotePlayerQuery");
  body.append("server_timestamps", "true");
  body.append(
    "variables",
    JSON.stringify({
      audio_cluster_id: audioClusterIdValue,
      product: "FB_NOTES"
    })
  );
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
    let json: { error?: unknown; errorSummary?: string; errorDescription?: string; errors?: Array<{ message?: string }>; data?: Record<string, unknown> };
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

    const findProgressiveDownload = (node: unknown): string | null => {
      if (!node || typeof node !== "object") return null;
      const obj = node as Record<string, unknown>;
      if (typeof obj.progressive_download === "string" && obj.progressive_download.length > 0) {
        return obj.progressive_download;
      }
      if (typeof obj.progressive_download_url === "string" && obj.progressive_download_url.length > 0) {
        return obj.progressive_download_url;
      }
      if (typeof obj.audio_url === "string" && obj.audio_url.length > 0) {
        return obj.audio_url;
      }
      if (typeof obj.play_url === "string" && obj.play_url.length > 0) {
        return obj.play_url;
      }
      if (typeof obj.uri === "string" && obj.uri.includes("audio") && obj.uri.length > 0) {
        return obj.uri;
      }
      if (typeof obj.url === "string" && obj.url.includes("audio") && obj.url.length > 0) {
        return obj.url;
      }
      for (const value of Object.values(obj)) {
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

chrome.webNavigation.onCompleted.addListener((details) => {
  if (details.url.includes("facebook.com")) {
    chrome.scripting.executeScript({
      target: { tabId: details.tabId },
      func: checkInitialState
    });
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "GET_TOKENS") {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const activeTab = tabs[0];
      if (!activeTab?.id) {
        sendResponse({ error: "No active tab found" });
        return;
      }
      chrome.scripting.executeScript(
        {
          target: { tabId: activeTab.id },
          func: getPageInfo
        },
        (results) => {
          const info = results?.[0]?.result as PageInfoResult | undefined;
          if (chrome.runtime.lastError || !info) {
            sendResponse({ error: "Failed to extract page info" });
            return;
          }
          const { cookie, html } = info;
          const tokens = extractTokens(cookie, html);
          sendResponse({ tokens });
        }
      );
    });
    return true;
  }

  if (message.type === "CREATE_NOTE") {
    let replied = false;
    const replyOnce = (payload: unknown) => {
      if (replied) return;
      replied = true;
      sendResponse(payload);
    };
    const timeoutId = setTimeout(() => {
      replyOnce({ success: false, error: "CREATE_NOTE timeout: no response from tab context" });
    }, 20000);

    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const activeTab = tabs[0];
      if (!activeTab?.id) {
        clearTimeout(timeoutId);
        replyOnce({ success: false, error: "No active tab found" });
        return;
      }
      const activeUrl = activeTab.url || "";
      if (!activeUrl.includes("facebook.com")) {
        clearTimeout(timeoutId);
        replyOnce({ success: false, error: "Open facebook.com tab before creating a note" });
        return;
      }
      chrome.scripting.executeScript(
        {
          target: { tabId: activeTab.id },
          func: createNoteFromPage,
          args: [
            message.tokens,
            message.description,
            message.duration,
            message.audienceSetting,
            message.selectedFriendIds || [],
            message.selectedMusic || null,
            message.musicTrimStartMs || 0
          ]
        },
        (results) => {
          if (chrome.runtime.lastError || !results?.[0]) {
            clearTimeout(timeoutId);
            replyOnce({ success: false, error: chrome.runtime.lastError?.message || "Failed to run request in page context" });
            return;
          }
          clearTimeout(timeoutId);
          replyOnce(results[0].result);
        }
      );
    });
    return true;
  }

  if (message.type === "GET_CURRENT_NOTE_STATUS") {
    let replied = false;
    const replyOnce = (payload: unknown) => {
      if (replied) return;
      replied = true;
      sendResponse(payload);
    };
    const timeoutId = setTimeout(() => {
      replyOnce({ success: false, error: "GET_CURRENT_NOTE_STATUS timeout: no response from tab context" });
    }, 20000);

    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const activeTab = tabs[0];
      if (!activeTab?.id) {
        clearTimeout(timeoutId);
        replyOnce({ success: false, error: "No active tab found" });
        return;
      }
      const activeUrl = activeTab.url || "";
      if (!activeUrl.includes("facebook.com")) {
        clearTimeout(timeoutId);
        replyOnce({ success: false, error: "Open facebook.com tab before fetching note status" });
        return;
      }
      chrome.scripting.executeScript(
        {
          target: { tabId: activeTab.id },
          func: fetchCurrentNoteStatusFromPage,
          args: [message.tokens]
        },
        (results) => {
          if (chrome.runtime.lastError || !results?.[0]) {
            clearTimeout(timeoutId);
            replyOnce({
              success: false,
              error: chrome.runtime.lastError?.message || "Failed to fetch current note status in page context"
            });
            return;
          }
          clearTimeout(timeoutId);
          replyOnce(results[0].result);
        }
      );
    });
    return true;
  }

  if (message.type === "SEARCH_MUSIC") {
    let replied = false;
    const replyOnce = (payload: unknown) => {
      if (replied) return;
      replied = true;
      sendResponse(payload);
    };
    const timeoutId = setTimeout(() => {
      replyOnce({ success: false, error: "SEARCH_MUSIC timeout: no response from tab context" });
    }, 20000);

    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const activeTab = tabs[0];
      if (!activeTab?.id) {
        clearTimeout(timeoutId);
        replyOnce({ success: false, error: "No active tab found" });
        return;
      }
      const activeUrl = activeTab.url || "";
      if (!activeUrl.includes("facebook.com")) {
        clearTimeout(timeoutId);
        replyOnce({ success: false, error: "Open facebook.com tab before searching music" });
        return;
      }
      chrome.scripting.executeScript(
        {
          target: { tabId: activeTab.id },
          func: searchMusicFromPage,
          args: [message.tokens, message.query, message.count ?? 80]
        },
        (results) => {
          if (chrome.runtime.lastError || !results?.[0]) {
            clearTimeout(timeoutId);
            replyOnce({ success: false, error: chrome.runtime.lastError?.message || "Failed to search music in page context" });
            return;
          }
          clearTimeout(timeoutId);
          replyOnce(results[0].result);
        }
      );
    });
    return true;
  }

  if (message.type === "SEARCH_FRIENDS") {
    let replied = false;
    const replyOnce = (payload: unknown) => {
      if (replied) return;
      replied = true;
      sendResponse(payload);
    };
    const timeoutId = setTimeout(() => {
      replyOnce({ success: false, error: "SEARCH_FRIENDS timeout: no response from tab context" });
    }, 20000);

    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const activeTab = tabs[0];
      if (!activeTab?.id) {
        clearTimeout(timeoutId);
        replyOnce({ success: false, error: "No active tab found" });
        return;
      }
      const activeUrl = activeTab.url || "";
      if (!activeUrl.includes("facebook.com")) {
        clearTimeout(timeoutId);
        replyOnce({ success: false, error: "Open facebook.com tab before searching friends" });
        return;
      }
      chrome.scripting.executeScript(
        {
          target: { tabId: activeTab.id },
          func: searchFriendsFromPage,
          args: [message.tokens, message.query, message.cursor ?? null, message.count ?? 20]
        },
        (results) => {
          if (chrome.runtime.lastError || !results?.[0]) {
            clearTimeout(timeoutId);
            replyOnce({ success: false, error: chrome.runtime.lastError?.message || "Failed to search friends in page context" });
            return;
          }
          clearTimeout(timeoutId);
          replyOnce(results[0].result);
        }
      );
    });
    return true;
  }

  if (message.type === "DELETE_NOTE") {
    let replied = false;
    const replyOnce = (payload: unknown) => {
      if (replied) return;
      replied = true;
      sendResponse(payload);
    };
    const timeoutId = setTimeout(() => {
      replyOnce({ success: false, error: "DELETE_NOTE timeout: no response from tab context" });
    }, 20000);

    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const activeTab = tabs[0];
      if (!activeTab?.id) {
        clearTimeout(timeoutId);
        replyOnce({ success: false, error: "No active tab found" });
        return;
      }
      const activeUrl = activeTab.url || "";
      if (!activeUrl.includes("facebook.com")) {
        clearTimeout(timeoutId);
        replyOnce({ success: false, error: "Open facebook.com tab before deleting a note" });
        return;
      }
      chrome.scripting.executeScript(
        {
          target: { tabId: activeTab.id },
          func: deleteNoteFromPage,
          args: [message.tokens, message.richStatusId]
        },
        (results) => {
          if (chrome.runtime.lastError || !results?.[0]) {
            clearTimeout(timeoutId);
            replyOnce({ success: false, error: chrome.runtime.lastError?.message || "Failed to run delete request in page context" });
            return;
          }
          clearTimeout(timeoutId);
          replyOnce(results[0].result);
        }
      );
    });
    return true;
  }

  if (message.type === "PLAY_MUSIC") {
    let replied = false;
    const replyOnce = (payload: unknown) => {
      if (replied) return;
      replied = true;
      sendResponse(payload);
    };
    const timeoutId = setTimeout(() => {
      replyOnce({ success: false, error: "PLAY_MUSIC timeout: no response from tab context" });
    }, 20000);

    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const activeTab = tabs[0];
      if (!activeTab?.id) {
        clearTimeout(timeoutId);
        replyOnce({ success: false, error: "No active tab found" });
        return;
      }
      const activeUrl = activeTab.url || "";
      if (!activeUrl.includes("facebook.com")) {
        clearTimeout(timeoutId);
        replyOnce({ success: false, error: "Open facebook.com tab before playing music" });
        return;
      }
      chrome.scripting.executeScript(
        {
          target: { tabId: activeTab.id },
          func: playMusicFromPage,
          args: [message.tokens, message.musicId, message.songId, message.audioClusterId]
        },
        (results) => {
          if (chrome.runtime.lastError || !results?.[0]) {
            clearTimeout(timeoutId);
            replyOnce({ success: false, error: chrome.runtime.lastError?.message || "Failed to play music in page context" });
            return;
          }
          clearTimeout(timeoutId);
          replyOnce(results[0].result);
        }
      );
    });
    return true;
  }

  if (message.type === "MEDIA_PLAYBACK_STATE") {
    const playback = message.playback as PlaybackState;
    if (sender.tab?.id) {
      activeMediaTabId = sender.tab.id;
    }

    chrome.storage.local.get(
      {
        automationEnabled: true,
        startTime: "08:00",
        endTime: "22:00",
        lastSentSong: null
      },
      (settingsItems) => {
        const settings = settingsItems as ExtensionSettings;
        if (!settings.automationEnabled) return;

        if (!isWithinTimeWindow(settings.startTime, settings.endTime)) {
          console.log("[NotesRPC] Outside active time window. Automation halted.");
          return;
        }

        const lastSent = settings.lastSentSong;
        const isSameSong =
          lastSent &&
          lastSent.title === playback.title &&
          lastSent.artist === playback.artist &&
          lastSent.isPlaying === playback.isPlaying;

        if (isSameSong) {
          return;
        }

        void routeUpdateToFacebook(playback);
      }
    );
  }

  if (message.type === "SETTINGS_CHANGED") {
    chrome.storage.local.get(
      {
        automationEnabled: true,
        startTime: "08:00",
        endTime: "22:00"
      },
      (settingsItems) => {
        const settings = settingsItems as ExtensionSettings;
        if (!settings.automationEnabled || !isWithinTimeWindow(settings.startTime, settings.endTime)) {
          void clearActiveFacebookNote();
        } else {
          chrome.tabs.query({}, (tabs) => {
            const mediaTabs = tabs.filter((tab) => tab.url && tab.url.includes("music.youtube.com"));
            mediaTabs.forEach((tab) => {
              if (tab.id) {
                chrome.tabs.sendMessage(tab.id, { type: "FORCE_REPORT_STATE" }, () => {
                  void chrome.runtime.lastError;
                });
              }
            });
          });
        }
      }
    );
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  if (tabId === activeMediaTabId) {
    activeMediaTabId = null;

    chrome.storage.local.get(
      {
        automationEnabled: true,
        startTime: "08:00",
        endTime: "22:00"
      },
      (settingsItems) => {
        const settings = settingsItems as ExtensionSettings;
        if (!settings.automationEnabled) return;
        if (!isWithinTimeWindow(settings.startTime, settings.endTime)) return;

        void clearActiveFacebookNote();
      }
    );
  }
});
