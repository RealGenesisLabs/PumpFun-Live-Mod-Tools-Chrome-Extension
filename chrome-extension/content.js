// This script will contain the logic for monitoring and deleting chat messages.
console.log("Pump.fun Live Mod Tools content loaded.");

// Defaults; will be overridden by storage
let banKeywords = [{ value: "spam", boundary: true }, { value: "scam", boundary: true }];
let deleteKeywords = [{ value: "dogs", boundary: true }];

const storage = chrome.storage?.sync || chrome.storage?.local;

function normalizeList(list) {
	if (!Array.isArray(list)) return [];
	return list.map(item => {
		if (typeof item === 'string') return { value: item.toLowerCase(), boundary: true };
		return { value: String(item.value || '').toLowerCase(), boundary: item.boundary !== false };
	}).filter(x => x.value);
}

function compileRules(list) {
	return list.map(({ value, boundary }) => {
		const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
		const pattern = boundary ? `(^|[^a-zA-Z0-9_])(${escaped})(?![a-zA-Z0-9_])` : escaped;
		return { value, boundary, regex: new RegExp(pattern, 'i') };
	});
}

let compiledBanRules = compileRules(banKeywords);
let compiledDeleteRules = compileRules(deleteKeywords);

async function syncKeywordsFromStorage() {
	try {
		const data = await storage.get({ banKeywords, deleteKeywords });
		banKeywords = normalizeList(data.banKeywords);
		deleteKeywords = normalizeList(data.deleteKeywords);
		compiledBanRules = compileRules(banKeywords);
		compiledDeleteRules = compileRules(deleteKeywords);
		console.log('Synced keywords from storage', { banKeywords, deleteKeywords });
	} catch (e) {
		console.error('Failed to sync keywords from storage', e);
	}
}

syncKeywordsFromStorage();
if (chrome.storage?.onChanged) {
	chrome.storage.onChanged.addListener((changes, area) => {
		if (area !== 'sync' && area !== 'local') return;
		let updated = false;
		if (changes.banKeywords) { banKeywords = normalizeList(changes.banKeywords.newValue); compiledBanRules = compileRules(banKeywords); updated = true; }
		if (changes.deleteKeywords) { deleteKeywords = normalizeList(changes.deleteKeywords.newValue); compiledDeleteRules = compileRules(deleteKeywords); updated = true; }
		if (updated) console.log('Updated keywords via storage change', { banKeywords, deleteKeywords });
	});
}

// Track messages we've already acted on and process them serially to avoid race conditions
const processedMessageIds = new Set();
const moderationQueue = [];
let isProcessingQueue = false;

function seedExistingMessages(container) {
	const existing = container.querySelectorAll('[data-message-id]');
	let seeded = 0;
	existing.forEach(el => {
		const id = el.getAttribute('data-message-id');
		if (id && !processedMessageIds.has(id)) {
			processedMessageIds.add(id);
			seeded++;
		}
	});
	console.log(`Seeded ${seeded} existing messages as processed (fresh-only mode).`);
}

async function processQueue() {
	if (isProcessingQueue) return;
	isProcessingQueue = true;
	while (moderationQueue.length > 0) {
		const next = moderationQueue.shift();
		if (!next || !next.element || !next.element.isConnected) continue;
		try {
			if (next.action === 'ban') {
				await banUser(next.element);
			} else {
				await deleteMessage(next.element);
			}
			// brief gap to let UI settle between actions
			await new Promise(r => setTimeout(r, 150));
		} catch (err) {
			console.error("Error during queued moderation:", err);
		}
	}
	isProcessingQueue = false;
}

function enqueueAction(messageElement, action /* 'delete' | 'ban' */) {
	const id = messageElement.getAttribute('data-message-id');
	if (!id) return;
	if (processedMessageIds.has(id)) return;
	processedMessageIds.add(id);
	moderationQueue.push({ element: messageElement, action });
	processQueue();
}

