"use strict";
/**
 * @fileoverview RESO - YouTube Music Provider
 *
 * @description YouTube Music playback scraper and event-driven observer monitoring track changes, video states, and player DOM mutations.
 * @author @Chrixtia
 */
const BaseProvider = (typeof window !== "undefined" ? window.MusicProvider : null) ||
    (typeof globalThis !== "undefined" ? globalThis.MusicProvider : null) ||
    MusicProvider;
/**
 * @class YouTubeMusicProvider
 *
 * @description Implementation of MusicProvider specialized in scraping track title, artist, playback state, and artwork from modern and legacy YouTube Music DOM components.
 * @author @Chrixtia
 */
class YouTubeMusicProvider extends BaseProvider {
    /**
     * @method scrape
     *
     * @description Scrapes title, channel/artist name, play/pause states from aria-labels, SVG icons, and HTML5 video, and album artwork from modern thumbnail components.
     * @returns Comprehensive playback state including original and sanitized metadata.
     */
    scrape() {
        const titleEl = document.querySelector("ytmusic-player-bar .title span.ytAttributedStringHost") ||
            document.querySelector("ytmusic-player-bar span.ytAttributedStringHost.ytAttributedStringEllipsisTruncate") ||
            document.querySelector("span.ytAttributedStringHost.ytAttributedStringEllipsisTruncate[role='text']") ||
            document.querySelector("ytmusic-player-bar span.ytAttributedStringHost") ||
            document.querySelector("span.ytAttributedStringHost.ytAttributedStringEllipsisTruncate") ||
            document.querySelector("yt-formatted-string.title.ytmusic-player-bar") ||
            document.querySelector("ytmusic-player-bar .title");
        const rawTitle = titleEl ? (titleEl.getAttribute("title") || titleEl.textContent || "").trim() : "";
        const artistEl = document.querySelector("ytmusic-player-bar a.ytAttributedStringLink.ytAttributedStringLinkCallToActionColor") ||
            document.querySelector("ytmusic-player-bar .byline a.ytAttributedStringLink") ||
            document.querySelector("ytmusic-player-bar .subtitle a.ytAttributedStringLink") ||
            document.querySelector("a.ytAttributedStringLink.ytAttributedStringLinkCallToActionColor") ||
            document.querySelector("ytmusic-player-bar a.ytAttributedStringLink") ||
            document.querySelector("a.ytAttributedStringLink") ||
            document.querySelector('a.yt-simple-endpoint.yt-formatted-string[href^="channel/"]') ||
            document.querySelector('ytmusic-player-bar a[href*="channel/"]');
        let rawArtist = "";
        if (artistEl) {
            rawArtist = (artistEl.getAttribute("title") || artistEl.textContent || "").trim();
        }
        else {
            const bylineEl = document.querySelector("ytmusic-player-bar .byline") ||
                document.querySelector("ytmusic-player-bar .subtitle");
            if (bylineEl) {
                const parts = (bylineEl.textContent || "").trim().split(/•|·/);
                rawArtist = parts[0]?.trim() || "";
            }
        }
        const playPauseBtn = document.querySelector("#play-pause-button") ||
            document.querySelector("ytmusic-player-bar #play-pause-button") ||
            document.querySelector(".play-pause-button");
        const video = document.querySelector("video");
        let isPlaying = false;
        let determined = false;
        if (playPauseBtn) {
            const ariaLabel = (playPauseBtn.getAttribute("aria-label") || "").toLowerCase();
            const titleAttr = (playPauseBtn.getAttribute("title") || "").toLowerCase();
            if (ariaLabel.includes("pause") || titleAttr.includes("pause")) {
                isPlaying = true;
                determined = true;
            }
            else if (ariaLabel.includes("play") || titleAttr.includes("play")) {
                isPlaying = false;
                determined = true;
            }
        }
        if (!determined) {
            const pauseIconPath = "M6.5 3A1.5 1.5 0 005 4.5v15A1.5 1.5 0 006.5 21h2a1.5 1.5 0 001.5-1.5v-15A1.5 1.5 0 008.5 3h-2Zm9 0A1.5 1.5 0 0014 4.5v15a1.5 1.5 0 001.5 1.5h2a1.5 1.5 0 001.5-1.5v-15A1.5 1.5 0 0017.5 3h-2Z";
            const playIconPath = "M5 4.623V19.38a1.5 1.5 0 002.26 1.29L22 12 7.26 3.33A1.5 1.5 0 005 4.623Z";
            const paths = document.querySelectorAll("#play-pause-button svg path, .ytmusic-player-bar svg path");
            for (const path of paths) {
                const d = path.getAttribute("d");
                if (d === pauseIconPath) {
                    isPlaying = true;
                    determined = true;
                    break;
                }
                else if (d === playIconPath) {
                    isPlaying = false;
                    determined = true;
                    break;
                }
            }
        }
        if (!determined && video) {
            isPlaying = !video.paused && !video.ended;
            determined = true;
        }
        const imgEl = document.querySelector("img.ytmusicTrackInfoThumbnail") ||
            document.querySelector("ytmusic-player-bar img.ytmusicTrackInfoThumbnail") ||
            document.querySelector("img.image.ytmusic-player-bar") ||
            document.querySelector("ytmusic-player-bar img.image") ||
            document.querySelector("ytmusic-player-bar #thumbnail img") ||
            document.querySelector("ytmusic-player-bar .thumbnail img");
        const imageUrl = imgEl ? imgEl.src : null;
        const cleanedTitle = this.cleanTitle(rawTitle);
        const sanitizedTitle = this.sanitizeString(cleanedTitle);
        const sanitizedArtist = this.sanitizeString(rawArtist);
        return {
            title: sanitizedTitle,
            artist: sanitizedArtist,
            isPlaying: isPlaying,
            imageUrl: imageUrl,
            originalTitle: rawTitle,
            originalArtist: rawArtist
        };
    }
}
if (typeof window !== "undefined") {
    window.YouTubeMusicProvider = YouTubeMusicProvider;
}
if (typeof globalThis !== "undefined") {
    globalThis.YouTubeMusicProvider = YouTubeMusicProvider;
}
/**
 * @function isContextAlive
 *
 * @description Verifies whether the extension execution context remains active and valid.
 * @returns True if runtime ID is accessible, false if extension was reloaded or invalidated.
 */
