const storage = chrome.storage?.sync || chrome.storage?.local;

const $ = (s) => document.querySelector(s);
const banInput = $('#ban-input');
const banAdd = $('#ban-add');
const banListEl = $('#ban-list');
const delInput = $('#delete-input');
const delAdd = $('#delete-add');
const delListEl = $('#delete-list');
const importBtn = $('#import');
const exportBtn = $('#export');
const importFile = $('#import-file');
const globalTip = $('#global-tip');

function showTipNear(el, html) {
	globalTip.innerHTML = html;
	const rect = el.getBoundingClientRect();
	const padding = 8;
	const x = Math.min(window.innerWidth - globalTip.offsetWidth - padding, Math.max(padding, rect.right - globalTip.offsetWidth));
	const y = rect.top - (globalTip.offsetHeight + 10);
	globalTip.style.left = `${Math.max(padding, x)}px`;
	globalTip.style.top = `${Math.max(padding, y)}px`;
	globalTip.classList.add('show');
}
function hideTip() { globalTip.classList.remove('show'); }

function sanitize(word) { return (word || '').trim(); }

function normalizeList(list) {
	if (!Array.isArray(list)) return [];
	return list.map(item => {
		if (typeof item === 'string') return { value: item, boundary: true };
		return { value: sanitize(item.value), boundary: item.boundary !== false };
	}).filter(x => !!x.value);
}

async function load() {
	const data = await storage.get({ banKeywords: [], deleteKeywords: [] });
	const ban = normalizeList(data.banKeywords);
	const del = normalizeList(data.deleteKeywords);
	await storage.set({ banKeywords: ban, deleteKeywords: del });
	renderList(banListEl, ban, 'ban');
	renderList(delListEl, del, 'delete');
}

function renderList(container, items, kind) {
	container.innerHTML = '';
	items.forEach((entry, idx) => {
		const li = document.createElement('li');
		const span = document.createElement('span');
		span.className = 'word';
		span.textContent = entry.value;

		const toggle = document.createElement('div');
		toggle.className = 'toggle' + (entry.boundary ? ' on' : '');
		const knob = document.createElement('div');
		knob.className = 'knob';
		toggle.appendChild(knob);

		const tipHtml = '<b>Exact Match</b><br><br><b>ON (Recommended):</b><br>Only flags the exact word.<br><i>e.g., blocks "hell", but not "hello".</i><br><br><b>OFF:</b><br>Flags any message containing the letters.<br><i>e.g., blocks both "hell" and "hello".</i>';
		toggle.addEventListener('mouseenter', () => showTipNear(toggle, tipHtml));
		toggle.addEventListener('mouseleave', hideTip);
		toggle.addEventListener('focus', () => showTipNear(toggle, tipHtml));
		toggle.addEventListener('blur', hideTip);

		toggle.addEventListener('click', async () => {
			const data = await storage.get({ banKeywords: [], deleteKeywords: [] });
			const key = kind === 'ban' ? 'banKeywords' : 'deleteKeywords';
			const arr = normalizeList(data[key]);
			arr[idx] = { ...arr[idx], boundary: !arr[idx].boundary };
			toggle.classList.toggle('on');
			await storage.set({ [key]: arr });
		});

		const removeBtn = document.createElement('button');
		removeBtn.innerHTML = '&times;'; // Use HTML entity for a nicer 'X'
		removeBtn.className = 'remove-btn';
		removeBtn.addEventListener('click', async () => {
			const data = await storage.get({ banKeywords: [], deleteKeywords: [] });
			const key = kind === 'ban' ? 'banKeywords' : 'deleteKeywords';
			const arr = normalizeList(data[key]);
			arr.splice(idx, 1);
			await storage.set({ [key]: arr });
			load();
		});

		const actions = document.createElement('div');
		actions.className = 'actions';
		actions.appendChild(removeBtn);

		li.appendChild(span);
		li.appendChild(toggle);
		li.appendChild(actions);
		container.appendChild(li);
	});
}

async function addWord(kind, value) {
	const word = sanitize(value).toLowerCase();
	if (!word) return;
	const data = await storage.get({ banKeywords: [], deleteKeywords: [] });
	const key = kind === 'ban' ? 'banKeywords' : 'deleteKeywords';
	const arr = normalizeList(data[key]);
	if (!arr.some(x => x.value === word)) arr.push({ value: word, boundary: true });
	await storage.set({ [key]: arr });
	if (kind === 'ban') banInput.value = ''; else delInput.value = '';
	load();
}

banAdd.addEventListener('click', () => addWord('ban', banInput.value));
banInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') addWord('ban', banInput.value); });

delAdd.addEventListener('click', () => addWord('delete', delInput.value));
delInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') addWord('delete', delInput.value); });

exportBtn.addEventListener('click', async () => {
	const data = await storage.get({ banKeywords: [], deleteKeywords: [] });
	const payload = { banKeywords: normalizeList(data.banKeywords), deleteKeywords: normalizeList(data.deleteKeywords) };
	const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
	const url = URL.createObjectURL(blob);
	const a = document.createElement('a');
	a.href = url;
	a.download = 'pumpfun-live-mod-tools.json';
	a.click();
	URL.revokeObjectURL(url);
});

importBtn.addEventListener('click', () => importFile.click());
importFile.addEventListener('change', async () => {
	const file = importFile.files?.[0];
	if (!file) return;
	const text = await file.text();
	try {
		const data = JSON.parse(text);
		const payload = {
			banKeywords: normalizeList(data.banKeywords),
			deleteKeywords: normalizeList(data.deleteKeywords)
		};
		await storage.set(payload);
		load();
	} catch (e) {
		alert('Invalid JSON file.');
	}
});

load();
