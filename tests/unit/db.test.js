/* eslint-env jest */
const db = require('../../src/data/db.js');

describe('data/db basic error cases', () => {
  test('getAllMaps rejects when DB not initialized', async () => {
    await expect(db.getAllMaps()).rejects.toMatch("Database not initialized.");
  });

  test('getAllPairs rejects when DB not initialized', async () => {
    await expect(db.getAllPairs()).rejects.toMatch("Database not initialized.");
  });

  test('getBlob rejects when DB not initialized', async () => {
    await expect(db.getBlob('nope')).rejects.toMatch("Database not initialized.");
  });

  test('savePair throws when DB not initialized', async () => {
    await expect(db.savePair('map1', { pixel: { x: 0, y: 0 }, wgs84: { lat: 0, lon: 0 } })).rejects.toThrow('Database not initialized.');
  });
});