function simulateRealPointerClick(element) {
	const rect = element.getBoundingClientRect();
	const clientX = Math.floor(rect.left + rect.width / 2);
	const clientY = Math.floor(rect.top + rect.height / 2);

	element.focus();

	const pointerDown = new PointerEvent('pointerdown', {
		bubbles: true,
		cancelable: true,
		pointerId: 1,
		pointerType: 'mouse',
		isPrimary: true,
		button: 0,
		buttons: 1,
		clientX,
		clientY
	});
	const mouseDown = new MouseEvent('mousedown', {
		bubbles: true,
		cancelable: true,
		button: 0,
		buttons: 1,
		clientX,
		clientY
	});
	const pointerUp = new PointerEvent('pointerup', {
		bubbles: true,
		cancelable: true,
		pointerId: 1,
		pointerType: 'mouse',
		isPrimary: true,
		button: 0,
		buttons: 0,
		clientX,
		clientY
	});
	const mouseUp = new MouseEvent('mouseup', {
		bubbles: true,
		cancelable: true,
		button: 0,
		buttons: 0,
		clientX,
		clientY
	});
	const click = new MouseEvent('click', {
		bubbles: true,
		cancelable: true,
		button: 0,
		clientX,
		clientY
	});

	element.dispatchEvent(pointerDown);
	element.dispatchEvent(mouseDown);
	element.dispatchEvent(pointerUp);
	element.dispatchEvent(mouseUp);
	element.dispatchEvent(click);
}

function waitForElements(selector, timeout = 4000, root = document) {
	return new Promise((resolve, reject) => {
		const intervalTime = 100;
		let elapsedTime = 0;
		console.log(`Waiting for selector "${selector}"...`);
		const interval = setInterval(() => {
			const elements = (root || document).querySelectorAll(selector);
			if (elements.length > 0) {
				console.log(`Found ${elements.length} element(s) for selector "${selector}"`);
				clearInterval(interval);
				resolve(elements);
			} else {
				elapsedTime += intervalTime;
				if (elapsedTime >= timeout) {
					console.log(`Timeout waiting for selector "${selector}"`);
					clearInterval(interval);
					reject(new Error(`Elements with selector "${selector}" not found within ${timeout}ms`));
				}
			}
		}, intervalTime);
	});
}

async function openModerationMenuAndGetRoot(messageElement) {
	const moderationButton = messageElement.querySelector('button[aria-label="Moderation actions"]');
	if (!moderationButton) throw new Error('Moderation button not found');

	console.log("Found moderation button, clicking it.");
	const beforeExpanded = moderationButton.getAttribute('aria-expanded');
	console.log("aria-expanded before:", beforeExpanded);
	try { moderationButton.scrollIntoView({ block: 'center', inline: 'nearest' }); } catch (_) {}
	simulateRealPointerClick(moderationButton);
	await new Promise(r => setTimeout(r, 50));
	const afterExpanded = moderationButton.getAttribute('aria-expanded');
	console.log("aria-expanded after:", afterExpanded);

	let menuRoot = null;
	const controlsId = moderationButton.getAttribute('aria-controls');
	if (controlsId) menuRoot = document.getElementById(controlsId);
	if (!menuRoot) {
		const menuRoots = await waitForElements('[data-radix-dropdown-menu-content][data-state="open"], [role="menu"][data-state="open"]');
		menuRoot = menuRoots[0];
	}
	return { moderationButton, menuRoot };
}

async function deleteMessage(messageElement) {
	console.log("Attempting to delete message:", messageElement);
	if (!messageElement.isConnected) {
		console.log("Message element no longer in DOM; skipping.");
		return;
	}
	let menuRoot;
	try {
		({ menuRoot } = await openModerationMenuAndGetRoot(messageElement));
	} catch (err) {
		console.error(err);
		return;
	}

	try {
		const menuItems = await waitForElements('[role="menuitem"]', 4000, menuRoot);
		console.log("Found menu items:", menuItems);
		let deleteButton = null;
		for (const item of menuItems) {
			if (item.textContent.trim().toLowerCase() === "delete message") { deleteButton = item; break; }
		}
		if (deleteButton) {
			console.log("Found delete button, clicking it.");
			simulateRealPointerClick(deleteButton);
			console.log("Message deleted.");
		} else {
			console.log("Delete button not found in menu.");
		}
	} catch (error) {
		console.error(error.message);
	}
}

