/**
 * @file src/util/bundle.js
 * @description Handles exporting and importing map data as .mapbundle files.
 */

import { getAllMaps, getAllPairs, getAllCalibrations, getBlob, putMap, putPair, putCalibration, putBlob } from '../data/db.js';

/**
 * Triggers a browser download for a given blob.
 * @param {Blob} blob - The blob to download.
 * @param {string} filename - The desired filename.
 */
function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Exports all user data into a single .mapbundle file.
 */
export async function exportAllData() {
  if (!window.JSZip) {
    alert("JSZip library not found. Export failed.");
    return;
  }

  console.log("Starting export process...");
  try {
    const zip = new JSZip();

    // 1. Get all data from IndexedDB
    const maps = await getAllMaps();
    const allPairs = await getAllPairs();
    const allCalibrations = await getAllCalibrations();

    const metaData = {
      version: 1,
      createdAt: new Date().toISOString(),
      maps,
      pairs: allPairs,
      calibrations: allCalibrations,
    };

    // 2. Add metadata to the zip
    zip.file("meta.json", JSON.stringify(metaData, null, 2));

    // 3. Add all blobs to the zip
    const blobFolder = zip.folder("blobs");
    for (const map of maps) {
      const blobData = await getBlob(map.photoBlobId);
      if (blobData) {
        blobFolder.file(map.photoBlobId, blobData.bytes);
      }
    }

    // 4. Generate the zip file and trigger download
    const zipBlob = await zip.generateAsync({
      type: "blob",
      compression: "DEFLATE",
      compressionOptions: { level: 9 },
    });

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    triggerDownload(zipBlob, `snap2map-backup-${timestamp}.mapbundle`);

    console.log("Export successful.");

  } catch (error) {
    console.error("Export failed:", error);
    alert("An error occurred during the export process. See console for details.");
  }
}

/**
 * Imports a .mapbundle file and saves its contents to the database.
 * @param {File} file - The .mapbundle file to import.
 */
export async function importData(file) {
    if (!window.JSZip) return alert("JSZip library not found.");
    if (!file.name.endsWith('.mapbundle')) return alert("Invalid file type. Please select a .mapbundle file.");

    console.log("Starting import process...");
    try {
        const zip = await JSZip.loadAsync(file);

        const metaFile = zip.file("meta.json");
        if (!metaFile) throw new Error("meta.json not found in bundle.");
        const metaData = JSON.parse(await metaFile.async("string"));

        console.log(`Importing ${metaData.maps.length} maps, ${metaData.pairs.length} pairs...`);

        for (const map of metaData.maps) {
            await putMap(map);
        }
        for (const pair of metaData.pairs) {
            await putPair(pair);
        }
        for (const cal of metaData.calibrations) {
            await putCalibration(cal);
        }

        const blobFolder = zip.folder("blobs");
        if (blobFolder) {
            const blobPromises = [];
            blobFolder.forEach((relativePath, zipEntry) => {
                const promise = zipEntry.async("blob").then(blobContent => {
                    return putBlob({ blobId: zipEntry.name, bytes: blobContent });
                });
                blobPromises.push(promise);
            });
            await Promise.all(blobPromises);
        }

        alert("Import successful! The page will now reload.");
        window.location.reload();

    } catch (error) {
        console.error("Import failed:", error);
        alert(`Import failed: ${error.message}`);
    }
}
