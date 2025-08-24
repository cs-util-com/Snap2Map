import { mapStore } from '../data/store.js';

export function renderMapManager(container, { store = mapStore, onOpen } = {}) {
  container.innerHTML = '';
  const list = document.createElement('ul');
  store.list().forEach((m) => {
    const li = document.createElement('li');
    const btn = document.createElement('button');
    btn.textContent = m.name;
    btn.className = 'map-item underline text-blue-600';
    btn.addEventListener('click', () => {
      if (onOpen) onOpen(m.id);
      else window.location.href = `pages/map.html?id=${m.id}`;
    });
    li.appendChild(btn);
    list.appendChild(li);
  });
  container.appendChild(list);

  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  input.className = 'hidden';
  container.appendChild(input);

  const addBtn = document.createElement('button');
  addBtn.textContent = 'Import photo';
  addBtn.className = 'add-map mt-4 px-4 py-2 bg-blue-500 text-white rounded';
  addBtn.addEventListener('click', () => input.click());
  container.appendChild(addBtn);

  input.addEventListener('change', () => {
    const file = input.files[0];
    if (!file) return;
    const id = Date.now().toString();
    const url = URL.createObjectURL(file);
    store.add({ id, name: file.name, url });
    renderMapManager(container, { store, onOpen });
  });
}
