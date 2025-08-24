import { createPairMode } from './pair-mode.js';

test('creates status bar and buttons', () => {
  const container = document.createElement('div');
  const ui = createPairMode(container, 3, 1);
  expect(ui.bar.textContent).toContain('Pair #3');
  expect(container.querySelectorAll('button')).toHaveLength(2);
});
