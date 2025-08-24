jest.mock('./ui/map-manager.js', () => ({ renderMapManager: jest.fn() }));
import { renderMapManager } from './ui/map-manager.js';

test('renders map manager on DOMContentLoaded', () => {
  document.body.innerHTML = '<div id="app"></div>';
  require('./index.js');
  document.dispatchEvent(new Event('DOMContentLoaded'));
  expect(renderMapManager).toHaveBeenCalledWith(document.getElementById('app'));
});