async function banUser(messageElement) {
	console.log("Attempting to ban user for message:", messageElement);
	if (!messageElement.isConnected) {
		console.log("Message element no longer in DOM; skipping.");
		return;
	}
	let menuRoot;
	try {
		({ menuRoot } = await openModerationMenuAndGetRoot(messageElement));
	} catch (err) {
		console.error(err);
		return;
	}

	try {
		// Click "Ban user" in first menu
		const firstMenuItems = await waitForElements('[role="menuitem"]', 4000, menuRoot);
		let banItem = null;
		for (const item of firstMenuItems) {
			if (item.textContent.trim().toLowerCase() === "ban user") { banItem = item; break; }
		}
		if (!banItem) { console.log('Ban user item not found.'); return; }
		const banControlsId = banItem.getAttribute('aria-controls');
		simulateRealPointerClick(banItem);

		// Wait for the nested submenu
		let nestedRoot = null;
		if (banControlsId) nestedRoot = document.getElementById(banControlsId);
		if (!nestedRoot) {
			const nestedRoots = await waitForElements('[data-radix-menu-content][data-state="open"], [role="menu"][data-state="open"]');
			nestedRoot = nestedRoots[0];
		}

		const reasonItems = await waitForElements('[role="menuitem"]', 4000, nestedRoot);
		let spamItem = null;
		for (const item of reasonItems) {
			if (item.textContent.trim().toLowerCase() === "spam") { spamItem = item; break; }
		}
		if (!spamItem) { console.log('Spam reason item not found.'); return; }

		console.log('Selecting ban reason: Spam');
		simulateRealPointerClick(spamItem);
		console.log('Ban action executed with reason: Spam');
	} catch (error) {
		console.error('Ban flow error:', error.message);
	}
}

function determineActionForMessage(textLower) {
	for (const rule of compiledBanRules) {
		if (rule.regex.test(textLower)) return 'ban';
	}
	for (const rule of compiledDeleteRules) {
		if (rule.regex.test(textLower)) return 'delete';
	}
	return null;
}

function handleMessage(messageElement) {
	console.log("Handling message:", messageElement);
	const messageTextElement = messageElement.querySelector('p');
	if (messageTextElement) {
		const messageText = messageTextElement.textContent; // Use original casing for regex
		const action = determineActionForMessage(messageText);
		if (action) {
			console.log(`Matched action "${action}" for message:`, messageText);
			enqueueAction(messageElement, action);
		}
	}
}

const observer = new MutationObserver((mutationsList, observer) => {
	console.log("Mutation observer triggered.");
	for (const mutation of mutationsList) {
		if (mutation.type === 'childList') {
			for (const node of mutation.addedNodes) {
				if (node.nodeType === 1 && node.getAttribute('data-message-id')) {
					console.log("New message node detected:", node);
					handleMessage(node);
				}

				if (node.querySelectorAll) {
					const messages = node.querySelectorAll('[data-message-id]');
					if (messages.length > 0) {
						console.log("Found nested messages:", messages);
						messages.forEach(handleMessage);
					}
				}
			}
		}
	}
});

console.log("Setting up interval to find chat container.");
const interval = setInterval(() => {
	const chatContainer = document.querySelector('.overflow-y-auto');
	if (chatContainer) {
		console.log("Chat container found, starting observer.");
		// Seed existing messages so we only act on fresh ones
		seedExistingMessages(chatContainer);
		observer.observe(chatContainer, { childList: true, subtree: true });
		clearInterval(interval);
		console.log("Observer started on chat container.");
	} else {
		console.log("Chat container not found yet, trying again in 1s.");
	}
}, 1000);
