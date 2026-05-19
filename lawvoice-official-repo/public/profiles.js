async function loadProfiles() {
  const res = await fetch('/api/profiles');
  const profiles = (await res.json()).sort((a, b) => (a.name || '').localeCompare(b.name || '', 'ru'));
  const list = document.getElementById('profile-list');
  list.innerHTML = '';
  profiles.forEach(p => {
    const li = document.createElement('li');
    li.innerHTML = `<div>${p.name}</div><small>${p.voice || 'ash'} · ${p.mood || 'neutral'}</small>`;
    li.className = 'profile-item';
    li.addEventListener('click', () => selectProfile(p));
    list.appendChild(li);
  });
}

function selectProfile(p) {
  document.getElementById('profile-id').value = p.id;
  document.getElementById('profile-name').value = p.name || '';
  document.getElementById('profile-voice').value = p.voice || '';
  document.getElementById('profile-mood').value = p.mood || '';
  document.getElementById('profile-rules').value = p.rules || '';
  document.getElementById('profile-instructions').value = p.instructions || '';
}

async function saveProfile(e) {
  e.preventDefault();
  const id = document.getElementById('profile-id').value;
  const payload = {
    name: document.getElementById('profile-name').value,
    voice: document.getElementById('profile-voice').value,
    mood: document.getElementById('profile-mood').value,
    rules: document.getElementById('profile-rules').value,
    instructions: document.getElementById('profile-instructions').value
  };
  const opts = {
    method: id ? 'PUT' : 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  };
  const url = id ? `/api/profiles/${id}` : '/api/profiles';
  await fetch(url, opts);
  await loadProfiles();
  document.getElementById('profile-form').reset();
  document.getElementById('profile-id').value = '';
}

function newProfile() {
  document.getElementById('profile-form').reset();
  document.getElementById('profile-id').value = '';
}

document.getElementById('profile-form').addEventListener('submit', saveProfile);
document.getElementById('new-profile').addEventListener('click', newProfile);

loadProfiles();
