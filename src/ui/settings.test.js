import { renderSettings } from './settings.js';

test('renders settings content', () => {
  const container = document.createElement('div');
  renderSettings(container);
  expect(container.textContent).toContain('Settings');
});
