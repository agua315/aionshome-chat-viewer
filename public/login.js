'use strict';

document.getElementById('loginForm').addEventListener('submit', async event => {
  event.preventDefault();
  const button = document.getElementById('loginBtn');
  const errorNote = document.getElementById('loginError');
  button.disabled = true; errorNote.hidden = true;
  try {
    const response = await fetch('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: document.getElementById('accessCode').value }), signal: AbortSignal.timeout(10000) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || '无法打开，请重试');
    location.replace('/');
  } catch (error) { errorNote.textContent = error.message; errorNote.hidden = false; }
  finally { button.disabled = false; }
});
