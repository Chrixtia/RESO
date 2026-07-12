/**
 * YouTube Music Provider implementation.
 * Extends MusicProvider to scrape current track metadata and play state.
 */
class YouTubeMusicProvider extends window.MusicProvider {
  /**
   * Scrapes current playback state from the YouTube Music DOM.
   * @returns {{title: string, artist: string, isPlaying: boolean, originalTitle: string, originalArtist: string}}
   */
  scrape() {
    // Scrape Title
    const titleEl = document.querySelector('yt-formatted-string.title.ytmusic-player-bar');
    const rawTitle = titleEl ? (titleEl.getAttribute('title') || titleEl.textContent).trim() : "";

    // Scrape Artist (specifically targeting the channel link)
    const artistEl = document.querySelector('a.yt-simple-endpoint.yt-formatted-string[href^="channel/"]');
    let rawArtist = "";
    if (artistEl) {
      rawArtist = artistEl.textContent.trim();
    } else {
      // Fallback
      const bylineEl = document.querySelector("ytmusic-player-bar .byline");
      if (bylineEl) {
        const parts = bylineEl.textContent.trim().split(/•|·/);
        rawArtist = parts[0].trim();
      }
    }

    // Scrape isPlaying from play/pause SVG paths
    const pauseIconPath = "M6.5 3A1.5 1.5 0 005 4.5v15A1.5 1.5 0 006.5 21h2a1.5 1.5 0 001.5-1.5v-15A1.5 1.5 0 008.5 3h-2Zm9 0A1.5 1.5 0 0014 4.5v15a1.5 1.5 0 001.5 1.5h2a1.5 1.5 0 001.5-1.5v-15A1.5 1.5 0 0017.5 3h-2Z";
    const playIconPath = "M5 4.623V19.38a1.5 1.5 0 002.26 1.29L22 12 7.26 3.33A1.5 1.5 0 005 4.623Z";

    let isPlaying = false;
    let foundSvg = false;
    const paths = document.querySelectorAll('#play-pause-button svg path, .ytmusic-player-bar svg path');
    for (const path of paths) {
      const d = path.getAttribute("d");
      if (d === pauseIconPath) {
        isPlaying = true;
        foundSvg = true;
        break;
      } else if (d === playIconPath) {
        isPlaying = false;
        foundSvg = true;
        break;
      }
    }

    // Fallback to video element if SVG method fails
    if (!foundSvg) {
      const video = document.querySelector("video");
      isPlaying = video ? !video.paused && !video.ended : false;
    }

    // Scrape Image
    const imgEl = document.querySelector('img.image.ytmusic-player-bar');
    const imageUrl = imgEl ? imgEl.src : null;

    // Clean and sanitize (force strict English)
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


// Running execution loop
(() => {
  const provider = new YouTubeMusicProvider();
  let lastState = null;
  let observer = null;
  let videoElement = null;
  let debounceTimeout = null;

  const isContextAlive = () => {
    try {
      return Boolean(chrome.runtime?.id);
    } catch {
      return false;
    }
  };

  const teardown = () => {
    if (observer) {
      observer.disconnect();
      observer = null;
    }
    if (videoElement) {
      videoElement.removeEventListener('play', debouncedCheckAndReport);
      videoElement.removeEventListener('pause', debouncedCheckAndReport);
      videoElement.removeEventListener('ended', debouncedCheckAndReport);
    }
    console.log("[NotesRPC] Extension context invalidated — scraping stopped. Reload the page to re-activate.");
  };

  const checkAndReport = () => {
    if (!isContextAlive()) {
      teardown();
      return;
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
    } catch (e) {
      if (e.message && e.message.includes("Extension context invalidated")) {
        teardown();
      } else {
        console.error("[NotesRPC] Error in YouTube Music scraping:", e);
      }
    }
  };

  const debouncedCheckAndReport = () => {
    if (debounceTimeout) clearTimeout(debounceTimeout);
    debounceTimeout = setTimeout(checkAndReport, 500);
  };

  const attachVideoListeners = () => {
    const video = document.querySelector("video");
    if (video && video !== videoElement) {
      if (videoElement) {
        videoElement.removeEventListener('play', debouncedCheckAndReport);
        videoElement.removeEventListener('pause', debouncedCheckAndReport);
        videoElement.removeEventListener('ended', debouncedCheckAndReport);
      }
      videoElement = video;
      videoElement.addEventListener('play', debouncedCheckAndReport);
      videoElement.addEventListener('pause', debouncedCheckAndReport);
      videoElement.addEventListener('ended', debouncedCheckAndReport);
    }
  };

  // Setup DOM Mutation Observer to detect song changes and UI updates
  observer = new MutationObserver((mutations) => {
    if (!isContextAlive()) {
      teardown();
      return;
    }
    let shouldCheck = false;
    for (const mutation of mutations) {
      // Re-attach video listeners if video element is injected/changed
      if (mutation.addedNodes.length) {
        attachVideoListeners();
      }
      // Target the player bar specifically to avoid observing the whole noisy DOM
      if (mutation.target.closest('ytmusic-player-bar') || mutation.target.nodeName === 'TITLE') {
        shouldCheck = true;
        break;
      }
    }
    if (shouldCheck) {
      debouncedCheckAndReport();
    }
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['title', 'src', 'd', 'href']
  });

  attachVideoListeners();
  
  // Initial check
  setTimeout(checkAndReport, 1000);

  try {
    chrome.runtime.onMessage.addListener((message) => {
      if (!isContextAlive()) {
        teardown();
        return;
      }
      if (message.type === "FORCE_REPORT_STATE") {
        checkAndReport();
      }
    });
  } catch (e) {
    teardown();
  }

  console.log("[NotesRPC] YouTube Music provider active (Event-driven).");
})();

