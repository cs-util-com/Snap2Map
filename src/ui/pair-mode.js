export function createPairMode(container, pairNumber, step) {
  const bar = document.createElement('div');
  bar.className = 'status-bar bg-amber-200 p-2';
  bar.textContent = `Pair #${pairNumber} – Step ${step}/2`;
  const confirm = document.createElement('button');
  confirm.textContent = '✓';
  const cancel = document.createElement('button');
  cancel.textContent = '←';
  container.append(bar, confirm, cancel);
  return { bar, confirm, cancel };
}
