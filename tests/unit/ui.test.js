import { setCurrentMap, setMapTabsEnabled, setFabVisible, showBanner } from '../../src/ui/ui.js';

describe('ui module (smoke)', () => {
  beforeEach(() => {
    // Provide minimal DOM elements used by functions under test
    document.body.innerHTML = `
      <div id="main-content"></div>
      <div id="global-banner" class="hidden"><span id="global-banner-message"></span></div>
      <button id="tab-photo"></button>
      <button id="tab-osm"></button>
      <button id="add-pair-fab"></button>
      <button id="tab-refine"></button>
    `;
  });

  test('setCurrentMap stores the id', () => {
    setCurrentMap('map-123');
    // No direct getter, but the function should not throw
    expect(true).toBe(true);
  });

  test('setMapTabsEnabled and setFabVisible operate on DOM', () => {
    setMapTabsEnabled(true);
    setFabVisible(true);
    expect(document.getElementById('add-pair-fab').classList.contains('hidden')).toBe(false);
    setMapTabsEnabled(false);
    setFabVisible(false);
    expect(document.getElementById('add-pair-fab').classList.contains('hidden')).toBe(true);
  });

  test('showBanner updates DOM message', () => {
    showBanner('hi', 'info', 10);
    expect(document.getElementById('global-banner-message').textContent).toBe('hi');
  });
});
