(function () {
    'use strict';

    const buttonId = 'syncPlayChatButton';
    const markerClass = 'syncPlayChatButton';
    const floatingHostId = 'syncPlayChatFloatingHost';
    const composerId = 'syncPlayChatComposer';
    const inputId = 'syncPlayChatInput';
    const sendButtonId = 'syncPlayChatSendButton';
    const messageListId = 'syncPlayChatMessages';
    const unreadBadgeId = 'syncPlayChatUnread';
    const refreshIntervalMs = 5000;
    let shouldShowButton = false;
    let currentSessionId = '';
    let currentGroupId = '';
    let refreshInProgress = false;
    let sendInProgress = false;
    let historyInProgress = false;
    let historyGroupId = '';
    let lastMessageId = 0;
    let unreadCount = 0;

    function normalizeId(value) {
        if (value === null || value === undefined) {
            return '';
        }

        return String(value).toLowerCase().replace(/[^a-z0-9]/g, '');
    }

    function logDebug(message, details) {
        if (!window || !window.console || typeof window.console.log !== 'function') {
            return;
        }

        if (details === undefined) {
            window.console.log('[SyncPlayChat]', message);
            return;
        }

        window.console.log('[SyncPlayChat]', message, details);
    }

    function getControlHost() {
        return document.querySelector('.videoOsdBottom .buttons')
            || document.querySelector('.videoOsdBottom .videoOsdBottomButtons')
            || document.querySelector('.videoOsdBottom .osdControls')
            || document.querySelector('[class*="videoOsd"] [class*="buttons"]')
            || document.querySelector('[class*="videoOsd"] [class*="controls"]');
    }

    function getFullscreenElement() {
        return document.fullscreenElement || document.webkitFullscreenElement || null;
    }

    function isFullscreenMode() {
        return !!getFullscreenElement();
    }

    function placeFloatingHost(host) {
        const parent = getFullscreenElement() || document.body;
        if (host.parentNode !== parent) {
            parent.appendChild(host);
        }
    }

    function getFloatingHost() {
        let host = document.getElementById(floatingHostId);
        if (host) {
            placeFloatingHost(host);
            return host;
        }

        host = document.createElement('div');
        host.id = floatingHostId;
        host.style.position = 'fixed';
        host.style.right = '1rem';
        host.style.bottom = '1rem';
        host.style.zIndex = '99999';
        host.style.display = 'flex';
        host.style.alignItems = 'flex-end';
        host.style.gap = '0.5rem';
        placeFloatingHost(host);
        return host;
    }

    function styleChatButton(button) {
        const fullscreen = isFullscreenMode();
        const label = button.querySelector('[data-chat-label]');
        button.style.padding = fullscreen ? '0.38rem 0.65rem' : '0.48rem 0.92rem';
        button.style.borderRadius = fullscreen ? '999px' : '0.6rem';
        button.style.background = fullscreen ? 'rgba(0,0,0,.62)' : 'rgba(0, 0, 0, 0.7)';
        if (label) {
            label.style.display = fullscreen ? 'inline' : 'none';
        }
    }

    function createButton() {
        const button = document.createElement('button');
        button.id = buttonId;
        button.type = 'button';
        button.className = 'emby-button ' + markerClass;
        button.setAttribute('aria-label', 'SyncPlay chat');
        button.title = 'SyncPlay chat';
        button.innerHTML = '<svg viewBox="0 0 24 24" width="19" height="19" aria-hidden="true" focusable="false"><path fill="currentColor" d="M4 4h16v11H8l-4 4V4z"/></svg>' +
            '<span data-chat-label style="display:none;margin-left:.35rem">Chat</span>' +
            '<span id="' + unreadBadgeId + '" aria-label="Unread messages" style="display:none;position:absolute;right:-.35rem;top:-.4rem;min-width:1.15rem;height:1.15rem;padding:0 .2rem;border-radius:1rem;background:#e53935;color:#fff;font-size:.72rem;line-height:1.15rem;text-align:center"></span>';
        button.style.display = 'inline-flex';
        button.style.alignItems = 'center';
        button.style.justifyContent = 'center';
        button.style.flex = '0 0 auto';
        button.style.alignSelf = 'flex-end';
        button.style.padding = '0.48rem 0.92rem';
        button.style.borderRadius = '0.6rem';
        button.style.background = 'rgba(0, 0, 0, 0.7)';
        button.style.color = '#fff';
        button.style.border = '1px solid rgba(255, 255, 255, 0.25)';
        button.style.fontSize = '0.9rem';
        button.style.cursor = 'pointer';
        button.style.position = 'relative';
        button.addEventListener('click', function () {
            toggleComposer(button);
        });
        styleChatButton(button);
        return button;
    }

    function createComposer() {
        const composer = document.createElement('div');
        composer.id = composerId;
        composer.style.display = 'none';
        composer.style.flexDirection = 'column';
        composer.style.position = 'fixed';
        composer.style.right = 'max(.5rem, env(safe-area-inset-right))';
        composer.style.bottom = '4.25rem';
        composer.style.width = 'min(24rem, calc(100vw - 1rem))';
        composer.style.height = 'min(70dvh, 34rem)';
        composer.style.maxHeight = 'min(70dvh, 34rem)';
        composer.style.boxSizing = 'border-box';
        composer.style.overflow = 'hidden';
        composer.style.borderRadius = '0.8rem';
        composer.style.background = 'rgba(16, 16, 16, 0.96)';
        composer.style.color = '#fff';
        composer.style.border = '1px solid rgba(255, 255, 255, 0.25)';
        composer.style.boxShadow = '0 .5rem 2rem rgba(0,0,0,.45)';

        const header = document.createElement('div');
        header.style.display = 'flex';
        header.style.alignItems = 'center';
        header.style.justifyContent = 'space-between';
        header.style.padding = '.7rem .8rem';
        header.style.fontWeight = '600';
        header.style.borderBottom = '1px solid rgba(255,255,255,.12)';
        header.appendChild(document.createTextNode('SyncPlay chat'));

        const closeButton = document.createElement('button');
        closeButton.type = 'button';
        closeButton.className = 'emby-button';
        closeButton.textContent = '✕';
        closeButton.setAttribute('aria-label', 'Close chat');
        closeButton.style.padding = '.25rem .45rem';
        closeButton.style.color = '#fff';
        closeButton.style.background = 'transparent';
        closeButton.style.border = '0';
        closeButton.addEventListener('click', hideComposer);
        header.appendChild(closeButton);

        const messages = document.createElement('div');
        messages.id = messageListId;
        messages.setAttribute('role', 'log');
        messages.setAttribute('aria-live', 'polite');
        messages.style.flex = '1 1 auto';
        messages.style.minHeight = '10rem';
        messages.style.padding = '.7rem';
        messages.style.overflowY = 'auto';
        messages.style.overscrollBehavior = 'contain';

        const footer = document.createElement('div');
        footer.style.display = 'flex';
        footer.style.alignItems = 'flex-end';
        footer.style.gap = '.45rem';
        footer.style.padding = '.6rem';
        footer.style.borderTop = '1px solid rgba(255,255,255,.12)';

        const input = document.createElement('textarea');
        input.id = inputId;
        input.rows = 1;
        input.maxLength = 1000;
        input.placeholder = 'Type a message';
        input.setAttribute('aria-label', 'SyncPlay chat message');
        input.wrap = 'soft';
        input.style.flex = '1 1 auto';
        input.style.width = '100%';
        input.style.minWidth = '0';
        input.style.minHeight = '2rem';
        input.style.height = '2rem';
        input.style.maxHeight = '7rem';
        input.style.padding = '0.35rem 0.55rem';
        input.style.lineHeight = '1.2rem';
        input.style.boxSizing = 'border-box';
        input.style.borderRadius = '0.45rem';
        input.style.border = '1px solid rgba(255, 255, 255, 0.25)';
        input.style.background = 'rgba(20, 20, 20, 0.8)';
        input.style.color = '#fff';
        input.style.resize = 'none';
        input.style.overflowX = 'hidden';
        input.style.overflowY = 'auto';
        input.style.whiteSpace = 'pre-wrap';
        input.style.wordBreak = 'break-word';

        const sendButton = document.createElement('button');
        sendButton.id = sendButtonId;
        sendButton.type = 'button';
        sendButton.className = 'emby-button';
        sendButton.textContent = 'Send';
        sendButton.style.padding = '0.36rem 0.65rem';
        sendButton.style.borderRadius = '0.45rem';
        sendButton.style.background = 'rgba(255, 255, 255, 0.18)';
        sendButton.style.color = '#fff';
        sendButton.style.border = '1px solid rgba(255, 255, 255, 0.25)';
        sendButton.style.cursor = 'pointer';

        sendButton.addEventListener('click', function () {
            sendComposerMessage();
        });

        input.addEventListener('keydown', function (event) {
            event.stopPropagation();

            if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                sendComposerMessage();
                return;
            }

            if (event.key === 'Escape') {
                event.preventDefault();
                hideComposer();
            }
        });

        input.addEventListener('keyup', function (event) {
            event.stopPropagation();
        });

        input.addEventListener('input', function () {
            autoResizeComposerInput();
        });

        footer.appendChild(input);
        footer.appendChild(sendButton);
        composer.appendChild(header);
        composer.appendChild(messages);
        composer.appendChild(footer);
        return composer;
    }

    function getOrCreateComposer(host) {
        let composer = document.getElementById(composerId);
        if (composer) {
            return composer;
        }

        composer = createComposer();
        host.appendChild(composer);
        return composer;
    }

    function isComposerOpen() {
        const composer = document.getElementById(composerId);
        return !!composer && composer.style.display !== 'none';
    }

    function updateUnreadBadge() {
        const badge = document.getElementById(unreadBadgeId);
        if (!badge) {
            return;
        }

        badge.textContent = unreadCount > 99 ? '99+' : String(unreadCount);
        badge.style.display = unreadCount > 0 ? 'block' : 'none';
    }

    function readMessageField(message, name) {
        if (!message) {
            return '';
        }

        const camelName = name.charAt(0).toLowerCase() + name.slice(1);
        return message[name] === undefined ? message[camelName] : message[name];
    }

    function renderChatHistory(history) {
        const list = document.getElementById(messageListId);
        if (!list) {
            return;
        }

        const nearBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 60;
        list.textContent = '';

        if (!history.length) {
            const empty = document.createElement('div');
            empty.textContent = 'No messages yet.';
            empty.style.padding = '2rem .5rem';
            empty.style.textAlign = 'center';
            empty.style.color = 'rgba(255,255,255,.65)';
            list.appendChild(empty);
            return;
        }

        const currentUserId = normalizeId(getCurrentUserId());
        history.forEach(function (message) {
            const ownMessage = normalizeId(readMessageField(message, 'SenderUserId')) === currentUserId;
            const item = document.createElement('div');
            item.style.maxWidth = '88%';
            item.style.margin = ownMessage ? '.35rem 0 .35rem auto' : '.35rem auto .35rem 0';
            item.style.padding = '.5rem .65rem';
            item.style.borderRadius = ownMessage ? '.75rem .75rem .2rem .75rem' : '.75rem .75rem .75rem .2rem';
            item.style.background = ownMessage ? 'rgba(0,164,220,.38)' : 'rgba(255,255,255,.12)';
            item.style.overflowWrap = 'anywhere';

            const meta = document.createElement('div');
            const sentAt = new Date(readMessageField(message, 'SentAt'));
            meta.textContent = String(readMessageField(message, 'SenderName') || 'Someone') +
                (Number.isNaN(sentAt.getTime()) ? '' : ' · ' + sentAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
            meta.style.fontSize = '.72rem';
            meta.style.marginBottom = '.2rem';
            meta.style.color = 'rgba(255,255,255,.7)';

            const text = document.createElement('div');
            text.textContent = String(readMessageField(message, 'Text') || '');
            text.style.whiteSpace = 'pre-wrap';
            item.appendChild(meta);
            item.appendChild(text);
            list.appendChild(item);
        });

        if (nearBottom || lastMessageId === 0) {
            list.scrollTop = list.scrollHeight;
        }
    }

    function resetChatHistory() {
        historyGroupId = '';
        lastMessageId = 0;
        unreadCount = 0;
        updateUnreadBadge();
        renderChatHistory([]);
    }

    async function refreshChatHistory() {
        if (historyInProgress || !shouldShowButton || !currentGroupId || !currentSessionId) {
            return;
        }

        if (historyGroupId !== currentGroupId) {
            resetChatHistory();
            historyGroupId = currentGroupId;
        }

        historyInProgress = true;
        try {
            const response = await fetchJson('SyncPlayChat/History?groupId=' + encodeURIComponent(currentGroupId) +
                '&senderSessionId=' + encodeURIComponent(currentSessionId));
            let history = response;
            if (typeof history === 'string') {
                history = JSON.parse(history);
            }

            if (!Array.isArray(history)) {
                return;
            }

            const previousLastId = lastMessageId;
            const currentUserId = normalizeId(getCurrentUserId());
            history.forEach(function (message) {
                const id = Number(readMessageField(message, 'Id')) || 0;
                if (id > lastMessageId) {
                    lastMessageId = id;
                }

                if (!isComposerOpen() && id > previousLastId && normalizeId(readMessageField(message, 'SenderUserId')) !== currentUserId) {
                    unreadCount += 1;
                }
            });

            if (isComposerOpen()) {
                unreadCount = 0;
            }

            renderChatHistory(history);
            updateUnreadBadge();
        } catch (err) {
            logDebug('Failed to refresh chat history', err);
        } finally {
            historyInProgress = false;
        }
    }

    function autoResizeComposerInput() {
        const input = document.getElementById(inputId);
        if (!input) {
            return;
        }

        input.style.height = 'auto';
        const minHeightPx = 32;
        const maxHeightPx = 112;
        const nextHeight = Math.max(minHeightPx, Math.min(maxHeightPx, input.scrollHeight));
        input.style.height = String(nextHeight) + 'px';
    }

    function setComposerBusy(isBusy) {
        const input = document.getElementById(inputId);
        const sendButton = document.getElementById(sendButtonId);

        if (input) {
            input.disabled = isBusy;
        }

        if (sendButton) {
            sendButton.disabled = isBusy;
            sendButton.style.opacity = isBusy ? '0.75' : '1';
        }
    }

    function hideComposer() {
        const composer = document.getElementById(composerId);
        if (composer) {
            composer.style.display = 'none';
        }
    }

    function toggleComposer(button) {
        if (!shouldShowButton) {
            return;
        }

        const host = getFloatingHost();
        const composer = getOrCreateComposer(host);

        const isVisible = composer.style.display !== 'none';
        composer.style.display = isVisible ? 'none' : 'flex';

        if (button) {
            button.style.opacity = isVisible ? '1' : '0.85';
        }

        if (!isVisible) {
            unreadCount = 0;
            updateUnreadBadge();
            refreshChatHistory();
            const input = document.getElementById(inputId);
            if (input) {
                window.setTimeout(function () {
                    autoResizeComposerInput();
                    input.focus();
                }, 0);
            }
        }
    }

    function getComposerMessageText() {
        const input = document.getElementById(inputId);
        if (!input) {
            return '';
        }

        return (input.value || '').trim();
    }

    function clearComposerInput() {
        const input = document.getElementById(inputId);
        if (input) {
            input.value = '';
            autoResizeComposerInput();
        }
    }

    function sendComposerMessage() {
        const text = getComposerMessageText();
        if (!text) {
            return;
        }

        onChatButtonClick(text);
    }

    function extractSyncPlayGroupId(session) {
        const playState = session && session.PlayState;
        const groupId = (session && session.PlayState && session.PlayState.SyncPlayGroupId)
            || (session && session.PlayState && session.PlayState.SyncPlayGroup && session.PlayState.SyncPlayGroup.Id)
            || (session && session.SyncPlayGroupId)
            || (session && session.SyncPlayGroup && session.SyncPlayGroup.Id)
            || (playState && playState.SyncPlayInfo && playState.SyncPlayInfo.GroupId)
            || (session && session.AdditionalData && session.AdditionalData.SyncPlayGroupId)
            || (session && session.PlayState && session.PlayState.SyncPlayGroup)
            || (session && session.SyncPlayGroup)
            || '';

        if (typeof groupId === 'string') {
            return groupId;
        }

        return groupId && typeof groupId === 'object' ? (groupId.Id || groupId.GroupId || '') : '';
    }

    function removeExtraButtons() {
        const existingButtons = document.querySelectorAll('.' + markerClass);
        if (existingButtons.length > 1) {
            for (let i = 1; i < existingButtons.length; i += 1) {
                existingButtons[i].remove();
            }
        }

        if (!shouldShowButton && existingButtons.length > 0) {
            existingButtons[0].remove();
        }
    }

    function getCurrentUserId() {
        if (!window.ApiClient) {
            return '';
        }

        if (typeof window.ApiClient.getCurrentUserId === 'function') {
            return window.ApiClient.getCurrentUserId() || '';
        }

        if (typeof window.ApiClient.userId === 'function') {
            return window.ApiClient.userId() || '';
        }

        if (typeof window.ApiClient._userId === 'string') {
            return window.ApiClient._userId;
        }

        if (window.ApiClient._serverInfo && typeof window.ApiClient._serverInfo.UserId === 'string') {
            return window.ApiClient._serverInfo.UserId;
        }

        return '';
    }

    function getCurrentUserIds() {
        const raw = getCurrentUserId();
        const ids = [];

        if (raw) {
            ids.push(raw);
        }

        const normalized = normalizeId(raw);
        if (normalized && ids.indexOf(normalized) === -1) {
            ids.push(normalized);
        }

        return ids;
    }

    function getCurrentUserName() {
        if (!window.ApiClient) {
            return '';
        }

        const serverInfo = window.ApiClient._serverInfo;
        if (serverInfo && typeof serverInfo.UserName === 'string' && serverInfo.UserName.length > 0) {
            return serverInfo.UserName;
        }

        if (window.Dashboard && window.Dashboard.getCurrentUser) {
            const currentUser = window.Dashboard.getCurrentUser();
            if (currentUser && typeof currentUser.Name === 'string' && currentUser.Name.length > 0) {
                return currentUser.Name;
            }
        }

        return '';
    }

    function getCurrentDeviceId() {
        if (!window.ApiClient) {
            return '';
        }

        if (typeof window.ApiClient.deviceId === 'function') {
            return window.ApiClient.deviceId() || '';
        }

        if (typeof window.ApiClient._deviceId === 'string') {
            return window.ApiClient._deviceId;
        }

        return '';
    }

    function hasSyncPlayGroup(session) {
        return extractSyncPlayGroupId(session).length > 0;
    }

    function collectStringValues(value, output) {
        if (value === null || value === undefined) {
            return;
        }

        if (typeof value === 'string') {
            output.push(value);
            return;
        }

        if (Array.isArray(value)) {
            value.forEach(function (item) {
                collectStringValues(item, output);
            });
            return;
        }

        if (typeof value === 'object') {
            Object.keys(value).forEach(function (key) {
                collectStringValues(value[key], output);
            });
        }
    }

    function normalizeSessionsResponse(response) {
        if (Array.isArray(response)) {
            return response;
        }

        if (response && Array.isArray(response.Items)) {
            return response.Items;
        }

        if (response && Array.isArray(response.Sessions)) {
            return response.Sessions;
        }

        return [];
    }

    function normalizeGroupsResponse(response) {
        if (Array.isArray(response)) {
            return response;
        }

        if (response && Array.isArray(response.Groups)) {
            return response.Groups;
        }

        if (response && Array.isArray(response.Items)) {
            return response.Items;
        }

        return [];
    }

    function objectContainsString(value, expectedLowerValue) {
        if (!value || !expectedLowerValue) {
            return false;
        }

        if (typeof value === 'string') {
            const normalizedActual = normalizeId(value);
            const normalizedExpected = normalizeId(expectedLowerValue);

            if (!normalizedActual || !normalizedExpected) {
                return false;
            }

            return normalizedActual === normalizedExpected;
        }

        if (Array.isArray(value)) {
            return value.some(function (item) {
                return objectContainsString(item, expectedLowerValue);
            });
        }

        if (typeof value === 'object') {
            return Object.keys(value).some(function (key) {
                return objectContainsString(value[key], expectedLowerValue);
            });
        }

        return false;
    }

    function buildSessionsPaths() {
        const userIds = getCurrentUserIds();
        const paths = ['Sessions'];

        userIds.forEach(function (id) {
            const path = 'Sessions?UserId=' + encodeURIComponent(id);
            if (paths.indexOf(path) === -1) {
                paths.push(path);
            }
        });

        return paths;
    }

    async function fetchJson(path) {
        if (!window.ApiClient) {
            return null;
        }

        const normalizedPath = typeof path === 'string' && path.charAt(0) === '/' ? path.slice(1) : path;
        const url = typeof window.ApiClient.getUrl === 'function'
            ? window.ApiClient.getUrl(normalizedPath)
            : normalizedPath;

        if (typeof window.ApiClient.ajax === 'function') {
            return window.ApiClient.ajax({
                type: 'GET',
                url: url,
                dataType: 'json'
            });
        }

        if (typeof window.ApiClient.getJSON === 'function') {
            return window.ApiClient.getJSON(url);
        }

        return null;
    }

    async function postJson(path, data, expectJsonResponse) {
        if (!window.ApiClient) {
            return null;
        }

        const normalizedPath = typeof path === 'string' && path.charAt(0) === '/' ? path.slice(1) : path;
        const url = typeof window.ApiClient.getUrl === 'function'
            ? window.ApiClient.getUrl(normalizedPath)
            : normalizedPath;

        if (typeof window.ApiClient.ajax === 'function') {
            const request = {
                type: 'POST',
                url: url,
                contentType: 'application/json; charset=utf-8',
                data: JSON.stringify(data || {})
            };

            if (expectJsonResponse) {
                request.dataType = 'json';
            }

            return window.ApiClient.ajax(request);
        }

        if (typeof window.fetch === 'function') {
            const response = await window.fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json; charset=utf-8'
                },
                body: JSON.stringify(data || {})
            });

            if (!response.ok) {
                throw new Error('HTTP ' + response.status);
            }

            if (expectJsonResponse) {
                return response.json();
            }

            return null;
        }

        return null;
    }

    function matchesCurrentUser(session) {
        const currentUserIds = getCurrentUserIds();
        if (!currentUserIds.length) {
            return true;
        }

        const sessionUserId = (session && session.UserId) || (session && session.User && session.User.Id) || '';
        const normalizedSessionUserId = normalizeId(sessionUserId);
        return currentUserIds.some(function (id) {
            return normalizeId(id) === normalizedSessionUserId;
        });
    }

    function getCurrentSessionIds(sessions) {
        return sessions
            .filter(matchesCurrentUser)
            .map(function (session) { return session && session.Id; })
            .filter(function (id) { return typeof id === 'string' && id.length > 0; });
    }

    function getCurrentSession(sessions) {
        const currentDeviceId = normalizeId(getCurrentDeviceId());
        const matchingUserSessions = sessions.filter(matchesCurrentUser);
        const groupedUserSession = matchingUserSessions.find(hasSyncPlayGroup);

        if (currentDeviceId) {
            const exactDeviceSessions = matchingUserSessions.filter(function (session) {
                return normalizeId(session && session.DeviceId) === currentDeviceId;
            });
            const groupedDeviceSession = exactDeviceSessions.find(hasSyncPlayGroup);

            if (groupedDeviceSession || exactDeviceSessions.length > 0) {
                return groupedDeviceSession || exactDeviceSessions[0];
            }
        }

        return groupedUserSession || (matchingUserSessions.length > 0 ? matchingUserSessions[0] : null);
    }

    function mapKnownSessionIds(sessions) {
        const map = {};
        sessions.forEach(function (session) {
            const sessionId = session && session.Id;
            if (typeof sessionId === 'string' && sessionId.length > 0) {
                map[normalizeId(sessionId)] = sessionId;
            }
        });

        return map;
    }

    function filterSessionIdsToKnownSessions(sessionIds, sessions) {
        const knownSessionIds = mapKnownSessionIds(sessions);
        const filtered = [];

        sessionIds.forEach(function (id) {
            const knownId = knownSessionIds[normalizeId(id)];
            if (knownId && filtered.indexOf(knownId) === -1) {
                filtered.push(knownId);
            }
        });

        return filtered;
    }

    function summarizeError(error) {
        if (!error) {
            return 'Unknown error';
        }

        if (typeof error === 'string') {
            return error;
        }

        if (error.message) {
            return error.message;
        }

        if (error.status || error.statusText) {
            return 'HTTP ' + (error.status || 'unknown') + ' ' + (error.statusText || '').trim();
        }

        if (error.responseJSON) {
            try {
                return JSON.stringify(error.responseJSON);
            } catch (jsonErr) {
                return 'Response JSON serialization failed';
            }
        }

        if (error.responseText) {
            return String(error.responseText).slice(0, 500);
        }

        try {
            return JSON.stringify(error).slice(0, 500);
        } catch (jsonErr) {
            return 'Unserializable error object';
        }
    }

    function isLikelySessionId(value) {
        if (typeof value !== 'string') {
            return false;
        }

        const trimmed = value.trim();
        return /^[a-f0-9]{32}$/i.test(trimmed) || /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(trimmed);
    }

    function resolveSyncPlayGroupId(group) {
        const direct = (group && group.Id)
            || (group && group.GroupId)
            || (group && group.Group && group.Group.Id)
            || (group && group.GroupInfo && group.GroupInfo.Id)
            || '';

        if (typeof direct === 'string' && direct.length > 0) {
            return direct;
        }

        const values = [];
        collectStringValues(group, values);
        const possibleGroupId = values.find(function (value) {
            return isLikelySessionId(value);
        });

        return possibleGroupId || '';
    }

    function extractLikelySessionIdsFromGroup(group) {
        const fromSessionKeys = [];

        function walk(value) {
            if (value === null || value === undefined) {
                return;
            }

            if (Array.isArray(value)) {
                value.forEach(walk);
                return;
            }

            if (typeof value !== 'object') {
                return;
            }

            Object.keys(value).forEach(function (key) {
                const child = value[key];
                const normalizedKey = normalizeId(key);
                if ((normalizedKey === 'sessionid' || normalizedKey.indexOf('sessionid') !== -1) && typeof child === 'string' && child.length > 0) {
                    fromSessionKeys.push(child);
                }
                walk(child);
            });
        }

        walk(group);

        const values = [];
        collectStringValues(group, values);

        const unique = [];
        fromSessionKeys.forEach(function (value) {
            if (typeof value !== 'string' || value.length === 0) {
                return;
            }

            if (unique.indexOf(value) === -1) {
                unique.push(value);
            }
        });

        values.forEach(function (value) {
            if (!isLikelySessionId(value)) {
                return;
            }

            if (unique.indexOf(value) === -1) {
                unique.push(value);
            }
        });

        return unique;
    }

    async function fetchSyncPlayGroupDetails(groups) {
        const detailGroups = [];

        for (let i = 0; i < groups.length; i += 1) {
            const group = groups[i];
            const groupId = resolveSyncPlayGroupId(group);
            if (!groupId) {
                continue;
            }

            try {
                const details = await fetchJson('SyncPlay/' + encodeURIComponent(groupId));
                if (details) {
                    detailGroups.push(details);
                }
            } catch (err) {
                logDebug('Failed to fetch SyncPlay group details', { groupId: groupId, error: err });
            }
        }

        return detailGroups;
    }

    function getGroupIdsForCurrentUserSessions(sessions) {
        const groupIds = [];
        sessions
            .filter(matchesCurrentUser)
            .forEach(function (session) {
                const groupId = extractSyncPlayGroupId(session);
                if (groupId && groupIds.indexOf(groupId) === -1) {
                    groupIds.push(groupId);
                }
            });

        return groupIds;
    }

    function findSessionIdsByGroupIds(sessions, groupIds) {
        if (!groupIds.length) {
            return [];
        }

        const normalizedGroupIds = groupIds.map(normalizeId).filter(Boolean);
        return sessions
            .filter(function (session) {
                const sessionGroupId = normalizeId(extractSyncPlayGroupId(session));
                return normalizedGroupIds.indexOf(sessionGroupId) !== -1;
            })
            .map(function (session) { return session && session.Id; })
            .filter(function (id) { return typeof id === 'string' && id.length > 0; });
    }

    function findSessionIdsInGroupPayload(groups, sessions) {
        if (!groups.length || !sessions.length) {
            return [];
        }

        const normalizedSessionIds = {};
        sessions.forEach(function (session) {
            const sessionId = session && session.Id;
            if (typeof sessionId === 'string' && sessionId.length > 0) {
                normalizedSessionIds[normalizeId(sessionId)] = sessionId;
            }
        });

        const matchingIds = [];

        groups.forEach(function (group) {
            if (!groupsContainCurrentUser([group], sessions)) {
                return;
            }

            const values = [];
            collectStringValues(group, values);
            values.forEach(function (value) {
                const normalizedValue = normalizeId(value);
                const sessionId = normalizedSessionIds[normalizedValue];
                if (sessionId && matchingIds.indexOf(sessionId) === -1) {
                    matchingIds.push(sessionId);
                }
            });
        });

        return matchingIds;
    }

    function findGroupsByGroupIds(groups, groupIds) {
        if (!groups.length || !groupIds.length) {
            return [];
        }

        const normalizedGroupIds = groupIds.map(normalizeId).filter(Boolean);
        return groups.filter(function (group) {
            return normalizedGroupIds.indexOf(normalizeId(resolveSyncPlayGroupId(group))) !== -1;
        });
    }

    function mergeSessionsUnique(primary, secondary) {
        const map = {};

        (primary || []).forEach(function (session) {
            const id = session && session.Id;
            if (typeof id === 'string' && id.length > 0) {
                map[id] = session;
            }
        });

        (secondary || []).forEach(function (session) {
            const id = session && session.Id;
            if (typeof id === 'string' && id.length > 0 && !map[id]) {
                map[id] = session;
            }
        });

        return Object.keys(map).map(function (id) {
            return map[id];
        });
    }

    function extractParticipantTokens(groups) {
        const userIds = [];
        const userNames = [];

        groups.forEach(function (group) {
            if (!group || !Array.isArray(group.Participants)) {
                return;
            }

            group.Participants.forEach(function (participant) {
                if (typeof participant === 'string' && participant.length > 0) {
                    if (isLikelySessionId(participant)) {
                        if (userIds.indexOf(participant) === -1) {
                            userIds.push(participant);
                        }
                        return;
                    }

                    if (userNames.indexOf(participant) === -1) {
                        userNames.push(participant);
                    }
                    return;
                }

                if (!participant || typeof participant !== 'object') {
                    return;
                }

                const participantUserId = participant.UserId || (participant.User && participant.User.Id) || '';
                if (typeof participantUserId === 'string' && participantUserId.length > 0 && userIds.indexOf(participantUserId) === -1) {
                    userIds.push(participantUserId);
                }

                const participantUserName = participant.UserName || (participant.User && participant.User.Name) || '';
                if (typeof participantUserName === 'string' && participantUserName.length > 0 && userNames.indexOf(participantUserName) === -1) {
                    userNames.push(participantUserName);
                }
            });
        });

        return {
            userIds: userIds,
            userNames: userNames
        };
    }

    async function fetchSessionsForUserIds(userIds) {
        const sessionsById = {};

        for (let i = 0; i < userIds.length; i += 1) {
            const userId = userIds[i];
            if (!userId) {
                continue;
            }

            try {
                const response = await fetchJson('Sessions?UserId=' + encodeURIComponent(userId));
                const sessions = normalizeSessionsResponse(response);
                sessions.forEach(function (session) {
                    const sessionId = session && session.Id;
                    if (typeof sessionId === 'string' && sessionId.length > 0) {
                        sessionsById[sessionId] = session;
                    }
                });
            } catch (err) {
                logDebug('Failed to fetch participant sessions by user ID', { userId: userId, error: err });
            }
        }

        return Object.keys(sessionsById).map(function (id) {
            return sessionsById[id];
        });
    }

    function buildCurrentIdentityTokens(sessions) {
        const tokens = [];

        getCurrentUserIds().forEach(function (id) {
            if (id && tokens.indexOf(id) === -1) {
                tokens.push(id);
            }
        });

        const currentUserName = getCurrentUserName();
        if (currentUserName && tokens.indexOf(currentUserName) === -1) {
            tokens.push(currentUserName);
        }

        getCurrentSessionIds(sessions).forEach(function (sessionId) {
            if (sessionId && tokens.indexOf(sessionId) === -1) {
                tokens.push(sessionId);
            }
        });

        sessions
            .filter(matchesCurrentUser)
            .forEach(function (session) {
                const userName = (session && session.UserName)
                    || (session && session.User && session.User.Name)
                    || '';
                if (userName && tokens.indexOf(userName) === -1) {
                    tokens.push(userName);
                }
            });

        return tokens;
    }

    function payloadContainsAnyIdentity(payload, identityTokens) {
        if (!payload || !identityTokens.length) {
            return false;
        }

        return identityTokens.some(function (token) {
            return objectContainsString(payload, token);
        });
    }

    function hasIntersection(left, right) {
        if (!left.length || !right.length) {
            return false;
        }

        const rightLookup = {};
        right.forEach(function (value) {
            rightLookup[normalizeId(value)] = true;
        });

        return left.some(function (value) {
            return !!rightLookup[normalizeId(value)];
        });
    }

    async function isCurrentUserInGroupsViaDetails(groups, sessions) {
        const localSessionIds = getCurrentSessionIds(sessions);
        const identityTokens = buildCurrentIdentityTokens(sessions);
        if (!localSessionIds.length || !groups.length) {
            return false;
        }

        const groupIds = getGroupIdsForCurrentUserSessions(sessions);
        const scopedGroups = findGroupsByGroupIds(groups, groupIds);
        const groupsForLookup = scopedGroups.length > 0 ? scopedGroups : groups;
        const groupDetailPayloads = await fetchSyncPlayGroupDetails(groupsForLookup);

        const sessionIdsFromGroupDetails = [];
        let matchedIdentityInDetails = false;
        groupDetailPayloads.forEach(function (groupDetail) {
            if (!matchedIdentityInDetails && payloadContainsAnyIdentity(groupDetail, identityTokens)) {
                matchedIdentityInDetails = true;
            }

            extractLikelySessionIdsFromGroup(groupDetail).forEach(function (id) {
                if (sessionIdsFromGroupDetails.indexOf(id) === -1) {
                    sessionIdsFromGroupDetails.push(id);
                }
            });
        });

        const knownSessionIds = filterSessionIdsToKnownSessions(sessionIdsFromGroupDetails, sessions);
        if (hasIntersection(localSessionIds, knownSessionIds)) {
            return true;
        }

        return matchedIdentityInDetails;
    }

    function showLocalToast(text, title) {
        if (window.toastr && typeof window.toastr.info === 'function') {
            window.toastr.info(text, title || 'SyncPlay Chat');
            return;
        }

        if (window.Dashboard && typeof window.Dashboard.alert === 'function') {
            window.Dashboard.alert({
                title: title || 'SyncPlay Chat',
                message: text
            });
            return;
        }

        logDebug('Toast fallback', { title: title || 'SyncPlay Chat', text: text });
    }

    function extractParticipantsFromGroups(groups) {
        const participants = [];

        groups.forEach(function (group) {
            const groupParticipants = group && group.Participants;
            if (!Array.isArray(groupParticipants)) {
                return;
            }

            groupParticipants.forEach(function (participant) {
                if (typeof participant === 'string' && participant.length > 0 && participants.indexOf(participant) === -1) {
                    participants.push(participant);
                    return;
                }

                if (participant && typeof participant === 'object') {
                    const userName = participant.UserName || (participant.User && participant.User.Name) || '';
                    const deviceName = participant.DeviceName || participant.Device || '';

                    if (typeof userName === 'string' && userName.length > 0 && participants.indexOf(userName) === -1) {
                        participants.push(userName);
                    }

                    if (typeof deviceName === 'string' && deviceName.length > 0 && participants.indexOf(deviceName) === -1) {
                        participants.push(deviceName);
                    }
                }
            });
        });

        return participants;
    }

    async function sendMessageViaServer(text, senderSessionId, groupId, participants) {
        const response = await postJson('SyncPlayChat/Send', {
            GroupId: groupId || '',
            SenderSessionId: senderSessionId || '',
            Header: 'SyncPlay Chat',
            Text: text,
            TimeoutMs: 4000,
            ParticipantsCsv: (participants || []).join(',')
        }, true);

        let normalized = response;
        if (typeof normalized === 'string') {
            try {
                normalized = JSON.parse(normalized);
            } catch (parseError) {
                logDebug('Failed to parse server chat send response JSON', {
                    response: response,
                    error: parseError
                });
                normalized = null;
            }
        }

        if (normalized && typeof normalized === 'object' && normalized.responseJSON && typeof normalized.responseJSON === 'object') {
            normalized = normalized.responseJSON;
        }

        if (!normalized || typeof normalized !== 'object') {
            logDebug('Unexpected server chat send response shape', { response: response, normalized: normalized });
            return {
                attempted: 0,
                sent: 0,
                failed: 0
            };
        }

        return {
            attempted: Number(normalized.Attempted === undefined ? normalized.attempted : normalized.Attempted) || 0,
            sent: Number(normalized.Sent === undefined ? normalized.sent : normalized.Sent) || 0,
            failed: Number(normalized.Failed === undefined ? normalized.failed : normalized.Failed) || 0
        };
    }

    async function onChatButtonClick(chatText) {
        if (sendInProgress) {
            return;
        }

        const trimmedText = typeof chatText === 'string' ? chatText.trim() : '';
        if (!trimmedText) {
            return;
        }

        sendInProgress = true;
        setComposerBusy(true);

        try {
            const sessions = await fetchSessions();
            const groupsResponse = await fetchJson('SyncPlay/List');
            const groups = normalizeGroupsResponse(groupsResponse);

            const currentSession = getCurrentSession(sessions);
            const groupIds = getGroupIdsForCurrentUserSessions(sessions);
            const sessionIdsFromSessionGroup = findSessionIdsByGroupIds(sessions, groupIds);
            const sessionIdsFromGroupPayload = findSessionIdsInGroupPayload(groups, sessions);
            const groupsBySessionGroupIds = findGroupsByGroupIds(groups, groupIds);
            const relevantGroups = groups.filter(function (group) {
                return groupsContainCurrentUser([group], sessions);
            });
            let groupsForDetailLookup = [];

            if (groupsBySessionGroupIds.length > 0) {
                groupsForDetailLookup = groupsBySessionGroupIds;
            } else if (relevantGroups.length > 0) {
                groupsForDetailLookup = relevantGroups;
            } else if (groups.length === 1) {
                groupsForDetailLookup = [groups[0]];
            }

            const participantsForSend = extractParticipantsFromGroups(groupsForDetailLookup.length > 0 ? groupsForDetailLookup : groups);
            let result;
            const preferredGroupId = groupIds.length > 0 ? groupIds[0] : resolveSyncPlayGroupId(groupsForDetailLookup[0] || groups[0]);
            result = await sendMessageViaServer(
                trimmedText,
                currentSession && currentSession.Id,
                preferredGroupId,
                participantsForSend);

            logDebug('Sync chat send result', result);

            if (result && result.sent > 0) {
                clearComposerInput();
                await refreshChatHistory();
            } else {
                showLocalToast('No active SyncPlay recipients were found.');
            }
        } catch (err) {
            logDebug('Failed to send SyncPlay chat message', err);
            showLocalToast('Failed to send: ' + summarizeError(err));
        } finally {
            sendInProgress = false;
            setComposerBusy(false);
        }
    }

    function groupsContainCurrentUser(groups, sessions) {
        const identityTokens = buildCurrentIdentityTokens(sessions);
        if (identityTokens.length === 0) {
            return false;
        }

        return groups.some(function (group) {
            return payloadContainsAnyIdentity(group, identityTokens);
        });
    }

    async function fetchSessions() {
        const paths = buildSessionsPaths();
        const sessionsById = {};
        const sessionsWithoutId = [];

        for (let i = 0; i < paths.length; i += 1) {
            const path = paths[i];
            try {
                const response = await fetchJson(path);
                const sessions = normalizeSessionsResponse(response);
                sessions.forEach(function (session) {
                    const sessionId = session && session.Id;
                    if (typeof sessionId === 'string' && sessionId.length > 0) {
                        sessionsById[sessionId] = session;
                        return;
                    }

                    sessionsWithoutId.push(session);
                });
            } catch (err) {
                logDebug('Failed to fetch sessions path', { path: path, error: err });
            }
        }

        const dedupedSessions = Object.keys(sessionsById).map(function (id) {
            return sessionsById[id];
        });

        if (dedupedSessions.length === 0 && sessionsWithoutId.length > 0) {
            return sessionsWithoutId;
        }

        return dedupedSessions;
    }

    async function isCurrentUserInSyncPlayGroup() {
        if (!window.ApiClient) {
            return false;
        }

        const sessions = await fetchSessions();
        const matchingUserSessions = sessions.filter(matchesCurrentUser);
        const currentSession = getCurrentSession(sessions);
        currentSessionId = currentSession && currentSession.Id || '';
        currentGroupId = currentSession && extractSyncPlayGroupId(currentSession) || '';
        if (matchingUserSessions.length === 0) {
            currentSessionId = '';
            currentGroupId = '';
            return false;
        }

        if (matchingUserSessions.some(hasSyncPlayGroup)) {
            if (!currentGroupId) {
                currentGroupId = getGroupIdsForCurrentUserSessions(sessions)[0] || '';
            }
            return true;
        }

        try {
            const groupsResponse = await fetchJson('SyncPlay/List');
            const groups = normalizeGroupsResponse(groupsResponse);
            if (groups.length > 0) {
                const matchingGroup = groups.find(function (group) {
                    return groupsContainCurrentUser([group], sessions);
                });
                if (matchingGroup) {
                    currentGroupId = resolveSyncPlayGroupId(matchingGroup);
                    return true;
                }

                if (await isCurrentUserInGroupsViaDetails(groups, sessions)) {
                    currentGroupId = groups.length === 1 ? resolveSyncPlayGroupId(groups[0]) : currentGroupId;
                    return true;
                }
            }
        } catch (err) {
            logDebug('SyncPlay list request failed', err);
        }

        logDebug('Current user not in any SyncPlay group', {
            matchingUserSessions: matchingUserSessions.length
        });
        currentGroupId = '';
        return false;
    }

    async function refreshSyncPlayState() {
        if (refreshInProgress) {
            return;
        }

        refreshInProgress = true;

        try {
            shouldShowButton = await isCurrentUserInSyncPlayGroup();
        } catch (err) {
            logDebug('Failed to refresh SyncPlay state', err);
            return;
        } finally {
            refreshInProgress = false;
            addButton();
            window.dispatchEvent(new CustomEvent('syncplaychatcontext', {
                detail: { inGroup: shouldShowButton, sessionId: currentSessionId, groupId: currentGroupId }
            }));
            if (shouldShowButton) {
                refreshChatHistory();
            } else {
                resetChatHistory();
            }
        }
    }

    function addButton() {
        const controlHost = getControlHost();
        const floatingHost = getFloatingHost();
        removeExtraButtons();

        if (!controlHost && !floatingHost) {
            return;
        }

        if (!shouldShowButton) {
            hideComposer();

            if (controlHost) {
                const controlButton = controlHost.querySelector('.' + markerClass);
                if (controlButton) {
                    controlButton.remove();
                }
            }

            const floatingButton = floatingHost.querySelector('.' + markerClass);
            if (floatingButton) {
                floatingButton.remove();
            }

            return;
        }

        getOrCreateComposer(floatingHost);

        const existingButton = floatingHost.querySelector('.' + markerClass);
        if (existingButton) {
            styleChatButton(existingButton);
            return;
        }

        floatingHost.appendChild(createButton());
    }

    function start() {
        if (!document.body) {
            return;
        }

        window.__syncPlayChatLoaded = true;
        window.SyncPlayChatBridge = {
            getContext: function () {
                return { inGroup: shouldShowButton, sessionId: currentSessionId, groupId: currentGroupId };
            },
            refresh: refreshSyncPlayState
        };

        const observer = new MutationObserver(addButton);
        observer.observe(document.body, { childList: true, subtree: true });

        const onFullscreenChange = function () {
            if (isFullscreenMode()) {
                hideComposer();
            }
            addButton();
        };
        document.addEventListener('fullscreenchange', onFullscreenChange);
        document.addEventListener('webkitfullscreenchange', onFullscreenChange);

        refreshSyncPlayState();
        window.setInterval(refreshSyncPlayState, refreshIntervalMs);
        window.addEventListener('focus', refreshSyncPlayState);
        document.addEventListener('visibilitychange', function () {
            if (!document.hidden) {
                refreshSyncPlayState();
            }
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', start, { once: true });
    } else {
        start();
    }
})();
