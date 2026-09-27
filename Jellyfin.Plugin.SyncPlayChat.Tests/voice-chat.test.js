'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const window = { __SYNCPLAYVOICE_TEST__: true, console, setTimeout, clearTimeout, setInterval, clearInterval };
const context = vm.createContext({ window, console, navigator: { onLine: true }, setTimeout, clearTimeout, setInterval, clearInterval, AbortController });
const source = fs.readFileSync(path.join(__dirname, '..', 'Jellyfin.Plugin.SyncPlayChat', 'Web', 'voice-chat.js'), 'utf8');
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
context.document = {
    body: { appendChild() {} },
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
    close() { this.connectionState = 'closed'; }
};
const PeerManager = window.__SyncPlayVoiceTest.PeerManager;
const owner = { renderParticipants() {}, sendSignal: async function () {}, getIceServers: async function () { return []; } };
const stream = { getAudioTracks: function () { return [{ kind: 'audio' }]; } };
const peers = new PeerManager(owner, 'local', stream, [], []);
const firstPeer = peers.ensure('remote', true);
const duplicatePeer = peers.ensure('remote', true);
assert.equal(firstPeer, duplicatePeer);
assert.equal(peers.peers.size, 1);
assert.equal(audioElements, 1);
assert.equal(addedTracks, 1);
peers.close();

console.log('voice quality hysteresis and duplicate-peer checks passed');
