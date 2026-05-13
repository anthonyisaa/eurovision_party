// Preload script for the YouTube BrowserWindow.
//
// Polls the <video> element every 2 seconds and forwards its currentTime
// to the main process via IPC. Main process upserts parties + fires due
// commentary atomically.
//
// We deliberately only emit when the video is actively playing — pausing
// (e.g. during ads or manual scrubbing) should freeze our derived event
// rather than racing ahead.

import { ipcRenderer } from 'electron';

function tick() {
  const video = document.querySelector('video');
  if (!video) return;
  if (video.paused) return;
  if (Number.isNaN(video.currentTime)) return;
  ipcRenderer.send('yt:tick', video.currentTime);
}

window.addEventListener('DOMContentLoaded', () => {
  // First tick happens after 2s — gives YT time to initialise the player.
  setInterval(tick, 2000);
});
