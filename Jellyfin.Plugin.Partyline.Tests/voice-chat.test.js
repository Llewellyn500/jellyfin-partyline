'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const window = { __SYNCPLAYVOICE_TEST__: true, console, setTimeout, clearTimeout, setInterval, clearInterval };
const context = vm.createContext({ window, console, navigator: { onLine: true }, setTimeout, clearTimeout, setInterval, clearInterval, AbortController });
const source = fs.readFileSync(path.join(__dirname, '..', 'Jellyfin.Plugin.Partyline', 'Web', 'voice-chat.js'), 'utf8');
vm.runInContext(source, context, { filename: 'voice-chat.js' });

const decide = window.__SyncPlayVoiceTest.qualityDecision;
let state = { profile: 'high', badSamples: 0, goodSamples: 0 };

state = decide(state.profile, state.badSamples, state.goodSamples, 0.05, 40, 300);
assert.equal(state.profile, 'high');
state = decide(state.profile, state.badSamples, state.goodSamples, 0.05, 40, 300);
assert.equal(state.profile, 'balanced');
state = decide(state.profile, state.badSamples, state.goodSamples, 0.10, 90, 900);
state = decide(state.profile, state.badSamples, state.goodSamples, 0.10, 90, 900);
assert.equal(state.profile, 'low');

for (let i = 0; i < 4; i += 1) {
    state = decide(state.profile, state.badSamples, state.goodSamples, 0.01, 10, 80);
}
assert.equal(state.profile, 'low');
state = decide(state.profile, state.badSamples, state.goodSamples, 0.01, 10, 80);
assert.equal(state.profile, 'balanced');

let audioElements = 0;
let addedTracks = 0;
let restartCount = 0;
let offerCount = 0;
context.document = {
    body: { appendChild() {} },
    querySelectorAll() { return []; },
    createElement() {
        audioElements += 1;
        return { style: {}, play: async function () {}, remove() {}, srcObject: null };
    }
};
context.RTCPeerConnection = class {
    constructor() {
        this.connectionState = 'new';
        this.iceConnectionState = 'new';
        this.signalingState = 'stable';
    }
    addTrack() {
        addedTracks += 1;
        return { getParameters: function () { return { encodings: [{}] }; }, setParameters: async function () {} };
    }
    getTransceivers() { return []; }
    restartIce() { restartCount += 1; }
    async createOffer(options) {
        offerCount += 1;
        assert.equal(options.iceRestart, true);
        return { type: 'offer', sdp: 'test' };
    }
    async setLocalDescription(description) { this.localDescription = description; }
    close() { this.connectionState = 'closed'; }
};
const PeerManager = window.__SyncPlayVoiceTest.PeerManager;
let restartSignalCount = 0;
const owner = {
    renderParticipants() {},
    sendSignal: async function (id, type) {
        assert.equal(id, 'remote');
        assert.equal(type, 'ice-restart');
        restartSignalCount += 1;
    },
    getIceServers: async function () { return []; }
};
const stream = { getAudioTracks: function () { return [{ kind: 'audio' }]; } };
const peers = new PeerManager(owner, 'local', stream, [], []);
const firstPeer = peers.ensure('remote', true);
const duplicatePeer = peers.ensure('remote', true);
assert.equal(firstPeer, duplicatePeer);
assert.equal(peers.peers.size, 1);
assert.equal(audioElements, 1);
assert.equal(addedTracks, 1);
peers.updateLocalId('z-local');
assert.equal(firstPeer.polite, true);
const restartPromise = peers.restartConnections();
assert.equal(restartCount, 1);
assert.equal(offerCount, 1);

const isCompactMode = window.__SyncPlayVoiceTest.isCompactMode;
context.document.querySelectorAll = () => [{ paused: false, ended: false, __syncPlayVoiceAudio: true }];
assert.equal(isCompactMode(), false);
context.document.querySelectorAll = () => [{ paused: false, ended: false }];
assert.equal(isCompactMode(), true);

const getAuthHeaders = window.__SyncPlayVoiceTest.getAuthHeaders;
assert.equal(Object.keys(getAuthHeaders()).length, 0);

window.ApiClient = {
    accessToken: () => 'test-token-123',
    deviceId: () => 'dev-456',
    deviceName: () => 'TestDevice',
    appName: () => 'Jellyfin Web Test',
    appVersion: () => '10.10.1'
};

const headers = getAuthHeaders();
assert.equal(headers['X-Emby-Token'], 'test-token-123');
assert.equal(headers['X-MediaBrowser-Token'], 'test-token-123');
assert.equal(headers['Authorization'], 'MediaBrowser Client="Jellyfin Web Test", Device="TestDevice", DeviceId="dev-456", Version="10.10.1", Token="test-token-123"');
assert.equal(headers['X-Emby-Authorization'], 'MediaBrowser Client="Jellyfin Web Test", Device="TestDevice", DeviceId="dev-456", Version="10.10.1", Token="test-token-123"');

restartPromise.then(() => {
    assert.equal(restartSignalCount, 1);
    peers.close();
    console.log('voice quality hysteresis, duplicate-peer, reconnect, and auth header checks passed');
}).catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
