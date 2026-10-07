export function parseOptions(text) {
  return text.split('\n').map(value => value.trim()).filter(Boolean);
}

export function validateInput(question, options) {
  if (!question.trim() || question.length > 2000) throw new Error('Enter a question of 1 to 2000 characters.');
  if (options.length < 2 || options.length > 8) throw new Error('Enter 2 to 8 options, one per line.');
  if (options.some(value => !value || value.length > 500)) throw new Error('Each option must contain 1 to 500 characters.');
  if (new Set(options.map(value => value.toLowerCase())).size !== options.length) throw new Error('Answer options must be distinct.');
}

export async function request(path, payload, token, fetcher = fetch) {
  if (!token.trim()) throw new Error('Paste the service token into settings first.');
  let response;
  try {
    response = await fetcher(`http://127.0.0.1:8765${path}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token.trim()}` },
      body: JSON.stringify(payload), signal: AbortSignal.timeout(600000)
    });
  } catch (error) {
    throw new Error(error.name === 'TimeoutError' ? 'Processing timed out. Check the service terminal and try again.' :
      'Cannot reach the local service. Start it, then try again.');
  }
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Local processing failed.');
  return result;
}

export function renderAnswers(container, rows, chosenIndex = rows[0]?.index) {
  container.replaceChildren();
  for (const answer of rows) {
    const item = document.createElement('li');
    const label = document.createElement('span');
    if (answer.index === chosenIndex) item.classList.add('chosen-answer');
    label.textContent = `${String.fromCharCode(65 + answer.index)}. ${answer.text}`;
    const percentage = document.createElement('strong');
    percentage.textContent = `${(answer.probability * 100).toFixed(1)}%`;
    const bar = document.createElement('progress');
    bar.max = 1; bar.value = answer.probability;
    bar.setAttribute('aria-label', `${answer.text}: ${percentage.textContent}`);
    item.append(label, percentage, bar);
    if (answer.index === chosenIndex) {
      const badge = document.createElement('span');
      badge.className = 'choice-label';
      badge.textContent = 'Chosen answer';
      item.prepend(badge);
    }
    container.append(item);
  }
}
