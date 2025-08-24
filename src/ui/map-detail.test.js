import { renderMapDetail } from './map-detail.js';

test('initializes Leaflet map and toggles layers', () => {
  const container = document.createElement('div');
  const store = { get: () => ({ id: '1', url: 'img.png', width: 1000, height: 500 }) };
  const addLayer = jest.fn();
  const removeLayer = jest.fn();
  const photoLayer = { addTo: jest.fn().mockReturnThis(), remove: jest.fn() };
  const osmLayer = { addTo: jest.fn().mockReturnThis(), remove: jest.fn() };
  window.L = {
    CRS: { Simple: {} },
    map: jest.fn().mockReturnValue({ addLayer, removeLayer, fitBounds: jest.fn() }),
    imageOverlay: jest.fn().mockReturnValue(photoLayer),
    tileLayer: jest.fn().mockReturnValue(osmLayer),
  };

  renderMapDetail(container, '1', { store });
  expect(window.L.map).toHaveBeenCalled();
  const [photoBtn, osmBtn] = container.querySelectorAll('button');
  osmBtn.click();
  expect(addLayer).toHaveBeenCalledWith(osmLayer);
  expect(removeLayer).toHaveBeenCalledWith(photoLayer);
  photoBtn.click();
  expect(addLayer).toHaveBeenCalledWith(photoLayer);
  expect(removeLayer).toHaveBeenCalledWith(osmLayer);
});
