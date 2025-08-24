import { renderMapManager } from './ui/map-manager.js';

document.addEventListener('DOMContentLoaded', () => {
  const app = document.getElementById('app');
  if (app) renderMapManager(app);
});
