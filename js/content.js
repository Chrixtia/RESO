"use strict";
/**
 * @fileoverview RESO - Content Script
 *
 * @description Facebook DOM content script decoding steganographically encoded status notes and observing realtime DOM additions.
 * @author @Chrixtia
 */
const PADDING_START = "‌";
const PADDING_END = "󠁡";
const CHARS = [
    "󠁢",
    "󠁣",
    "󠁤",
    "󠁥",
    "󠁦",
    "󠁧",
    "󠁨",
    "󠁩",
    "󠁪",
    "󠁫",
    "󠁬",
    "󠁭",
    "󠁮",
    "󠁯",
    "󠁰",
    "󠁱",
    "󠁲",
    "󠁳",
    "󠁴",
    "󠁵",
    "󠁶",
    "󠁷",
    "󠁸",
    "󠁹",
    "󠁺",
    "󠁿"
];
const encodedPattern = new RegExp(`${PADDING_START}([${CHARS.join("")}]+?)${PADDING_END}`);
const CHARS_MAP = CHARS.reduce((curr, val, i) => {
    curr[val] = i;
    return curr;
}, {});
/**
 * @function lenCalc
 *
 * @description Calculates encoding chunk length required to represent full Unicode codepoints in the custom base alphabet.
 * @param base Radix base count of encoding alphabet characters.
 * @param chars Maximum possible Unicode characters to accommodate.
 * @returns Minimum chunk length necessary.
 */
function lenCalc(base, chars) {
    let len = 0;
    let curr = 1;
    while (curr < chars) {
        curr *= base;
        len++;
    }
    return len;
}
const UNICODE_CHARS = 1114112;
const BASE = CHARS.length;
const LEN = lenCalc(BASE, UNICODE_CHARS);
/**
 * @function decodeChar
 *
 * @description Decodes an array of base-encoded numeric indices back into a single Unicode character string.
 * @param encodedChar Array of numeric digit values in reverse order.
 * @returns Decoded Unicode character string.
 */
function decodeChar(encodedChar) {
    const reversed = [...encodedChar].reverse();
    let curr = 1;
    let charCode = 0;
    for (const digit of reversed) {
        charCode += digit * curr;
        curr *= BASE;
    }
    return String.fromCodePoint(charCode);
}
/**
 * @function decode
 *
 * @description Extracts and decodes hidden steganographic payload strings wrapped inside padding delimiters.
 * @param s Raw string potentially containing delimiter-wrapped encoded symbols.
 * @returns Extracted and decoded text string, or original text if no pattern matches.
 */
function decode(s) {
    const match = encodedPattern.exec(s);
    if (!match)
        return s;
    const rawEncoded = match[1];
    let curr = [];
    let res = "";
    for (const c of rawEncoded) {
        curr.push(CHARS_MAP[c]);
        if (curr.length >= LEN) {
            res += decodeChar(curr);
            curr = [];
        }
    }
    return res;
}
/**
 * @function hasEncodedContent
 *
 * @description Tests whether a text string contains padding delimiters indicating encoded hidden payload.
 * @param s Text string to test.
 * @returns True if pattern exists, false otherwise.
 */
function hasEncodedContent(s) {
    return encodedPattern.test(s);
}
let observerEnabled = true;
let mutationObserver = null;
/**
 * @function escapeHtml
 *
 * @description Sanitizes and encodes plain text into safe HTML entities using DOM div text assignment.
 * @param text Raw plain text string.
 * @returns Escaped HTML safe string.
 */
function escapeHtml(text) {
    const div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
}
/**
 * @function decodeTextNode
 *
 * @description Inspects a DOM text node and replaces encoded sequences with styled visible span badges.
 * @param textNode DOM Text node to evaluate and optionally replace.
 * @returns Void.
 */
function decodeTextNode(textNode) {
    const content = textNode.textContent;
    if (!content)
        return;
    const decoded = decode(content);
    if (decoded !== content) {
        const span = document.createElement("span");
        span.className = "ifbn-decoded-note";
        span.style.cssText = "display: inline;";
        const visiblePart = content.split(PADDING_START)[0] || "";
        span.innerHTML = `${escapeHtml(visiblePart)} <span style="background: rgba(139,92,246,0.2); color: #a78bfa; padding: 1px 4px; border-radius: 3px; font-size: 0.9em;">🔒 ${escapeHtml(decoded)}</span>`;
        textNode.parentNode?.replaceChild(span, textNode);
    }
}
/**
 * @function processNode
 *
 * @description Walks a newly inserted DOM subtree collecting and decoding text nodes that contain encoded markers.
 * @param node Root DOM element or subtree to search.
 * @returns Void.
 */
function processNode(node) {
    const textNodes = [];
    const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT, null);
    let textNode = walker.nextNode();
    while (textNode) {
        if (textNode.textContent && hasEncodedContent(textNode.textContent)) {
            textNodes.push(textNode);
        }
        textNode = walker.nextNode();
    }
    for (const tn of textNodes) {
        decodeTextNode(tn);
    }
}
/**
 * @function processExistingNotes
 *
 * @description Scans the entire document body for existing notes and decodes them immediately.
 * @returns Void.
 */
function processExistingNotes() {
    const allTextNodes = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
        acceptNode: (node) => {
            if (node.textContent && hasEncodedContent(node.textContent)) {
                return NodeFilter.FILTER_ACCEPT;
            }
            return NodeFilter.FILTER_REJECT;
        }
    });
    let textNode = walker.nextNode();
    while (textNode) {
        allTextNodes.push(textNode);
        textNode = walker.nextNode();
    }
    for (const tn of allTextNodes) {
        decodeTextNode(tn);
    }
}
/**
 * @function startObserver
 *
 * @description Instantiates and attaches a MutationObserver to document.body to detect dynamic note injections.
 * @returns Void.
 */
function startObserver() {
    if (mutationObserver) {
        mutationObserver.disconnect();
    }
    mutationObserver = new MutationObserver((mutations) => {
        if (!observerEnabled)
            return;
        for (const mutation of mutations) {
            for (const node of mutation.addedNodes) {
                if (node.nodeType === Node.ELEMENT_NODE) {
                    processNode(node);
                }
            }
        }
    });
    mutationObserver.observe(document.body, {
        childList: true,
        subtree: true,
        characterData: true
    });
    processExistingNotes();
}
/**
 * @function stopObserver
 *
 * @description Disconnects active DOM mutation observer if present.
 * @returns Void.
 */
function stopObserver() {
    if (mutationObserver) {
        mutationObserver.disconnect();
        mutationObserver = null;
    }
}
/**
 * @function initObserver
 *
 * @description Reads user observer configuration from local storage and activates DOM monitoring if enabled.
 * @returns Void.
 */
function initObserver() {
    chrome.storage.local.get(["observerEnabled"], (result) => {
        observerEnabled = result.observerEnabled !== false;
        if (observerEnabled) {
            startObserver();
        }
    });
}
chrome.storage.onChanged.addListener((changes) => {
    if (changes.observerEnabled !== undefined) {
        observerEnabled = Boolean(changes.observerEnabled.newValue);
        if (observerEnabled) {
            startObserver();
        }
        else {
            stopObserver();
        }
    }
});
console.debug("[IFBN] content script loaded v1.0.1");
if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initObserver);
}
else {
    initObserver();
}
