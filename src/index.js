/**
 * @file src/index.js
 * @description Main application entry point for Snap2Map.
 */

import { initializeMap, updateUserPosition } from './leaflet/map.js';
import { initializeUI, showMapManager } from './ui/ui.js';
import { initDB, getAllMaps } from './data/db.js';
import { startWatchingPosition } from './gps/gps.js';
import { CalibrationModel } from './calib/model.js';

/**
 * The main function to run the application.
 */
async function main() {
  console.log("DOM fully loaded. Initializing Snap2Map application...");

  // --- Initialization ---
  await initDB();
  const map = initializeMap('map');
  const model = new CalibrationModel();
  initializeUI(map, model);

  if (!map) {
    console.error("Main: Map initialization failed. Application cannot start.");
    return;
  }

  // Show the map manager, which will either be empty or list existing maps.
  const maps = await getAllMaps();
  showMapManager(maps, map);

  // --- Core Application Logic ---
  // This part will now be triggered by loading a map or creating a new one.

  // The dummy data and live position logic will be moved into the `loadAndDisplayMap` flow.
  // For now, the app will just start and show the map manager.
}

// Wait for the DOM to be fully loaded before running the main script
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', main);
} else {
  main();
}

// --- PWA Service Worker Registration ---
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').then(registration => {
      console.log('Service Worker registered with scope:', registration.scope);
    }).catch(error => {
      console.error('Service Worker registration failed:', error);
    });
  });
}
