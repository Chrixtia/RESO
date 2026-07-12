/**
 * Base MusicProvider interface for Chrome Extension playback scraping.
 * Each provider (e.g. YouTubeMusic, Spotify) extends this class.
 */
class MusicProvider {
  constructor() {
    if (new.target === MusicProvider) {
      throw new TypeError("Cannot instantiate abstract class MusicProvider directly.");
    }
  }

  /**
   * Scrapes current playback state.
   * @returns {{title: string, artist: string, isPlaying: boolean}}
   */
  scrape() {
    throw new Error("Method 'scrape()' must be implemented.");
  }

  /**
   * Cleans and sanitizes a metadata string, forcing English characters.
   * Strips Vietnamese accents and maps them to standard English ASCII.
   * @param {string} str 
   * @returns {string}
   */
  sanitizeString(str) {
    if (!str || typeof str !== "string") return "";
    
    // Normalize and remove Vietnamese accents
    let sanitized = str.normalize("NFD");
    
    // Detailed Vietnamese character mapping
    const replacementMap = {
      "à": "a", "á": "a", "ạ": "a", "ả": "a", "ã": "a", "â": "a", "ầ": "a", "ấ": "a", "ậ": "a", "ẩ": "a", "ẫ": "a", "ă": "a", "ằ": "a", "ắ": "a", "ặ": "a", "ẳ": "a", "ẵ": "a",
      "è": "e", "é": "e", "ẹ": "e", "ẻ": "e", "ẽ": "e", "ê": "e", "ề": "e", "ế": "e", "ệ": "e", "ể": "e", "ễ": "e",
      "ì": "i", "í": "i", "ị": "i", "ỉ": "i", "ĩ": "i",
      "ò": "o", "ó": "o", "ọ": "o", "ỏ": "o", "õ": "o", "ô": "o", "ồ": "o", "ố": "o", "ộ": "o", "ổ": "o", "ỗ": "o", "ơ": "o", "ờ": "o", "ớ": "o", "ợ": "o", "ở": "o", "ỡ": "o",
      "ù": "u", "ú": "u", "ụ": "u", "ủ": "u", "ũ": "u", "ư": "u", "ừ": "u", "ứ": "u", "ự": "u", "ử": "u", "ữ": "u",
      "ỳ": "y", "ý": "y", "ỵ": "y", "ỷ": "y", "ỹ": "y",
      "đ": "d",
      "À": "A", "Á": "A", "Ạ": 'A', "Ả": "A", "Ã": "A", "Â": "A", "Ầ": "A", "Ấ": "A", "Ậ": "A", "Ẩ": "A", "Ẫ": "A", "Ă": "A", "Ằ": "A", "Ắ": "A", "Ặ": "A", "Ẳ": "A", "Ẵ": "A",
      "È": "E", "É": "E", "Ẹ": "E", "Ẻ": "E", "Ẽ": "E", "Ê": "E", "Ề": "E", "Ế": "E", "Ệ": "E", "Ể": "E", "Ễ": "E",
      "Ì": "I", "Í": "I", "Ị": "I", "Ỉ": "I", "Ĩ": "I",
      "Ò": "O", "Ó": "O", "Ọ": "O", "Ỏ": "O", "Õ": "O", "Ô": "O", "Ồ": "O", "Ố": "O", "Ộ": "O", "Ổ": "O", "Ỗ": "O", "Ơ": "O", "Ờ": "O", "Ớ": "O", "Ợ": "O", "Ở": "O", "Ỡ": "O",
      "Ù": "U", "Ú": "U", "Ụ": "U", "Ủ": "U", "U": "U", "Ư": "U", "Ừ": "U", "Ứ": "U", "Ự": "U", "Ử": "U", "Ữ": "U",
      "Ỳ": "Y", "Ý": "Y", "Ỵ": "Y", "Ỷ": "Y", "Ỹ": "Y",
      "Đ": "D"
    };

    // Replace based on map
    sanitized = sanitized.replace(/[àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđÀÁẠẢÃÂẦẤẬẨẪĂẰẮẶẲẴÈÉẸẺẼÊỀẾỆỂỄÌÍỊỈĨÒÓỌỎÕÔỒỐỘỔỖƠỜỚỢỞỠÙÚỤỦŨƯỪỨỰỬỮỲÝỴỶỸĐ]/g, (match) => replacementMap[match] || match);
    
    // Strip combining diacritical marks
    sanitized = sanitized.replace(/[\u0300-\u036f]/g, "");

    // Strip remaining non-ASCII characters to guarantee English localization
    sanitized = sanitized.replace(/[^\x00-\x7F]/g, "");

    return sanitized.trim();
  }

  /**
   * Helper to clean up common junk tags in song titles (e.g. "Official MV") to optimize song searching.
   * @param {string} title 
   * @returns {string}
   */
  cleanTitle(title) {
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

// Attach to global scope for other content scripts to access.
// Both window.MusicProvider and the bare name are exposed so subclasses
// can use either `extends MusicProvider` or `extends window.MusicProvider`.
window.MusicProvider = MusicProvider;
