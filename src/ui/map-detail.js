import { mapStore } from '../data/store.js';

export function renderMapDetail(container, id, { store = mapStore } = {}) {
  container.innerHTML = '';
  const data = store.get(id);
  if (!data) {
    container.textContent = 'Map not found';
    return;
  }

  const tabs = document.createElement('div');
  const photoBtn = document.createElement('button');
  const osmBtn = document.createElement('button');
  photoBtn.textContent = 'Photo';
  osmBtn.textContent = 'OSM';
  tabs.append(photoBtn, osmBtn);
  container.appendChild(tabs);

  const mapDiv = document.createElement('div');
  mapDiv.style.height = '400px';
  container.appendChild(mapDiv);

  const { L } = window;
  const map = L.map(mapDiv, { crs: L.CRS.Simple, zoomControl: false });
  const bounds = [[0, 0], [data.height || 1000, data.width || 1000]];
  const photoLayer = L.imageOverlay(data.url, bounds).addTo(map);
  const osmLayer = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; OpenStreetMap contributors'
  });
  map.fitBounds(bounds);

  photoBtn.addEventListener('click', () => {
    map.addLayer(photoLayer);
    map.removeLayer(osmLayer);
  });
  osmBtn.addEventListener('click', () => {
    map.addLayer(osmLayer);
    map.removeLayer(photoLayer);
  });
}
