/* eslint-env jest */
const ui = require('../../src/ui/ui.js');

describe('UI banner behavior', () => {
  test('showBanner is no-op when elements missing', () => {
    // Ensure DOM has no banner elements
    document.body.innerHTML = '';
    expect(() => ui.showBanner('hello')).not.toThrow();
  });

  test('showBanner updates banner when elements exist', () => {
    document.body.innerHTML = '<div id="global-banner" class="hidden"><span id="global-banner-message"></span></div>';
    ui.showBanner('test message', 'info', 10);
    const banner = document.getElementById('global-banner');
    const message = document.getElementById('global-banner-message');
    expect(message.textContent).toBe('test message');
    // cleanup
    banner.remove();
  });
});
