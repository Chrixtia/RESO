/**
 * @fileoverview RESO - Utility Test Suite
 *
 * @description Unit tests verifying time calculations, string sanitization, title cleaning functions, and YouTube Music DOM scraping.
 * @author @Chrixtia
 */
import test from "node:test";
import assert from "node:assert/strict";
import { parseTimeToMinutes, isWithinTimeWindow } from "../utils/time.js";
import "../music-provider.js";
import "../youtube-music-provider.js";
const ProviderConstructor = globalThis.MusicProvider;
const YtProviderConstructor = globalThis.YouTubeMusicProvider;
class TestMusicProvider extends ProviderConstructor {
    scrape() {
        return {
            title: "Test",
            artist: "Test",
            isPlaying: false
        };
    }
}
test("parseTimeToMinutes parses standard and 12-hour AM/PM formats", () => {
    assert.equal(parseTimeToMinutes("08:00"), 480);
    assert.equal(parseTimeToMinutes("22:00"), 1320);
    assert.equal(parseTimeToMinutes("08:00 AM"), 480);
    assert.equal(parseTimeToMinutes("08:00 PM"), 1200);
    assert.equal(parseTimeToMinutes("12:00 AM"), 0);
    assert.equal(parseTimeToMinutes("12:00 PM"), 720);
    assert.equal(parseTimeToMinutes(""), null);
    assert.equal(parseTimeToMinutes("invalid"), null);
});
test("isWithinTimeWindow evaluates daytime intervals correctly", () => {
    const at10am = new Date(2026, 0, 1, 10, 0);
    const at11pm = new Date(2026, 0, 1, 23, 0);
    assert.equal(isWithinTimeWindow("08:00", "22:00", at10am), true);
    assert.equal(isWithinTimeWindow("08:00", "22:00", at11pm), false);
    assert.equal(isWithinTimeWindow(undefined, undefined, at10am), true);
});
test("isWithinTimeWindow evaluates overnight intervals correctly", () => {
    const at11pm = new Date(2026, 0, 1, 23, 0);
    const at3am = new Date(2026, 0, 1, 3, 0);
    const at12pm = new Date(2026, 0, 1, 12, 0);
    assert.equal(isWithinTimeWindow("22:00", "08:00", at11pm), true);
    assert.equal(isWithinTimeWindow("22:00", "08:00", at3am), true);
    assert.equal(isWithinTimeWindow("22:00", "08:00", at12pm), false);
});
test("MusicProvider.sanitizeString strips Vietnamese diacritics and non-ASCII glyphs", () => {
    const provider = new TestMusicProvider();
    assert.equal(provider.sanitizeString("Đường Tôi Chở Em Về"), "Duong Toi Cho Em Ve");
    assert.equal(provider.sanitizeString("Nơi Này Có Anh"), "Noi Nay Co Anh");
    assert.equal(provider.sanitizeString("Hello World 🎵"), "Hello World");
});
test("MusicProvider.cleanTitle strips promotional and media tags", () => {
    const provider = new TestMusicProvider();
    assert.equal(provider.cleanTitle("Song Title (Official Video)"), "Song Title");
    assert.equal(provider.cleanTitle("Song Title [Official Lyric Video]"), "Song Title");
    assert.equal(provider.cleanTitle("Song Title (Lyrics)"), "Song Title");
    assert.equal(provider.cleanTitle("Song Title - Official Audio"), "Song Title");
});
test("YouTubeMusicProvider.scrape extracts title, artist, and modern thumbnail", () => {
    const originalDocument = globalThis.document;
    globalThis.document = {
        querySelector: (selector) => {
            if (selector.includes("span.ytAttributedStringHost")) {
                return {
                    getAttribute: () => null,
                    textContent: "Out Of My League"
                };
            }
            if (selector.includes("a.ytAttributedStringLink")) {
                return {
                    getAttribute: () => null,
                    textContent: "LANY"
                };
            }
            if (selector.includes("img.ytmusicTrackInfoThumbnail")) {
                return {
                    src: "https://yt3.googleusercontent.com/ROTkWNKUfCMc5hkTRtoBL4DhvFUel-88yxuROqC3wkY1EdYr7IWTygUbPRBtNPwzcuh3x2LQSIu-twpY=w60-h60-l90-rj"
                };
            }
            if (selector.includes("#play-pause-button")) {
                return {
                    getAttribute: (attr) => (attr === "aria-label" ? "Pause" : null)
                };
            }
            return null;
        },
        querySelectorAll: () => []
    };
    try {
        const provider = new YtProviderConstructor();
        const playback = provider.scrape();
        assert.equal(playback.title, "Out Of My League");
        assert.equal(playback.artist, "LANY");
        assert.equal(playback.isPlaying, true);
        assert.equal(playback.imageUrl, "https://yt3.googleusercontent.com/ROTkWNKUfCMc5hkTRtoBL4DhvFUel-88yxuROqC3wkY1EdYr7IWTygUbPRBtNPwzcuh3x2LQSIu-twpY=w60-h60-l90-rj");
        assert.equal(playback.originalTitle, "Out Of My League");
        assert.equal(playback.originalArtist, "LANY");
    }
    finally {
        globalThis.document = originalDocument;
    }
});
test("YouTubeMusicProvider.scrape handles play state from button aria-label without touch feedback class", () => {
    const originalDocument = globalThis.document;
    globalThis.document = {
        querySelector: (selector) => {
            if (selector.includes("span.ytAttributedStringHost")) {
                return {
                    getAttribute: () => null,
                    textContent: "Out Of My League"
                };
            }
            if (selector.includes("a.ytAttributedStringLink")) {
                return {
                    getAttribute: () => null,
                    textContent: "LANY"
                };
            }
            if (selector.includes("#play-pause-button")) {
                return {
                    getAttribute: (attr) => (attr === "aria-label" ? "Play" : null)
                };
            }
            return null;
        },
        querySelectorAll: () => []
    };
    try {
        const provider = new YtProviderConstructor();
        const playback = provider.scrape();
        assert.equal(playback.isPlaying, false);
    }
    finally {
        globalThis.document = originalDocument;
    }
});
