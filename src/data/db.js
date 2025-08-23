/**
 * @file src/data/db.js
 * @description Manages all IndexedDB operations for Snap2Map.
 */

import { projectToEnu } from '../util/coords.js';

const DB_NAME = 'snap2map-db';
const DB_VERSION = 1;

let db = null;

/**
 * Initializes the IndexedDB database and creates the object stores.
 * @returns {Promise<IDBDatabase>} A promise that resolves with the database connection.
 */
export function initDB() {
  return new Promise((resolve, reject) => {
    if (db) {
      return resolve(db);
    }

    console.log('Initializing IndexedDB...');
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = (event) => {
      console.error('Database error:', event.target.error);
      reject('Database error: ' + event.target.error.message);
    };

    request.onsuccess = (event) => {
      db = event.target.result;
      console.log('Database initialized successfully.');
      resolve(db);
    };

    request.onupgradeneeded = (event) => {
      console.log('Database upgrade needed.');
      const tempDb = event.target.result;

      // maps store
      if (!tempDb.objectStoreNames.contains('maps')) {
        console.log('Creating "maps" object store...');
        const mapsStore = tempDb.createObjectStore('maps', { keyPath: 'id' });
        mapsStore.createIndex('createdAt', 'createdAt', { unique: false });
      }

      // pairs store
      if (!tempDb.objectStoreNames.contains('pairs')) {
        console.log('Creating "pairs" object store...');
        const pairsStore = tempDb.createObjectStore('pairs', { keyPath: 'pairId' });
        pairsStore.createIndex('mapId', 'mapId', { unique: false });
      }

      // calibrations store
      if (!tempDb.objectStoreNames.contains('calibrations')) {
        console.log('Creating "calibrations" object store...');
        const calibrationsStore = tempDb.createObjectStore('calibrations', { keyPath: 'calId' });
        calibrationsStore.createIndex('mapId', 'mapId', { unique: false });
      }

      // blobs store
      if (!tempDb.objectStoreNames.contains('blobs')) {
        console.log('Creating "blobs" object store...');
        tempDb.createObjectStore('blobs', { keyPath: 'blobId' });
      }
    };
  });
}

/**
 * Retrieves all map records from the database.
 * @returns {Promise<Array>} A promise that resolves with an array of all map objects.
 */
export function getAllMaps() {
  return new Promise((resolve, reject) => {
    if (!db) return reject("Database not initialized.");

    const transaction = db.transaction(['maps'], 'readonly');
    const store = transaction.objectStore('maps');
    const request = store.getAll();

    request.onsuccess = () => resolve(request.result);
    request.onerror = (e) => reject(e.target.error);
  });
}

/**
 * A generic helper to get all records from a store.
 * @param {string} storeName - The name of the object store.
 * @returns {Promise<Array>}
 */
function getAllFromStore(storeName) {
    return new Promise((resolve, reject) => {
        if (!db) return reject("Database not initialized.");
        const transaction = db.transaction([storeName], 'readonly');
        const store = transaction.objectStore(storeName);
        const request = store.getAll();
        request.onsuccess = () => resolve(request.result);
        request.onerror = (e) => reject(e.target.error);
    });
}

export const getAllPairs = () => getAllFromStore('pairs');
export const getAllCalibrations = () => getAllFromStore('calibrations');

/**
 * A generic helper to put a record into a store (insert or update).
 * @param {string} storeName - The name of the object store.
 * @param {object} record - The record to save.
 * @returns {Promise<void>}
 */
function putRecord(storeName, record) {
    return new Promise((resolve, reject) => {
        if (!db) return reject("Database not initialized.");
        const transaction = db.transaction([storeName], 'readwrite');
        const store = transaction.objectStore(storeName);
        const request = store.put(record);
        request.onsuccess = () => resolve();
        request.onerror = (e) => reject(e.target.error);
    });
}

export const putMap = (map) => putRecord('maps', map);
export const putPair = (pair) => putRecord('pairs', pair);
export const putCalibration = (cal) => putRecord('calibrations', cal);
export const putBlob = (blob) => putRecord('blobs', blob);

/**
 * Retrieves a single blob from the database.
 * @param {string} blobId - The ID of the blob to retrieve.
 * @returns {Promise<object>} A promise that resolves with the blob object.
 */
export function getBlob(blobId) {
    return new Promise((resolve, reject) => {
        if (!db) return reject("Database not initialized.");
        const transaction = db.transaction(['blobs'], 'readonly');
        const store = transaction.objectStore('blobs');
        const request = store.get(blobId);
        request.onsuccess = () => resolve(request.result);
        request.onerror = (e) => reject(e.target.error);
    });
}

