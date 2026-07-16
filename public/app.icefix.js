// ICE FIX PATCH: queue ICE candidates until remoteDescription is set.
// Must be loaded AFTER /app.js so it can reuse the already-created `socket` and other globals.

(function () {
  // Reuse the socket from app.js (do NOT redeclare `const socket = ...`).
  const _socket = window.socket || (typeof io === 'function' ? io() : null);
  if (!_socket) {
    console.warn('[ICEFIX] socket not found; patch not applied');
    return;
  }

  // If app.js didn't expose these, patch won't work.
  if (!window.RTCPeerConnection) return;

  const pendingIceCandidates = {}; // peerId -> [RTCIceCandidate]

  function getPeer(peerId) {
    return window.peers && window.peers[peerId] ? window.peers[peerId] : null;
  }

  function queueIce(peerId, candidate) {
    if (!pendingIceCandidates[peerId]) pendingIceCandidates[peerId] = [];
    pendingIceCandidates[peerId].push(candidate);
  }

  function flushIce(peerId) {
    const peer = getPeer(peerId);
    const q = pendingIceCandidates[peerId];
    if (!peer || !peer.remoteDescription || !q || !q.length) return;

    while (q.length) {
      const cand = q.shift();
      peer.addIceCandidate(cand).catch(() => {});
    }
  }

  // Wrap existing peer setRemoteDescription by hooking answer/offer handlers.
  // Easiest/robust: override socket handlers to queue candidates until remoteDescription exists.

  _socket.off && _socket.off('ice-candidate');

  _socket.on('ice-candidate', async ({ candidate, from }) => {
    if (!candidate) return;

    const peer = getPeer(from);
    if (!peer) {
      queueIce(from, candidate);
      return;
    }

    if (!peer.remoteDescription) {
      queueIce(from, candidate);
      return;
    }

    try {
      await peer.addIceCandidate(candidate);
    } catch (e) {
      // queue again; remoteDescription may have been set just after the check
      queueIce(from, candidate);
      flushIce(from);
    }
  });

  // After we receive an offer/answer, remoteDescription should now exist.
  // So we flush pending ICE for that peer.
  _socket.off && _socket.off('offer');
  _socket.off && _socket.off('answer');

  _socket.on('offer', async ({ offer, from, firstname }) => {
    // Use existing logic in app.js by calling through to its peer code.
    // We can’t call app.js’ handler directly, so we just apply remoteDescription+answer here safely.
    // This assumes createPeer exists globally.
    const peer = getPeer(from) || (window.createPeer ? window.createPeer(from) : null);
    if (!peer) {
      // If peer isn't ready yet, queue ICE; remoteDescription will be set when peer exists.
      return;
    }

    await peer.setRemoteDescription(offer);
    const answer = await peer.createAnswer();
    await peer.setLocalDescription(answer);

    // Emit answer using app.js socket
    _socket.emit('answer', {
      roomId: window.roomId,
      to: from,
      from: window.myId,
      answer
    });

    if (firstname) {
      window.peerNames = window.peerNames || {};
      window.peerNames[from] = firstname;
    }

    flushIce(from);
  });

  _socket.on('answer', async ({ answer, from }) => {
    const peer = getPeer(from);
    if (!peer) {
      return;
    }

    await peer.setRemoteDescription(answer);
    flushIce(from);
  });

})();

