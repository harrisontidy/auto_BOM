const status = document.querySelector('#status');
const form = document.querySelector('#login');
const disconnect = document.querySelector('#disconnect');
function render(data) {form.hidden = data.connected; disconnect.hidden = !data.connected; status.textContent = data.connected ? 'Connected. You can return to KiCad.' : 'Not connected.';}
fetch('/api/snapmagic/status').then(r => r.json()).then(render).catch(() => {status.textContent = 'AutoBOM is unavailable.';});
form.addEventListener('submit', async event => {
  event.preventDefault(); document.querySelector('#connect').disabled = true; status.textContent = 'Connecting…';
  try {
    const response = await fetch('/api/snapmagic/login', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({username:document.querySelector('#username').value,password:document.querySelector('#password').value})});
    document.querySelector('#password').value = '';
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Could not connect.');
    render(data);
  } catch (error) {status.textContent = error.message;}
  finally {document.querySelector('#password').value = ''; document.querySelector('#connect').disabled = false;}
});
disconnect.addEventListener('click', async () => {const response=await fetch('/api/snapmagic/logout',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'}); if(response.ok)render({connected:false});});
