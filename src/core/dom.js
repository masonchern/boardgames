/**
 * Tiny hyperscript helper: el('div', { class: 'x', onclick }, child1, 'text', ...)
 */
export function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props ?? {})) {
    if (value == null || value === false) continue;
    if (key.startsWith('on') && typeof value === 'function') {
      node.addEventListener(key.slice(2).toLowerCase(), value);
    } else if (key === 'class') {
      node.className = value;
    } else if (key === 'style' && typeof value === 'object') {
      for (const [k, v] of Object.entries(value)) node.style.setProperty(k, v);
    } else if (key === 'html') {
      node.innerHTML = value;
    } else {
      node.setAttribute(key, value === true ? '' : value);
    }
  }
  for (const child of children.flat()) {
    if (child == null || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}