/**
 * Retrieves a single map record from the database.
 * @param {string} mapId - The ID of the map to retrieve.
 * @returns {Promise<object>} A promise that resolves with the map object.
 */
function getMap(mapId) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(['maps'], 'readonly');
    const store = transaction.objectStore('maps');
    const request = store.get(mapId);
    request.onsuccess = () => resolve(request.result);
    request.onerror = (e) => reject(e.target.error);
  });
}

/**
 * Retrieves all pairs for a given map.
 * @param {string} mapId - The ID of the map.
 * @returns {Promise<Array>} A promise that resolves with an array of pair objects.
 */
export function getPairsForMap(mapId) {
  return new Promise((resolve, reject) => {
    if (!db) return reject("Database not initialized.");

    const transaction = db.transaction(['pairs'], 'readonly');
    const store = transaction.objectStore('pairs');
    const index = store.index('mapId');
    const request = index.getAll(mapId);

    request.onsuccess = () => resolve(request.result);
    request.onerror = (e) => reject(e.target.error);
  });
}

/**
 * Updates a map record in the database.
 * @param {object} map - The map object to update.
 * @returns {Promise<void>}
 */
function updateMap(map) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(['maps'], 'readwrite');
    const store = transaction.objectStore('maps');
    const request = store.put(map);
    request.onsuccess = () => resolve();
    request.onerror = (e) => reject(e.target.error);
  });
}

/**
 * Saves a new reference pair to the database.
 * @param {string} mapId - The ID of the map this pair belongs to.
 * @param {{pixel: {x,y}, wgs84: {lat,lon}}} pairData - The pair data.
 * @returns {Promise<string>} A promise that resolves with the new pair's ID.
 */
export async function savePair(mapId, pairData) {
  if (!db) throw new Error('Database not initialized.');

  const map = await getMap(mapId);
  if (!map) throw new Error(`Map with ID ${mapId} not found.`);

  if (!map.enuOrigin) {
    map.enuOrigin = pairData.wgs84;
    await updateMap(map);
    console.log(`Set ENU origin for map ${mapId} to`, map.enuOrigin);
  }

  const enu = projectToEnu(pairData.wgs84, map.enuOrigin);

  const newPair = {
    pairId: crypto.randomUUID(),
    mapId: mapId,
    pixel: pairData.pixel,
    wgs84: pairData.wgs84,
    enu: enu,
    active: true,
    residualMeters: null,
    isInlier: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(['pairs'], 'readwrite');
    const store = transaction.objectStore('pairs');
    const request = store.add(newPair);
    request.onsuccess = () => resolve(newPair.pairId);
    request.onerror = (e) => reject(e.target.error);
  });
}

/**
 * Saves a new map and its image blob to the database.
 * @param {{name: string, pixelSize: {w: number, h: number}}} mapData - The map metadata.
 * @param {Blob} imageBlob - The processed image blob.
 * @returns {Promise<string>} A promise that resolves with the new map's ID.
 */
export function saveMap(mapData, imageBlob) {
  return new Promise((resolve, reject) => {
    if (!db) {
      return reject('Database not initialized.');
    }

    const mapId = crypto.randomUUID();
    const blobId = crypto.randomUUID();
    const now = new Date();

    const newMapRecord = {
      id: mapId,
      name: mapData.name || `Map ${now.toLocaleString()}`,
      createdAt: now,
      updatedAt: now,
      pixelSize: mapData.pixelSize,
      photoBlobId: blobId,
      activeCalibrationId: null,
      stats: { rmse: null, maxResidual: null },
      flags: {},
    };

    const blobRecord = {
      blobId: blobId,
      mime: imageBlob.type,
      bytes: imageBlob,
    };

    const transaction = db.transaction(['maps', 'blobs'], 'readwrite');
    const mapsStore = transaction.objectStore('maps');
    const blobsStore = transaction.objectStore('blobs');

    const mapRequest = mapsStore.add(newMapRecord);
    const blobRequest = blobsStore.add(blobRecord);

    transaction.oncomplete = () => {
      console.log(`Map ${mapId} and blob ${blobId} saved successfully.`);
      resolve(mapId);
    };

    transaction.onerror = (event) => {
      console.error('Transaction error while saving map:', event.target.error);
      reject('Transaction error: ' + event.target.error.message);
    };
  });
}
