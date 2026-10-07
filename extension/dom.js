// This function is serialized by Chrome; keep its helpers inside the function.
export function captureDOM() {
  const roots = [document];
  const elements = [];
  for (let i = 0; i < roots.length; i++) {
    for (const element of roots[i].querySelectorAll('*')) {
      elements.push(element);
      if (element.shadowRoot) roots.push(element.shadowRoot);
      if (elements.length >= 20000) break;
    }
    if (elements.length >= 20000) break;
  }
  const semanticQuestion = '[data-question], [data-testid*="question" i], [class*="question" i]';
  const semanticAnswer = '[data-answer], [data-option], [data-testid*="answer" i], [data-testid*="choice" i], [class*="answer" i], [class*="option" i], [class*="choice" i]';
  const controlAnswer = 'button, [role="button"], [role="radio"], [role="option"], label';
  const ignored = /^(?:press anywhere to continue|continue|next|previous|back|submit|settings|close|cancel|menu|help|skip|start|finish)(?:\s|$)/i;
  const textCache = new WeakMap();
  function visible(element) {
    if (element.closest('nav, header, footer, aside, [role="navigation"], [hidden], [aria-hidden="true"], [inert], input, textarea, select, [contenteditable="true"]')) return false;
    for (let ancestor = element; ancestor; ancestor = ancestor.parentElement || ancestor.getRootNode().host) {
      const style = getComputedStyle(ancestor);
      if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0' || ancestor.hidden || ancestor.getAttribute('aria-hidden') === 'true' || ancestor.inert) return false;
    }
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.right > 0 && rect.top < innerHeight && rect.left < innerWidth && style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
  }
  function text(element) {
    // Read text nodes only: never collect input values or hidden descendant text.
    function read(node) {
      if (node.nodeType === Node.TEXT_NODE) return node.textContent;
      if (node.nodeType !== Node.ELEMENT_NODE || !visible(node)) return '';
      if (textCache.has(node)) return textCache.get(node);
      const value = [...node.childNodes].map(read).join('') + (node.shadowRoot ? [...node.shadowRoot.childNodes].map(read).join('') : '');
      const result = /^(block|flex|grid|table|list-item)/.test(getComputedStyle(node).display) ? ` ${value} ` : value;
      textCache.set(node, result);
      return result;
    }
    return read(element).replace(/\s+/g, ' ').trim();
  }
  const candidates = elements.filter(visible).map(element => ({ element, text: text(element), rect: element.getBoundingClientRect() })).filter(item => item.text);
  function leaves(items) {
    return items.filter(item => !items.some(other => other !== item && item.element.contains(other.element)));
  }
  function readingOrder(items) {
    const sorted = [...items].sort((a, b) => a.rect.top - b.rect.top || a.rect.left - b.rect.left);
    const rows = [];
    for (const item of sorted) {
      let row = rows.find(row => Math.abs(row.top - item.rect.top) < Math.min(row.height, item.rect.height) / 2);
      if (!row) { row = { top: item.rect.top, height: item.rect.height, items: [] }; rows.push(row); }
      row.items.push(item);
    }
    return rows.flatMap(row => row.items.sort((a, b) => a.rect.left - b.rect.left));
  }
  const questionGroups = [
    leaves(candidates.filter(item => item.element.matches(semanticQuestion) && !item.element.matches(semanticAnswer))),
    leaves(candidates.filter(item => item.element.matches('h1, h2, h3, legend, [role="heading"]'))),
    leaves(candidates.filter(item => /\?|^\d+(?:\.\d+)?\s*[x×*+÷/−-]\s*\d+(?:\.\d+)?\s*=?$/i.test(item.text) && !item.element.matches(`${semanticAnswer}, ${controlAnswer}`)))
  ];
  for (const group of questionGroups) {
    for (const question of readingOrder(group)) {
      if (question.text.length > 2000 || ignored.test(question.text)) continue;
      for (const selector of [semanticAnswer, controlAnswer]) {
        let answers = leaves(candidates.filter(item => item.element.matches(selector) && item.element !== question.element && !item.element.contains(question.element) && !question.element.contains(item.element) && item.rect.top >= question.rect.bottom - 8 && item.text.length <= 500 && !ignored.test(item.text)));
        answers = readingOrder(answers);
        const texts = answers.map(item => item.text);
        if (texts.length >= 2 && texts.length <= 8 && new Set(texts).size === texts.length) {
          return { question: question.text, options: texts, raw_text: [question.text, ...texts].join('\n') };
        }
      }
    }
  }
  return { question: '', options: [], raw_text: '', error: 'Could not identify a complete question and answers in visible page elements. Enter them below, or use Image mode for images, canvas, or embedded frames.' };
}
