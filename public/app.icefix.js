// ICE FIX PATCH: add ICE candidate queueing and signaling safety
// Drop-in replacement: include this file AFTER socket.io and BEFORE using functions.
// This file patches the existing public/app.js behavior by overwriting the signaling handlers and createPeer.

// reuse existing socket from app.js to avoid redeclaration
const _socket = window.socket || io();

// Ensure we don't reference a non-existent `socket` variable
const socket = _socket;


// ===== Helpers for ICE queueing =====
const pendingIceCandidates = {}; // peerId -> [candidate]
const pendingAnswers = {}; // peerId -> [answer]
const pendingRemoteOffers = {}; // peerId -> [offer]

function ensurePeer(peerId, createFn) {
  if (window.peers && window.peers[peerId]) return window.peers[peerId];
  const p = createFn(peerId);
  if (!p) return null;
  window.peers = window.peers || {};
  window.peers[peerId] = p;
  return p;
}

function flushIce(peerId, peer) {
  const q = pendingIceCandidates[peerId];
  if (!q || !q.length) return;
  if (!peer || !peer.remoteDescription) return;

  while (q.length) {
    const cand = q.shift();
    peer.addIceCandidate(cand).catch(() => {
      // ignore individual candidate errors
    });
  }
}

function flushAnswers(peerId, peer) {
  const q = pendingAnswers[peerId];
  if (!q || !q.length) return;
  if (!peer || !peer.remoteDescription) {
    // answers require local offer to be set and then remote description to be applied
  }

  while (q.length) {
    const ans = q.shift();
    peer.setRemoteDescription(ans).catch(() => {});
  }
}

// ===== Overwrite createPeer (safety: never null) =====
const oldCreatePeer = window.createPeer;

window.createPeer = function createPeer(userId) {
  // If stream isn't ready, retry and return a placeholder later.
  // We must not return null to avoid crashes in offer handler.
  if (!window.stream) {
    console.warn("[ICEFIX] stream not ready for", userId);
    setTimeout(() => {
      try {
        if (!window.peers) window.peers = {};
        if (!window.peers[userId]) window.peers[userId] = oldCreatePeer ? oldCreatePeer(userId) : null;
      } catch (e) {}
    }, 1000);
    return null;
  }

  if (window.peers && window.peers[userId]) return window.peers[userId];
  const p = oldCreatePeer ? oldCreatePeer(userId) : null;
  if (!p) return null;
  window.peers = window.peers || {};
  window.peers[userId] = p;
  return p;
};

// ===== Patch signaling handlers =====
// Remove previous handlers if any (best-effort). Socket.IO doesn't expose handler removal cleanly,
// so we just re-register with same event names; your old ones may still run.
// To avoid double-processing, we guard with flags.

const processedOfferIds = new Set();

_socket.off && _socket.off("offer");
_socket.off && _socket.off("answer");
_socket.off && _socket.off("ice-candidate");

_socket.on("offer", async ({ offer, from, firstname }) => {
  // Queue offer if peer cannot be created yet
  const peer = (window.peers && window.peers[from]) ? window.peers[from] : (window.createPeer ? window.createPeer(from) : null);

  if (!peer) {
    pendingRemoteOffers[from] = pendingRemoteOffers[from] || [];
    pendingRemoteOffers[from].push({ offer, firstname });
    setTimeout(() => {
      const p = window.peers && window.peers[from] ? window.peers[from] : (window.createPeer ? window.createPeer(from) : null);
      if (!p) return;
      const q = pendingRemoteOffers[from] || [];
      while (q.length) {
        const item = q.shift();
        p.setRemoteDescription(item.offer).then(async () => {
          const answer = await p.createAnswer();
          await p.setLocalDescription(answer);
          socket.emit("answer", {
            roomId: window.roomId,
            to: from,
            from: window.myId,
            answer
          });
          if (item.firstname) {
            window.peerNames = window.peerNames || {};
            window.peerNames[from] = item.firstname;
          }
        }).catch(() => {});
      }
    }, 1200);
    return;
  }

  try {
    await peer.setRemoteDescription(offer);
    const answer = await peer.createAnswer();
    await peer.setLocalDescription(answer);

    socket.emit("answer", {
      roomId: window.roomId,
      to: from,
      from: window.myId,
      answer
    });

    if (firstname) {
      window.peerNames = window.peerNames || {};
      window.peerNames[from] = firstname;
    }

    // Flush any queued ICE now
    flushIce(from, peer);
  } catch (e) {
    console.log("[ICEFIX] offer handling error", e);
  }
});

socket.on("answer", async ({ answer, from }) => {
  const peer = window.peers && window.peers[from] ? window.peers[from] : null;
  if (!peer) {
    pendingAnswers[from] = pendingAnswers[from] || [];
    pendingAnswers[from].push(answer);
    return;
  }

  // If local offer isn't applied yet, queue
  if (!peer.localDescription) {
    pendingAnswers[from] = pendingAnswers[from] || [];
    pendingAnswers[from].push(answer);
    return;
  }

  try {
    await peer.setRemoteDescription(answer);
    flushIce(from, peer);
    flushAnswers(from, peer);
  } catch (e) {
    // queue and retry once
    pendingAnswers[from] = pendingAnswers[from] || [];
    pendingAnswers[from].push(answer);
    setTimeout(() => {
      const p = window.peers && window.peers[from] ? window.peers[from] : null;
      if (!p) return;
      const q = pendingAnswers[from] || [];
      while (q.length) {
        const a = q.shift();
        p.setRemoteDescription(a).catch(() => {});
      }
      flushIce(from, p);
    }, 500);
  }
});

socket.on("ice-candidate", async ({ candidate, from }) => {
  if (!candidate) return;
  const peer = window.peers && window.peers[from] ? window.peers[from] : null;
  if (!peer) {
    pendingIceCandidates[from] = pendingIceCandidates[from] || [];
    pendingIceCandidates[from].push(candidate);
    return;
  }

  if (!peer.remoteDescription) {
    pendingIceCandidates[from] = pendingIceCandidates[from] || [];
    pendingIceCandidates[from].push(candidate);
    return;
  }

  try {
    await peer.addIceCandidate(candidate);
  } catch (e) {
    // queue and retry once
    pendingIceCandidates[from] = pendingIceCandidates[from] || [];
    pendingIceCandidates[from].push(candidate);
    flushIce(from, peer);
  }
});


