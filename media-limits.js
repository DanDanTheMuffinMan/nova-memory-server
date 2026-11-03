'use strict';

// Limit raw input bytes retained by the in-memory/base64 media store.
// This does not replace authentication or make in-memory storage durable.
const MEDIA_FILE_LIMIT_BYTES = 8 * 1024 * 1024;
const MEDIA_USER_LIMIT_BYTES = 24 * 1024 * 1024;
const MEDIA_GLOBAL_LIMIT_BYTES = 64 * 1024 * 1024;
const MEDIA_USER_LIMIT_ITEMS = 100;
const MEDIA_GLOBAL_LIMIT_ITEMS = 500;

function usageFor(mediaStore, userId) {
  const own = Object.prototype.hasOwnProperty.call(mediaStore, userId);
  const userEntries = own && Array.isArray(mediaStore[userId]) ? mediaStore[userId] : [];
  let totalBytes = 0;
  let totalItems = 0;
  let userBytes = 0;

  for (const [key, entries] of Object.entries(mediaStore)) {
    if (!Array.isArray(entries)) continue;
    for (const item of entries) {
      const bytes = Number.isSafeInteger(item.size) && item.size > 0 ? item.size : 0;
      totalBytes += bytes;
      totalItems += 1;
      if (key === userId) userBytes += bytes;
    }
  }

  return { totalBytes, totalItems, userBytes, userItems: userEntries.length };
}

function canAcceptMedia(mediaStore, userId, fileBytes) {
  if (typeof userId !== 'string' || !userId.trim()) {
    return { ok: false, status: 400, error: 'Missing userId' };
  }
  if (!Number.isSafeInteger(fileBytes) || fileBytes < 1) {
    return { ok: false, status: 400, error: 'Empty or invalid media file' };
  }
  if (fileBytes > MEDIA_FILE_LIMIT_BYTES) {
    return { ok: false, status: 413, error: 'Media file exceeds 8 MiB limit' };
  }

  const u = usageFor(mediaStore, userId);
  if (u.userItems >= MEDIA_USER_LIMIT_ITEMS || u.userBytes + fileBytes > MEDIA_USER_LIMIT_BYTES) {
    return { ok: false, status: 413, error: 'User media quota reached; existing media preserved' };
  }
  if (u.totalItems >= MEDIA_GLOBAL_LIMIT_ITEMS || u.totalBytes + fileBytes > MEDIA_GLOBAL_LIMIT_BYTES) {
    return { ok: false, status: 413, error: 'Server media quota reached; existing media preserved' };
  }
  return { ok: true };
}

module.exports = {
  MEDIA_FILE_LIMIT_BYTES,
  MEDIA_USER_LIMIT_BYTES,
  MEDIA_GLOBAL_LIMIT_BYTES,
  MEDIA_USER_LIMIT_ITEMS,
  MEDIA_GLOBAL_LIMIT_ITEMS,
  canAcceptMedia
};