function isContextAlive() {
    try {
        return Boolean(chrome.runtime?.id);
    }
    catch {
        return false;
    }
}
/**
 * @function initYouTubeMusicObserver
 *
 * @description Initializes the YouTube Music provider, binds DOM mutation observers, attaches immediate title and button click listeners, and registers message handlers.
 * @returns Void.
 */
function initYouTubeMusicObserver() {
    const provider = new YouTubeMusicProvider();
    let lastState = null;
    let observer = null;
    let titleTagObserver = null;
    let playerTitleObserver = null;
    let videoElement = null;
    let playPauseButtonElement = null;
    let observedTitleElement = null;
    let debounceTimeout = null;
    /**
     * @function teardown
     *
     * @description Disconnects DOM mutation observers and cleans up video and button media listeners upon context invalidation.
     * @returns Void.
     */
    const teardown = () => {
        if (observer) {
            observer.disconnect();
            observer = null;
        }
        if (titleTagObserver) {
            titleTagObserver.disconnect();
            titleTagObserver = null;
        }
        if (playerTitleObserver) {
            playerTitleObserver.disconnect();
            playerTitleObserver = null;
        }
        if (videoElement) {
            videoElement.removeEventListener("play", onVideoStateChange);
            videoElement.removeEventListener("playing", onVideoStateChange);
            videoElement.removeEventListener("pause", onVideoStateChange);
            videoElement.removeEventListener("ended", onVideoStateChange);
        }
        if (playPauseButtonElement) {
            playPauseButtonElement.removeEventListener("click", onPlayPauseClick);
            playPauseButtonElement.removeEventListener("pointerup", onPlayPauseClick);
        }
        console.log("[NotesRPC] Extension context invalidated — scraping stopped. Reload the page to re-activate.");
    };
    /**
     * @function checkAndReport
     *
     * @description Evaluates current player DOM state against previously recorded state and dispatches change messages to the background script, supporting immediate or debounced execution.
     * @param immediate Whether to bypass debounce delays and execute synchronization immediately.
     * @returns Void.
     */
    const checkAndReport = (immediate = false) => {
        if (!isContextAlive()) {
            teardown();
            return;
        }
        if (immediate && debounceTimeout) {
            clearTimeout(debounceTimeout);
            debounceTimeout = null;
        }
        try {
            const currentState = provider.scrape();
            if (!currentState.title) {
                currentState.isPlaying = false;
            }
            const stateChanged = !lastState ||
                lastState.title !== currentState.title ||
                lastState.artist !== currentState.artist ||
                lastState.imageUrl !== currentState.imageUrl ||
                lastState.isPlaying !== currentState.isPlaying;
            if (stateChanged) {
                chrome.runtime.sendMessage({
                    type: "MEDIA_PLAYBACK_STATE",
                    playback: currentState
                }, () => {
                    void chrome.runtime.lastError;
                });
                lastState = currentState;
            }
        }
        catch (e) {
            const err = e;
            if (err.message && err.message.includes("Extension context invalidated")) {
                teardown();
            }
            else {
                console.error("[NotesRPC] Error in YouTube Music scraping:", err);
            }
        }
    };
    /**
     * @function debouncedCheckAndReport
     *
     * @description Debounces execution of playback checking to avoid redundant rapid processing during DOM layout shifts.
     * @returns Void.
     */
    const debouncedCheckAndReport = () => {
        if (debounceTimeout)
            clearTimeout(debounceTimeout);
        debounceTimeout = setTimeout(() => checkAndReport(false), 500);
    };
    /**
     * @function onVideoStateChange
     *
     * @description Immediately triggers playback verification when the HTML5 video element transitions between playing, pause, or ended states.
     * @returns Void.
     */
    const onVideoStateChange = () => {
        checkAndReport(true);
    };
    /**
     * @function onPlayPauseClick
     *
     * @description Handles direct user clicks or touch interactions on the play/pause button, triggering immediate verification followed by a settle check.
     * @returns Void.
     */
    const onPlayPauseClick = () => {
        checkAndReport(true);
        setTimeout(() => checkAndReport(true), 120);
    };
    /**
     * @function attachVideoListeners
     *
     * @description Identifies the active HTML5 video element on YouTube Music and attaches immediate play, playing, pause, and ended event listeners.
     * @returns Void.
     */
    const attachVideoListeners = () => {
        const video = document.querySelector("video");
        if (video && video !== videoElement) {
            if (videoElement) {
                videoElement.removeEventListener("play", onVideoStateChange);
                videoElement.removeEventListener("playing", onVideoStateChange);
                videoElement.removeEventListener("pause", onVideoStateChange);
                videoElement.removeEventListener("ended", onVideoStateChange);
            }
            videoElement = video;
            videoElement.addEventListener("play", onVideoStateChange);
            videoElement.addEventListener("playing", onVideoStateChange);
            videoElement.addEventListener("pause", onVideoStateChange);
            videoElement.addEventListener("ended", onVideoStateChange);
        }
    };
    /**
     * @function attachButtonListeners
     *
     * @description Binds click and pointer interaction handlers to the play/pause button and its feedback shape elements.
     * @returns Void.
     */
    const attachButtonListeners = () => {
        const btn = document.querySelector("#play-pause-button") ||
            document.querySelector("ytmusic-player-bar #play-pause-button");
        if (btn && btn !== playPauseButtonElement) {
            if (playPauseButtonElement) {
                playPauseButtonElement.removeEventListener("click", onPlayPauseClick);
                playPauseButtonElement.removeEventListener("pointerup", onPlayPauseClick);
            }
            playPauseButtonElement = btn;
            playPauseButtonElement.addEventListener("click", onPlayPauseClick);
            playPauseButtonElement.addEventListener("pointerup", onPlayPauseClick);
        }
    };
    /**
     * @function attachTitleObservers
     *
     * @description Attaches dedicated MutationObservers to document title and player title nodes to immediately propagate song title transitions.
     * @returns Void.
     */
    const attachTitleObservers = () => {
        if (!titleTagObserver) {
            const titleTag = document.querySelector("title");
            if (titleTag) {
                titleTagObserver = new MutationObserver(() => {
                    checkAndReport(true);
                });
                titleTagObserver.observe(titleTag, {
                    childList: true,
                    characterData: true,
                    subtree: true
                });
            }
        }
        const titleEl = document.querySelector("ytmusic-player-bar .title span.ytAttributedStringHost") ||
            document.querySelector("ytmusic-player-bar span.ytAttributedStringHost.ytAttributedStringEllipsisTruncate") ||
            document.querySelector("span.ytAttributedStringHost.ytAttributedStringEllipsisTruncate[role='text']") ||
            document.querySelector("ytmusic-player-bar span.ytAttributedStringHost") ||
            document.querySelector("yt-formatted-string.title.ytmusic-player-bar");
        if (titleEl && titleEl !== observedTitleElement) {
            if (playerTitleObserver) {
                playerTitleObserver.disconnect();
            }
            observedTitleElement = titleEl;
            playerTitleObserver = new MutationObserver(() => {
                checkAndReport(true);
            });
            playerTitleObserver.observe(titleEl, {
                childList: true,
                characterData: true,
                subtree: true,
                attributes: true,
                attributeFilter: ["title"]
            });
        }
    };
    observer = new MutationObserver((mutations) => {
        if (!isContextAlive()) {
            teardown();
            return;
        }
        let shouldCheckImmediate = false;
        let shouldCheckDebounced = false;
        for (const mutation of mutations) {
            if (mutation.addedNodes.length) {
                attachVideoListeners();
                attachButtonListeners();
                attachTitleObservers();
            }
            const targetElement = mutation.target;
            if (targetElement.nodeName === "TITLE" ||
                targetElement.classList?.contains?.("ytAttributedStringHost") ||
                targetElement.closest?.("ytmusic-player-bar .title")) {
                shouldCheckImmediate = true;
                break;
            }
            if (targetElement.closest?.("ytmusic-player-bar") ||
                targetElement.closest?.("yt-attributed-string") ||
                targetElement.id === "play-pause-button") {
                shouldCheckDebounced = true;
            }
        }
        if (shouldCheckImmediate) {
            checkAndReport(true);
        }
        else if (shouldCheckDebounced) {
            debouncedCheckAndReport();
        }
    });
    observer.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: true,
        characterData: true,
        attributeFilter: ["title", "src", "d", "href", "aria-label", "aria-pressed"]
    });
    attachVideoListeners();
    attachButtonListeners();
    attachTitleObservers();
    setTimeout(() => checkAndReport(true), 1000);
    try {
        chrome.runtime.onMessage.addListener((message) => {
            if (!isContextAlive()) {
                teardown();
                return;
            }
            if (message.type === "FORCE_REPORT_STATE") {
                checkAndReport(true);
            }
        });
    }
    catch {
        teardown();
    }
    console.log("[NotesRPC] YouTube Music provider active (Event-driven with immediate title & button sync).");
}
if (typeof document !== "undefined") {
    initYouTubeMusicObserver();
}
