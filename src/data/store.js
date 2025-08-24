const STORAGE_KEY = 'snap2map:maps';

export class MapStore {
  constructor(storage = window.localStorage) {
    this.storage = storage;
  }

  list() {
    const raw = this.storage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  }

  get(id) {
    return this.list().find(m => m.id === id) || null;
  }

  add(map) {
    const list = this.list();
    list.push(map);
    this.storage.setItem(STORAGE_KEY, JSON.stringify(list));
    return map;
  }
}

export const mapStore = new MapStore();
