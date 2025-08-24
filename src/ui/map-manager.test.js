import { renderMapManager } from './map-manager.js';

test('renders maps and handles selection', () => {
  const container = document.createElement('div');
  const store = { list: () => [{ id: '1', name: 'One' }], add: jest.fn() };
  const onOpen = jest.fn();
  renderMapManager(container, { store, onOpen });
  const btn = container.querySelector('.map-item');
  btn.click();
  expect(onOpen).toHaveBeenCalledWith('1');
});

test('adds map via file input', () => {
  const container = document.createElement('div');
  const store = { list: () => [], add: jest.fn() };
  renderMapManager(container, { store });
  const input = container.querySelector('input[type="file"]');
  const file = new File(['data'], 'test.jpg', { type: 'image/jpeg' });
  global.URL.createObjectURL = jest.fn(() => 'blob:url');
  Object.defineProperty(input, 'files', { value: [file] });
  input.dispatchEvent(new Event('change'));
  expect(store.add).toHaveBeenCalledWith(expect.objectContaining({ name: 'test.jpg', url: 'blob:url' }));
});
