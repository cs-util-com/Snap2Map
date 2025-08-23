/**
 * @file src/util/image.js
 * @description Handles image processing: EXIF parsing, orientation correction, and resizing.
 */

import { displayImageOnMap } from '../leaflet/map.js';
import { hideMapManagerEmptyState, setMapTabsEnabled, setFabVisible, setCurrentMap } from '../ui/ui.js';
import { saveMap } from '../data/db.js';

const MAX_IMAGE_DIMENSION = 4096; // Max width or height for the processed image

/**
 * Processes a user-selected image file and displays it on the map.
 * @param {File} file - The image file to process.
 * @param {L.Map} map - The Leaflet map instance.
 */
export async function processAndDisplayImage(file, map) {
  if (!file.type.startsWith('image/')) {
    console.error('Selected file is not an image.', file);
    // TODO: Show a user-facing error message
    return;
  }

  console.log('Starting image processing...');

  try {
    // 1. Read EXIF data to get orientation
    const tags = await ExifReader.load(file);
    const orientation = tags.Orientation?.value || 1;
    console.log('Image orientation from EXIF:', orientation);

    // 2. Load image onto a canvas to correct orientation and resize
    const imageBitmap = await createImageBitmap(file);
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');

    let { width, height } = imageBitmap;

    // Adjust dimensions based on orientation
    if (orientation >= 5 && orientation <= 8) {
      [width, height] = [height, width]; // Swap dimensions for rotated images
    }

    // Calculate new dimensions, respecting the max size
    const scaleFactor = Math.min(MAX_IMAGE_DIMENSION / width, MAX_IMAGE_DIMENSION / height, 1);
    const newWidth = width * scaleFactor;
    const newHeight = height * scaleFactor;

    canvas.width = newWidth;
    canvas.height = newHeight;

    // Apply EXIF orientation transformation
    // See: https://developer.mozilla.org/en-US/docs/Web/API/CanvasRenderingContext2D/transform
    switch (orientation) {
      case 2: ctx.transform(-1, 0, 0, 1, newWidth, 0); break;
      case 3: ctx.transform(-1, 0, 0, -1, newWidth, newHeight); break;
      case 4: ctx.transform(1, 0, 0, -1, 0, newHeight); break;
      case 5: ctx.transform(0, 1, 1, 0, 0, 0); break;
      case 6: ctx.transform(0, 1, -1, 0, newHeight, 0); break;
      case 7: ctx.transform(0, -1, -1, 0, newHeight, newWidth); break;
      case 8: ctx.transform(0, -1, 1, 0, 0, newWidth); break;
      default: break; // case 1, no transform needed
    }

    ctx.drawImage(imageBitmap, 0, 0, imageBitmap.width, imageBitmap.height);

    // 3. Get the processed image as a WebP Blob
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/webp', 0.9));
    const imageUrl = URL.createObjectURL(blob);
    console.log(`Processed image created. Size: ${Math.round(blob.size / 1024)} KB`);

    // 4. Display the image on the map
    displayImageOnMap(map, imageUrl, { width: newWidth, height: newHeight });

    // 5. Save the new map to the database
    const mapData = {
      name: file.name.replace(/\.[^/.]+$/, ""), // Use filename as default name
      pixelSize: { w: newWidth, h: newHeight },
    };
    const newMapId = await saveMap(mapData, blob);
    console.log(`New map saved with ID: ${newMapId}`);

    // 6. Update the UI
    hideMapManagerEmptyState();
    setMapTabsEnabled(true);
    setFabVisible(true);
    setCurrentMap(newMapId);

  } catch (error) {
    console.error('Error during image processing:', error);
    // TODO: Show a user-facing error message.
  }
}
