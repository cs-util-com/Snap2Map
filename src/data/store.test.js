import { MapStore } from './store.js';

function createMockStorage() {
  let data = {};
  return {
    getItem: jest.fn((k) => data[k] ?? null),
    setItem: jest.fn((k, v) => { data[k] = v; }),
  };
}

test('adds and retrieves maps', () => {
  const storage = createMockStorage();
  const store = new MapStore(storage);
  expect(store.list()).toEqual([]);
  store.add({ id: '1', name: 'Test' });
  expect(storage.setItem).toHaveBeenCalled();
  expect(store.get('1').name).toBe('Test');
  expect(store.list()).toHaveLength(1);
});
