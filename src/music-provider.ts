/**
 * @fileoverview RESO - Base Music Provider
 *
 * @description Abstract base class establishing the contract for platform-specific playback scrapers and string sanitization utilities.
 * @author @Chrixtia
 */

/**
 * @class MusicProvider
 *
 * @description Abstract media provider enforcing playback scraping and offering string normalization tools for metadata formatting.
 * @author @Chrixtia
 */
class MusicProvider {
  /**
   * @method constructor
   *
   * @description Prevents direct instantiation of the abstract base class.
   * @returns Instance of MusicProvider subclass.
   */
  constructor() {
    if (new.target === MusicProvider) {
      throw new TypeError("Cannot instantiate abstract class MusicProvider directly.");
    }
  }

  /**
   * @method scrape
   *
   * @description Scrapes the active media player DOM to extract current track metadata and playing state.
   * @returns Playback state containing title, artist, playback status, and artwork URI.
   */
  scrape(): import("./types/index.js").PlaybackState {
    throw new Error("Method 'scrape()' must be implemented.");
  }

  /**
   * @method sanitizeString
   *
   * @description Strips Vietnamese diacritics, normalizes Unicode diacritical marks, and removes non-ASCII characters to produce standardized English text.
   * @param str Raw string containing potential diacritics or foreign glyphs.
   * @returns Sanitized ASCII string.
   */
  sanitizeString(str: string): string {
    if (!str || typeof str !== "string") return "";

    let sanitized = str.normalize("NFD");

    const replacementMap: Record<string, string> = {
      "à": "a", "á": "a", "ạ": "a", "ả": "a", "ã": "a", "â": "a", "ầ": "a", "ấ": "a", "ậ": "a", "ẩ": "a", "ẫ": "a", "ă": "a", "ằ": "a", "ắ": "a", "ặ": "a", "ẳ": "a", "ẵ": "a",
      "è": "e", "é": "e", "ẹ": "e", "ẻ": "e", "ẽ": "e", "ê": "e", "ề": "e", "ế": "e", "ệ": "e", "ể": "e", "ễ": "e",
      "ì": "i", "í": "i", "ị": "i", "ỉ": "i", "ĩ": "i",
      "ò": "o", "ó": "o", "ọ": "o", "ỏ": "o", "õ": "o", "ô": "o", "ồ": "o", "ố": "o", "ộ": "o", "ổ": "o", "ỗ": "o", "ơ": "o", "ờ": "o", "ớ": "o", "ợ": "o", "ở": "o", "ỡ": "o",
      "ù": "u", "ú": "u", "ụ": "u", "ủ": "u", "ũ": "u", "ư": "u", "ừ": "u", "ứ": "u", "ự": "u", "ử": "u", "ữ": "u",
      "ỳ": "y", "ý": "y", "ỵ": "y", "ỷ": "y", "ỹ": "y",
      "đ": "d",
      "À": "A", "Á": "A", "Ạ": "A", "Ả": "A", "Ã": "A", "Â": "A", "Ầ": "A", "Ấ": "A", "Ậ": "A", "Ẩ": "A", "Ẫ": "A", "Ă": "A", "Ằ": "A", "Ắ": "A", "Ặ": "A", "Ẳ": "A", "Ẵ": "A",
      "È": "E", "É": "E", "Ẹ": "E", "Ẻ": "E", "Ẽ": "E", "Ê": "E", "Ề": "E", "Ế": "E", "Ệ": "E", "Ể": "E", "Ễ": "E",
      "Ì": "I", "Í": "I", "Ị": "I", "Ỉ": "I", "Ĩ": "I",
      "Ò": "O", "Ó": "O", "Ọ": "O", "Ỏ": "O", "Õ": "O", "Ô": "O", "Ồ": "O", "Ố": "O", "Ộ": "O", "Ổ": "O", "Ỗ": "O", "Ơ": "O", "Ờ": "O", "Ớ": "O", "Ợ": "O", "Ở": "O", "Ỡ": "O",
      "Ù": "U", "Ú": "U", "Ụ": "U", "Ủ": "U", "U": "U", "Ư": "U", "Ừ": "U", "Ứ": "U", "Ự": "U", "Ử": "U", "Ữ": "U",
      "Ỳ": "Y", "Ý": "Y", "Ỵ": "Y", "Ỷ": "Y", "Ỹ": "Y",
      "Đ": "D"
    };

    sanitized = sanitized.replace(
      /[àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđÀÁẠẢÃÂẦẤẬẨẪĂẰẮẶẲẴÈÉẸẺẼÊỀẾỆỂỄÌÍỊỈĨÒÓỌỎÕÔỒỐỘỔỖƠỜỚỢỞỠÙÚỤỦŨƯỪỨỰỬỮỲÝỴỶỸĐ]/g,
      (match) => replacementMap[match] || match
    );

    sanitized = sanitized.replace(/[\u0300-\u036f]/g, "");
    sanitized = sanitized.replace(/[^\x00-\x7F]/g, "");

    return sanitized.trim();
  }

  /**
   * @method cleanTitle
   *
   * @description Cleans track titles by stripping common promotional tags, official video markers, and bracketed noise to improve catalogue matching.
   * @param title Raw track title string.
   * @returns Stripped and trimmed title string.
   */
  cleanTitle(title: string): string {
    if (!title) return "";
    let cleaned = title;

    const patterns = [
      /\s*\[\s*(official\s+video|official\s+lyric\s+video|official\s+audio|mv|official)\s*\]/i,
      /\s*\(\s*(official\s+video|official\s+lyric\s+video|official\s+audio|mv|official)\s*\)/i,
      /\s*-\s*(official\s+video|official\s+lyric\s+video|official\s+audio|mv|official)/i,
      /\s*\[\s*lyrics?\s*\]/i,
      /\s*\(\s*lyrics?\s*\)/i
    ];

    for (const pattern of patterns) {
      cleaned = cleaned.replace(pattern, "");
    }

    return cleaned.trim();
  }
}

if (typeof window !== "undefined") {
  window.MusicProvider = MusicProvider;
}
if (typeof globalThis !== "undefined") {
  (globalThis as unknown as { MusicProvider: typeof MusicProvider }).MusicProvider = MusicProvider;
}
