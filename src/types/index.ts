/**
 * @fileoverview RESO - Type Definitions
 *
 * @description Centralized TypeScript type definitions and interfaces for RESO extension messaging, Facebook API tokens, media playback state, and settings storage.
 * @author @Chrixtia
 */

export interface PlaybackState {
  title: string;
  artist: string;
  isPlaying: boolean;
  imageUrl?: string | null;
  originalTitle?: string;
  originalArtist?: string;
}

export interface FacebookTokens {
  fb_dtsg: string;
  jazoest: string;
  userId: string;
  lsd: string;
}

export interface ExtensionSettings {
  automationEnabled: boolean;
  ambienceEnabled?: boolean;
  startTime: string;
  endTime: string;
  audienceSetting?: "FRIENDS" | "PUBLIC" | "CUSTOM";
  customFriendIds?: string[];
  lastSentSong?: PlaybackState | null;
}

export interface HistoryItem {
  title: string;
  timestamp: number;
  status: "success" | "error";
}

export interface MusicItem {
  id: string;
  songId?: string;
  audioClusterId?: string;
  title: string;
  artist: string;
  imageUri?: string;
  durationMs?: number;
  progressiveDownloadUrl?: string;
}

export interface FriendItem {
  id: string;
  name: string;
  imageUri?: string;
}

export interface CurrentNoteStatus {
  richStatusId?: string | null;
  avatarUri?: string;
  description?: string | null;
  noteType?: string | null;
  visibility?: string | null;
  expirationTime?: number | null;
  musicTitle?: string | null;
  musicArtist?: string | null;
  customAudienceNames?: string[];
  customAudienceSize?: number | null;
  defaultAudienceSetting?: string | null;
}

export interface PageInfoResult {
  cookie: string;
  html: string;
}

export interface ApiResponse<T = unknown> {
  success: boolean;
  error?: string;
  tokens?: FacebookTokens | null;
  items?: T[];
  status?: CurrentNoteStatus;
  nextCursor?: string | null;
  hasNextPage?: boolean;
  progressiveDownload?: string;
}
