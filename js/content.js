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
const lenCalc = (base, chars) => {
  let len = 0;
  let curr = 1;
  while (curr < chars) {
    curr *= base;
    len++;
  }
  return len;
};
const UNICODE_CHARS = 1114112;
const BASE = CHARS.length;
const LEN = lenCalc(BASE, UNICODE_CHARS);
const decodeChar = (encodedChar) => {
  encodedChar = encodedChar.reverse();
  let curr = 1;
  let charCode = 0;
  for (const digit of encodedChar) {
    charCode += digit * curr;
    curr *= BASE;
  }
  return String.fromCodePoint(charCode);
};
const decode = (s) => {
  const match = encodedPattern.exec(s);
  if (!match) return s;
  s = match[1];
  let curr = [];
  let res = "";
  for (const c of s) {
    curr.push(CHARS_MAP[c]);
    if (curr.length >= LEN) {
      res += decodeChar(curr);
      curr = [];
    }
  }
  return res;
};
const hasEncodedContent = (s) => encodedPattern.test(s);
console.debug("[IFBN] content script loaded v1.0.1");
let observerEnabled = true;
const initObserver = () => {
  chrome.storage.local.get(["observerEnabled"], (result) => {
    observerEnabled = result.observerEnabled !== false;
    if (observerEnabled) {
      startObserver();
    }
  });
};
chrome.storage.onChanged.addListener((changes) => {
  if (changes.observerEnabled !== void 0) {
    observerEnabled = changes.observerEnabled.newValue;
    if (observerEnabled) {
      startObserver();
    } else {
      stopObserver();
    }
  }
});
let mutationObserver = null;
const startObserver = () => {
  if (mutationObserver) {
    mutationObserver.disconnect();
  }
  mutationObserver = new MutationObserver((mutations) => {
    if (!observerEnabled) return;
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
};
const stopObserver = () => {
  if (mutationObserver) {
    mutationObserver.disconnect();
    mutationObserver = null;
  }
};
const processNode = (node) => {
  const textNodes = [];
  const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT, null);
  let textNode;
  while (textNode = walker.nextNode()) {
    if (textNode.textContent && hasEncodedContent(textNode.textContent)) {
      textNodes.push(textNode);
    }
  }
  for (const tn of textNodes) {
    decodeTextNode(tn);
  }
};
const processExistingNotes = () => {
  const allTextNodes = [];
  const walker = document.createTreeWalker(
    document.body,
    NodeFilter.SHOW_TEXT,
    {
      acceptNode: (node) => {
        if (node.textContent && hasEncodedContent(node.textContent)) {
          return NodeFilter.FILTER_ACCEPT;
        }
        return NodeFilter.FILTER_REJECT;
      }
    }
  );
  let textNode;
  while (textNode = walker.nextNode()) {
    allTextNodes.push(textNode);
  }
  for (const tn of allTextNodes) {
    decodeTextNode(tn);
  }
};
const decodeTextNode = (textNode) => {
  const content = textNode.textContent;
  if (!content) return;
  const decoded = decode(content);
  if (decoded !== content) {
    const span = document.createElement("span");
    span.className = "ifbn-decoded-note";
    span.style.cssText = "display: inline;";
    const visiblePart = content.split(PADDING_START)[0] || "";
    span.innerHTML = `${escapeHtml(visiblePart)} <span style="background: rgba(139,92,246,0.2); color: #a78bfa; padding: 1px 4px; border-radius: 3px; font-size: 0.9em;">🔒 ${escapeHtml(decoded)}</span>`;
    textNode.parentNode?.replaceChild(span, textNode);
  }
};
const escapeHtml = (text) => {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
};
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initObserver);
} else {
  initObserver();
}




