(function () {
    'use strict';

    const hostId = 'syncPlayChatFloatingHost';
    const buttonId = 'syncPlayVoiceButton';
    const panelId = 'syncPlayVoicePanel';
    const heartbeatMs = 10000;
    const signalBackoff = [500, 1000, 2000, 4000, 8000, 10000];
    const peerBackoff = [1000, 3000, 7000, 15000, 30000];

    function log(message, detail) {
        if (window.console && window.console.debug) {
            window.console.debug('[SyncPlayVoice] ' + message, detail || '');
        }
    }

    function sleep(ms) {
        return new Promise(function (resolve) {
            window.setTimeout(resolve, ms + Math.random() * Math.min(500, ms / 4));
        });
    }

    function normalizeId(value) {
        return String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    }

    function isSecureVoicePage() {
        return window.location.protocol === 'https:' && window.isSecureContext === true;
    }

    function qualityDecision(profile, badSamples, goodSamples, loss, jitter, rtt) {
        const poor = loss > 0.08 || jitter > 80 || rtt > 800;
        const degraded = poor || loss >= 0.03 || jitter >= 30 || rtt >= 250;
        let bad = degraded ? badSamples + 1 : 0;
        let good = degraded ? 0 : goodSamples + 1;
        let next = profile;
        if (bad >= 2) {
            next = profile === 'high' ? 'balanced' : 'low';
            bad = 0;
        } else if (good >= 5 && profile !== 'high') {
            next = profile === 'low' ? 'balanced' : 'high';
            good = 0;
        }
        return { profile: next, badSamples: bad, goodSamples: good };
    }

    function apiUrl(path) {
        return window.ApiClient && window.ApiClient.getUrl ? window.ApiClient.getUrl(path) : path;
    }

    function getAuthHeaders() {
        const headers = {};
        if (!window.ApiClient) {
            return headers;
        }

        if (typeof window.ApiClient.getDefaultHeaders === 'function') {
            try {
                const defaults = window.ApiClient.getDefaultHeaders();
                if (defaults) {
                    Object.assign(headers, defaults);
                }
            } catch (_) {}
        }

        const token = (typeof window.ApiClient.accessToken === 'function' ? window.ApiClient.accessToken() : '')
            || window.ApiClient._accessToken
            || (window.ApiClient._serverInfo && window.ApiClient._serverInfo.AccessToken)
            || '';

        const deviceId = (typeof window.ApiClient.deviceId === 'function' ? window.ApiClient.deviceId() : '')
            || window.ApiClient._deviceId
            || '';

        const deviceName = (typeof window.ApiClient.deviceName === 'function' ? window.ApiClient.deviceName() : '')
            || window.ApiClient._deviceName
            || (typeof window.ApiClient.device === 'function' ? window.ApiClient.device() : '')
            || 'Browser';

        const appName = (typeof window.ApiClient.appName === 'function' ? window.ApiClient.appName() : '')
            || window.ApiClient._appName
            || (typeof window.ApiClient.clientName === 'function' ? window.ApiClient.clientName() : '')
            || 'Jellyfin Web';

        const appVersion = (typeof window.ApiClient.appVersion === 'function' ? window.ApiClient.appVersion() : '')
            || window.ApiClient._appVersion
            || (typeof window.ApiClient.clientVersion === 'function' ? window.ApiClient.clientVersion() : '')
            || '10.10.0';

        if (token) {
            const authValue = 'MediaBrowser Client="' + appName + '", Device="' + deviceName + '", DeviceId="' + deviceId + '", Version="' + appVersion + '", Token="' + token + '"';
            if (!headers['Authorization']) {
                headers['Authorization'] = authValue;
            }
            if (!headers['X-Emby-Authorization']) {
                headers['X-Emby-Authorization'] = authValue;
            }
            if (!headers['X-Emby-Token']) {
                headers['X-Emby-Token'] = token;
            }
            if (!headers['X-MediaBrowser-Token']) {
                headers['X-MediaBrowser-Token'] = token;
            }
        }

        return headers;
    }

    async function api(path, method, body, signal) {
        const headers = new Headers(getAuthHeaders());
        if (body !== undefined) {
            headers.set('Content-Type', 'application/json; charset=utf-8');
        }

        const response = await window.fetch(apiUrl(path), {
            method: method || 'GET',
            headers: headers,
            body: body === undefined ? undefined : JSON.stringify(body),
            signal: signal
        });
        if (!response.ok) {
            const message = (await response.text()).replace(/^"|"$/g, '') || ('HTTP ' + response.status);
            const error = new Error(message);
            error.status = response.status;
            throw error;
        }

        return response.status === 204 ? null : response.json();
    }

    class VoiceQualityManager {
        constructor(record, roomSize) {
            this.record = record;
            this.profile = roomSize >= 9 ? 'balanced' : 'high';
            this.badSamples = 0;
            this.goodSamples = 0;
            this.previous = null;
            this.disabled = false;
            this.timer = window.setInterval(this.sample.bind(this), 5000);
            this.apply();
        }

        stop() {
            window.clearInterval(this.timer);
        }

        async sample() {
            if (this.disabled || this.record.pc.connectionState !== 'connected') {
                return;
            }

            try {
                const reports = await this.record.pc.getStats();
                let audio;
                let rtt = 0;
                reports.forEach(function (report) {
                    if ((report.type === 'inbound-rtp' || report.type === 'remote-inbound-rtp') && (report.kind === 'audio' || report.mediaType === 'audio')) {
                        audio = report;
                    }
                    if (report.type === 'candidate-pair' && report.state === 'succeeded' && Number.isFinite(report.currentRoundTripTime)) {
                        rtt = report.currentRoundTripTime * 1000;
                    }
                });
                if (!audio) {
                    return;
                }

                const current = {
                    received: Number(audio.packetsReceived || 0),
                    lost: Number(audio.packetsLost || 0),
                    jitter: Number(audio.jitter || 0) * 1000
                };
                if (!this.previous) {
                    this.previous = current;
                    return;
                }

                const received = Math.max(0, current.received - this.previous.received);
                const lost = Math.max(0, current.lost - this.previous.lost);
                const loss = received + lost > 0 ? lost / (received + lost) : 0;
                this.previous = current;
                const decision = qualityDecision(this.profile, this.badSamples, this.goodSamples, loss, current.jitter, rtt);
                this.badSamples = decision.badSamples;
                this.goodSamples = decision.goodSamples;
                if (decision.profile !== this.profile) {
                    this.profile = decision.profile;
                    await this.apply();
                }
            } catch (error) {
                this.disabled = true;
                this.stop();
                log('Stats adaptation disabled for one peer', error);
            }
        }

        async apply() {
            if (!this.record.sender || !this.record.sender.getParameters || !this.record.sender.setParameters) {
                return;
            }

            const bitrates = { high: 32000, balanced: 24000, low: 16000 };
            try {
                const params = this.record.sender.getParameters();
                if (!params.encodings || !params.encodings.length) {
                    params.encodings = [{}];
                }
                params.encodings[0].maxBitrate = bitrates[this.profile];
                await this.record.sender.setParameters(params);
            } catch (error) {
                this.disabled = true;
                this.stop();
                log('Browser rejected an optional bitrate cap', error);
            }
        }
    }

    class PeerManager {
        constructor(owner, localId, stream, iceServers, participants) {
            this.owner = owner;
            this.localId = localId;
            this.stream = stream;
            this.iceServers = iceServers;
            this.roomSize = (participants || []).length + 1;
            this.participants = new Map();
            this.peers = new Map();
            (participants || []).forEach((participant) => this.participants.set(participant.participantId, participant));
        }

        updateLocalId(id) {
            this.localId = id;
        }

        async updateIceServers() {
            this.iceServers = await this.owner.getIceServers();
            this.peers.forEach((record) => {
                try {
                    record.pc.setConfiguration({ iceServers: this.iceServers });
                } catch (error) {
                    log('ICE configuration refresh was not supported', error);
                }
            });
        }

        reconcile(participants, initiateMissing) {
            this.roomSize = (participants || []).length + 1;
            const expected = new Set();
            (participants || []).forEach((participant) => {
                expected.add(participant.participantId);
                this.participants.set(participant.participantId, participant);
                if (!this.peers.has(participant.participantId)) {
                    this.ensure(participant.participantId, initiateMissing);
                }
            });
            Array.from(this.peers.keys()).forEach((id) => {
                if (!expected.has(id)) {
                    this.remove(id);
                }
            });
            if (this.roomSize >= 9) {
                this.peers.forEach((record) => {
                    if (record.quality.profile === 'high') {
                        record.quality.profile = 'balanced';
                        record.quality.apply();
                    }
                });
            }
            this.owner.renderParticipants();
        }

        ensure(id, initiate) {
            if (!id || id === this.localId || this.peers.has(id)) {
                return this.peers.get(id);
            }

            const audio = document.createElement('audio');
            audio.autoplay = true;
            audio.playsInline = true;
            audio.style.display = 'none';
            document.body.appendChild(audio);
            const record = { id: id, audio: audio, retry: 0, reconnectTimer: 0, quality: null };
            this.peers.set(id, record);
            this.build(record, initiate);
            return record;
        }

        build(record, initiate) {
            const pc = new RTCPeerConnection({ iceServers: this.iceServers });
            record.pc = pc;
            record.pendingIce = [];
            record.makingOffer = false;
            record.ignoreOffer = false;
            record.polite = this.localId > record.id;
            record.canOffer = !!initiate;
            record.sender = pc.addTrack(this.stream.getAudioTracks()[0], this.stream);
            this.preferOpus(pc);

            pc.onicecandidate = (event) => this.owner.sendSignal(record.id, 'ice-candidate', event.candidate ? event.candidate.toJSON() : null);
            pc.ontrack = (event) => {
                record.audio.srcObject = event.streams[0] || new MediaStream([event.track]);
                record.audio.play().catch(function () { /* Autoplay was unlocked by Join Voice. */ });
            };
            pc.onnegotiationneeded = async () => {
                if (record.canOffer) {
                    await this.negotiate(record, false);
                }
            };
            pc.onconnectionstatechange = () => this.onConnectionState(record);
            pc.oniceconnectionstatechange = () => this.onConnectionState(record);
            record.quality = new VoiceQualityManager(record, this.roomSize);
        }

        preferOpus(pc) {
            try {
                if (!window.RTCRtpReceiver || !RTCRtpReceiver.getCapabilities) {
                    return;
                }
                const codecs = RTCRtpReceiver.getCapabilities('audio').codecs || [];
                const sorted = codecs.slice().sort(function (left, right) {
                    return /opus/i.test(right.mimeType) - /opus/i.test(left.mimeType);
                });
                const transceiver = pc.getTransceivers().find((item) => item.sender && item.sender.track && item.sender.track.kind === 'audio');
                if (transceiver && transceiver.setCodecPreferences) {
                    transceiver.setCodecPreferences(sorted);
                }
            } catch (error) {
                log('Optional Opus preference was not supported', error);
            }
        }

        async negotiate(record, iceRestart) {
            if (!record || record.makingOffer || !record.canOffer || !navigator.onLine) {
                return;
            }
            try {
                record.makingOffer = true;
                const offer = await record.pc.createOffer(iceRestart ? { iceRestart: true } : undefined);
                await record.pc.setLocalDescription(offer);
                await this.owner.sendSignal(record.id, iceRestart ? 'ice-restart' : 'offer', record.pc.localDescription);
            } catch (error) {
                log('Negotiation failed for one peer', error);
            } finally {
                record.makingOffer = false;
            }
        }

        async handle(event) {
            const id = event.senderParticipantId;
            if (event.type === 'peer-left') {
                this.remove(id);
                return;
            }
            if (event.type === 'peer-joined') {
                this.participants.set(id, event.payload);
                this.ensure(id, false);
                this.owner.renderParticipants();
                return;
            }

            const record = this.ensure(id, false);
            if (!record) {
                return;
            }
            try {
                if (event.type === 'ice-candidate') {
                    if (event.payload === null) {
                        if (record.pc.remoteDescription) {
                            await record.pc.addIceCandidate(null);
                        } else {
                            record.pendingIce.push(null);
                        }
                    } else if (record.pc.remoteDescription) {
                        await record.pc.addIceCandidate(event.payload);
                    } else {
                        record.pendingIce.push(event.payload);
                    }
                    return;
                }

                const description = event.payload;
                const isOffer = description && description.type === 'offer';
                const collision = isOffer && (record.makingOffer || record.pc.signalingState !== 'stable');
                record.ignoreOffer = !record.polite && collision;
                if (record.ignoreOffer) {
                    return;
                }
                await record.pc.setRemoteDescription(description);
                while (record.pendingIce.length) {
                    await record.pc.addIceCandidate(record.pendingIce.shift());
                }
                if (isOffer) {
                    record.canOffer = true;
                    await record.pc.setLocalDescription(await record.pc.createAnswer());
                    await this.owner.sendSignal(id, 'answer', record.pc.localDescription);
                }
            } catch (error) {
                if (!record.ignoreOffer) {
                    log('Signal handling failed for one peer', error);
                }
            }
        }

        onConnectionState(record) {
            const state = record.pc.connectionState || record.pc.iceConnectionState;
            if (state === 'connected' || state === 'completed') {
                window.clearTimeout(record.reconnectTimer);
                record.retry = 0;
                this.owner.renderParticipants();
                return;
            }
            if (state !== 'disconnected' && state !== 'failed') {
                return;
            }
            this.owner.renderParticipants();
            window.clearTimeout(record.reconnectTimer);
            const delay = state === 'failed' ? 0 : 4000;
            record.reconnectTimer = window.setTimeout(() => this.recover(record), delay);
        }

        async recover(record) {
            if (!this.peers.has(record.id) || !navigator.onLine) {
                return;
            }
            if (this.localId > record.id && record.retry === 0) {
                record.retry = 1;
                record.reconnectTimer = window.setTimeout(() => this.recover(record), 15000 + Math.random() * 500);
                return;
            }
            try {
                if (record.retry === 2) {
                    await this.updateIceServers();
                }
                if (record.retry < 4 && record.pc.restartIce) {
                    record.pc.restartIce();
                    record.canOffer = true;
                    await this.negotiate(record, true);
                } else {
                    this.rebuild(record);
                }
            } finally {
                const delay = peerBackoff[Math.min(record.retry, peerBackoff.length - 1)];
                record.retry += 1;
                window.clearTimeout(record.reconnectTimer);
                record.reconnectTimer = window.setTimeout(() => {
                    if (record.pc.connectionState !== 'connected') {
                        this.recover(record);
                    }
                }, delay + Math.random() * 500);
            }
        }

        rebuild(record) {
            record.quality.stop();
            record.pc.close();
            record.audio.srcObject = null;
            this.build(record, this.localId < record.id);
        }

        remove(id) {
            const record = this.peers.get(id);
            if (!record) {
                return;
            }
            window.clearTimeout(record.reconnectTimer);
            record.quality.stop();
            record.pc.close();
            record.audio.srcObject = null;
            record.audio.remove();
            this.peers.delete(id);
            this.participants.delete(id);
            this.owner.renderParticipants();
        }

        close() {
            Array.from(this.peers.keys()).forEach((id) => this.remove(id));
        }
    }

    class VoiceManager {
        constructor() {
            this.state = 'DISCONNECTED';
            this.sessionId = '';
            this.joinedGroupId = '';
            this.participant = null;
            this.stream = null;
            this.peers = null;
            this.cursor = 0;
            this.heartbeatTimer = 0;
            this.pollController = null;
            this.signalRetry = 0;
            this.stopped = false;
            this.createUi();
            window.addEventListener('syncplaychatcontext', (event) => this.onContext(event.detail));
            window.addEventListener('offline', () => this.setStatus('Reconnecting…'));
            window.addEventListener('online', () => this.recoverSignaling());
            window.addEventListener('beforeunload', () => this.cleanup(false));
            const context = window.SyncPlayChatBridge && window.SyncPlayChatBridge.getContext();
            if (context) {
                this.onContext(context);
            }
        }

        createUi() {
            let host = document.getElementById(hostId);
            if (!host) {
                host = document.createElement('div');
                host.id = hostId;
                Object.assign(host.style, { position: 'fixed', right: '1rem', bottom: '1rem', zIndex: '99999', display: 'flex', alignItems: 'flex-end', gap: '0.5rem' });
                document.body.appendChild(host);
            }
            const button = document.createElement('button');
            button.id = buttonId;
            button.type = 'button';
            button.className = 'emby-button';
            button.textContent = '🎙 Join Voice';
            button.setAttribute('aria-label', 'Join SyncPlay voice chat');
            Object.assign(button.style, { display: 'none', padding: '0.48rem 0.92rem', borderRadius: '0.6rem', background: 'rgba(0,0,0,.7)', color: '#fff', border: '1px solid rgba(255,255,255,.25)', cursor: 'pointer', whiteSpace: 'nowrap' });
            button.addEventListener('click', (event) => {
                event.preventDefault();
                event.stopPropagation();
                this.join();
            });

            const panel = document.createElement('div');
            panel.id = panelId;
            Object.assign(panel.style, { display: 'none', position: 'fixed', right: 'max(.5rem, env(safe-area-inset-right))', bottom: '4.25rem', width: 'min(18rem, calc(100vw - 1rem))', maxHeight: '55dvh', overflowY: 'auto', boxSizing: 'border-box', padding: '0.7rem', borderRadius: '0.7rem', background: 'rgba(16,16,16,.96)', color: '#fff', border: '1px solid rgba(255,255,255,.25)', boxShadow: '0 .5rem 2rem rgba(0,0,0,.45)' });
            panel.innerHTML = '<div style="font-weight:600;margin-bottom:.35rem">Voice <span data-voice-status style="font-weight:400;font-size:.8rem"></span></div>' +
                '<div data-voice-participants style="margin-bottom:.55rem"></div>' +
                '<div data-voice-error role="status" style="display:none;color:#ffd0d0;font-size:.8rem;margin-bottom:.45rem"></div>' +
                '<div data-voice-actions style="display:flex;gap:.45rem">' +
                '<button type="button" data-voice-mute style="appearance:none;flex:1;padding:.55rem .7rem;border-radius:.5rem;background:rgba(255,255,255,.14);color:#fff;border:1px solid rgba(255,255,255,.25);font:inherit;cursor:pointer">🔇 Mute</button>' +
                '<button type="button" data-voice-leave style="appearance:none;flex:1;padding:.55rem .7rem;border-radius:.5rem;background:rgba(255,255,255,.14);color:#fff;border:1px solid rgba(255,255,255,.25);font:inherit;cursor:pointer">🚪 Leave voice</button>' +
                '</div>';
            panel.querySelector('[data-voice-mute]').addEventListener('click', (event) => {
                event.preventDefault();
                event.stopPropagation();
                this.toggleMute();
            });
            panel.querySelector('[data-voice-leave]').addEventListener('click', (event) => {
                event.preventDefault();
                event.stopPropagation();
                this.leave();
            });
            host.appendChild(panel);
            host.appendChild(button);
            this.button = button;
            this.panel = panel;
        }

        onContext(context) {
            const previousSession = this.sessionId;
            this.sessionId = context && context.sessionId || '';
            if (!isSecureVoicePage()) {
                this.button.style.display = 'none';
                this.panel.style.display = 'none';
                return;
            }
            this.button.style.display = context && context.inGroup && this.state === 'DISCONNECTED' ? 'inline-flex' : 'none';
            if (this.state !== 'DISCONNECTED' && (!context.inGroup
                || (previousSession && previousSession !== this.sessionId)
                || (this.joinedGroupId && context.groupId && this.joinedGroupId !== normalizeId(context.groupId)))) {
                this.leave();
            }
        }

        async join() {
            if (this.state !== 'DISCONNECTED') {
                return;
            }
            if (!window.isSecureContext) {
                this.showError('Voice chat requires HTTPS.');
                return;
            }
            if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || !window.RTCPeerConnection) {
                this.showError("Voice chat isn't supported by this client. Try Jellyfin in your browser.");
                return;
            }

            this.stopped = false;
            this.state = 'REQUESTING_MIC';
            this.button.disabled = true;
            try {
                const eligibility = await api('SyncPlayChat/Voice/Eligibility?sessionId=' + encodeURIComponent(this.sessionId));
                try {
                    this.stream = await navigator.mediaDevices.getUserMedia({
                        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: { ideal: 1 } },
                        video: false
                    });
                } catch (constraintError) {
                    if (constraintError.name !== 'OverconstrainedError' && constraintError.name !== 'TypeError') {
                        throw constraintError;
                    }
                    this.stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
                }
                this.state = 'JOINING';
                const joined = await api('SyncPlayChat/Voice/Join', 'POST', { SessionId: this.sessionId });
                this.participant = joined.participant;
                this.joinedGroupId = normalizeId(joined.groupId || eligibility.groupId);
                this.cursor = joined.cursor || 0;
                const iceServers = await this.getIceServers();
                this.peers = new PeerManager(this, this.participant.participantId, this.stream, iceServers, joined.participants);
                this.peers.reconcile(joined.participants, true);
                this.state = 'CONNECTED';
                this.button.style.display = 'none';
                this.panel.style.display = 'block';
                this.panel.querySelector('[data-voice-mute]').style.display = 'block';
                this.panel.querySelector('[data-voice-leave]').textContent = '🚪 Leave voice';
                this.setStatus('Connected');
                this.renderParticipants();
                this.heartbeatTimer = window.setInterval(() => this.heartbeat(), heartbeatMs);
                this.pollEvents();
            } catch (error) {
                await this.cleanup(true);
                this.showError(error.name === 'NotAllowedError' ? 'Microphone permission was denied.' : error.message);
            } finally {
                this.button.disabled = false;
            }
        }

        async getIceServers() {
            return api('SyncPlayChat/Voice/IceConfiguration?sessionId=' + encodeURIComponent(this.sessionId));
        }

        async sendSignal(targetId, type, payload) {
            if (this.state === 'DISCONNECTED' || !this.participant) {
                return;
            }
            try {
                await api('SyncPlayChat/Voice/Signal', 'POST', {
                    SessionId: this.sessionId,
                    ParticipantId: this.participant.participantId,
                    TargetParticipantId: targetId,
                    Type: type,
                    Payload: payload
                });
            } catch (error) {
                log('Signal send failed; healthy media remains active', error);
            }
        }

        async pollEvents() {
            while (!this.stopped && this.participant) {
                if (!navigator.onLine) {
                    await sleep(1000);
                    continue;
                }
                this.pollController = new AbortController();
                try {
                    const events = await api('SyncPlayChat/Voice/Events?sessionId=' + encodeURIComponent(this.sessionId) +
                        '&participantId=' + encodeURIComponent(this.participant.participantId) + '&cursor=' + this.cursor,
                    'GET', undefined, this.pollController.signal);
                    this.signalRetry = 0;
                    for (const event of events || []) {
                        this.cursor = Math.max(this.cursor, event.eventId || 0);
                        await this.peers.handle(event);
                    }
                    if (this.state === 'RECONNECTING') {
                        this.state = 'CONNECTED';
                        this.setStatus('Connected');
                    }
                } catch (error) {
                    if (this.stopped || error.name === 'AbortError') {
                        return;
                    }
                    this.state = 'RECONNECTING';
                    this.setStatus('Reconnecting…');
                    const delay = signalBackoff[Math.min(this.signalRetry++, signalBackoff.length - 1)];
                    await sleep(delay);
                    await this.recoverSignaling();
                }
            }
        }

        async heartbeat() {
            if (!this.participant || this.stopped) {
                return;
            }
            try {
                const participants = await api('SyncPlayChat/Voice/Heartbeat', 'POST', {
                    SessionId: this.sessionId,
                    ParticipantId: this.participant.participantId
                });
                this.peers.reconcile(participants.filter((item) => item.participantId !== this.participant.participantId), false);
            } catch (error) {
                log('Heartbeat failed; healthy media remains active', error);
                if (error.status === 409) {
                    await this.recoverSignaling();
                }
            }
        }

        async recoverSignaling() {
            if (this.stopped || !this.stream || !navigator.onLine || !this.participant) {
                return;
            }
            try {
                const eligibility = await api('SyncPlayChat/Voice/Eligibility?sessionId=' + encodeURIComponent(this.sessionId));
                if (this.joinedGroupId && normalizeId(eligibility.groupId) !== this.joinedGroupId) {
                    await this.cleanup(true);
                    return;
                }
                const joined = await api('SyncPlayChat/Voice/Join', 'POST', { SessionId: this.sessionId });
                this.participant = joined.participant;
                this.joinedGroupId = normalizeId(joined.groupId);
                this.cursor = joined.cursor || this.cursor;
                this.peers.updateLocalId(this.participant.participantId);
                this.peers.reconcile(joined.participants, true);
                this.signalRetry = 0;
                this.state = 'CONNECTED';
                this.setStatus('Connected');
            } catch (error) {
                log('Signaling recovery will retry', error);
                if (error.status === 409) {
                    await this.cleanup(false);
                    this.showError(error.message);
                }
            }
        }

        toggleMute() {
            const track = this.stream && this.stream.getAudioTracks()[0];
            if (!track) {
                return;
            }
            track.enabled = !track.enabled;
            this.panel.querySelector('[data-voice-mute]').textContent = track.enabled ? '🔇 Mute' : '🎙 Unmute';
        }

        async leave() {
            await this.cleanup(true);
        }

        async cleanup(notifyServer) {
            if (this.state === 'DISCONNECTED' && !this.stream) {
                this.panel.style.display = 'none';
                return;
            }
            const sessionId = this.sessionId;
            this.stopped = true;
            window.clearInterval(this.heartbeatTimer);
            if (this.pollController) {
                this.pollController.abort();
            }
            if (this.peers) {
                this.peers.close();
            }
            if (this.stream) {
                this.stream.getTracks().forEach(function (track) { track.stop(); });
            }
            this.peers = null;
            this.stream = null;
            this.participant = null;
            this.joinedGroupId = '';
            this.cursor = 0;
            this.state = 'DISCONNECTED';
            this.panel.style.display = 'none';
            const context = window.SyncPlayChatBridge && window.SyncPlayChatBridge.getContext();
            this.button.style.display = isSecureVoicePage() && context && context.inGroup ? 'inline-flex' : 'none';
            if (notifyServer && sessionId) {
                try {
                    await api('SyncPlayChat/Voice/Leave', 'POST', { SessionId: sessionId });
                } catch (error) {
                    log('Voice leave will be completed by heartbeat expiry', error);
                }
            }
        }

        renderParticipants() {
            if (!this.participant || !this.peers) {
                return;
            }
            const rows = [{ name: this.participant.displayName, reconnecting: false }];
            this.peers.participants.forEach((participant, id) => {
                const peer = this.peers.peers.get(id);
                const state = peer && (peer.pc.connectionState || peer.pc.iceConnectionState);
                rows.push({ name: participant.displayName, reconnecting: state === 'disconnected' || state === 'failed' });
            });
            const container = this.panel.querySelector('[data-voice-participants]');
            container.replaceChildren();
            rows.forEach(function (row) {
                const item = document.createElement('div');
                item.textContent = (row.reconnecting ? '◌ ' : '● ') + row.name + (row.reconnecting ? ' — reconnecting' : '');
                item.style.opacity = row.reconnecting ? '0.75' : '1';
                container.appendChild(item);
            });
        }

        setStatus(text) {
            this.panel.querySelector('[data-voice-status]').textContent = '🎙 ' + text;
        }

        showError(message) {
            const target = this.panel.querySelector('[data-voice-error]');
            target.textContent = message || 'Voice chat could not start.';
            target.style.display = 'block';
            this.panel.querySelector('[data-voice-mute]').style.display = 'none';
            this.panel.querySelector('[data-voice-leave]').textContent = 'Close';
            this.panel.style.display = 'block';
            window.setTimeout(function () { target.style.display = 'none'; }, 8000);
        }
    }

    if (window.__SYNCPLAYVOICE_TEST__) {
        window.__SyncPlayVoiceTest = { qualityDecision: qualityDecision, PeerManager: PeerManager, getAuthHeaders: getAuthHeaders };
        return;
    }

    function start() {
        if (!document.body || window.__syncPlayVoiceLoaded) {
            return;
        }
        window.__syncPlayVoiceLoaded = true;
        window.SyncPlayVoice = new VoiceManager();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', start, { once: true });
    } else {
        start();
    }
})();
