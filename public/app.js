const socket = io();

let stream = null;
let roomId = null;
let videoTrack;
let audioTrack;
let audioContext;
let analyser;
let dataArray;

let peers = {};
let peerNames = {};

let activeRoom = null;
let pendingUsers = [];

const localVideo = document.getElementById("local");

let currentUser = null;
let myId = null;


// SESSION
fetch("/session")
    .then(res => res.json())
    .then(data => {

        if (!data.logged) {
            location.href = "/login.html";
            return;
        }

        initUser(data);
    });

function initUser(data) {

    currentUser = data.user;
    myId = currentUser.token;

    socket.emit("register", {
        token: currentUser.token,
        firstname: currentUser.firstname,
        lastname: currentUser.lastname,
        acc_type: currentUser.acc_type
    });

    setupUI();

    // 🔥 AUTO REJOIN IF REFRESHED
    socket.emit("check-active-meeting");
}


// UI
function setupUI() {

    if (currentUser.acc_type === "employee") {
        document.querySelector(".actions").style.display = "none";
    }
}


// CAMERA
window.onload = async () => {
    await ensureMediaReady();
};

async function ensureMediaReady(attempt = 0) {

    try {
        if (stream) return true;

        stream = await navigator.mediaDevices.getUserMedia({
            video: true,
            audio: true
        });

        localVideo.srcObject = stream;

        videoTrack = stream.getVideoTracks()[0];
        audioTrack = stream.getAudioTracks()[0];

        setupMicLevel();

        console.log("[MEDIA] initialized");

        return true;

    } catch (err) {

        console.log("[MEDIA] failed attempt:", attempt);

        if (attempt < 10) {
            setTimeout(() => ensureMediaReady(attempt + 1), 1000);
        } else {
            alert("Camera/Mic failed. Please allow permissions.");
        }

        return false;
    }
}


// MIC LEVEL
function setupMicLevel() {

    audioContext = new AudioContext();
    const source = audioContext.createMediaStreamSource(stream);

    analyser = audioContext.createAnalyser();
    analyser.fftSize = 64;

    source.connect(analyser);

    dataArray = new Uint8Array(analyser.frequencyBinCount);

    updateMicLevel();
}

function updateMicLevel() {

    requestAnimationFrame(updateMicLevel);

    analyser.getByteFrequencyData(dataArray);

    let avg = dataArray.reduce((a, b) => a + b, 0) / dataArray.length;

    const box = document.getElementById("localBox");
    const bars = document.querySelectorAll(".mic-level .bar");

    if (avg > 10) box.classList.add("mic-active");
    else box.classList.remove("mic-active");

    let level = Math.min(5, Math.floor(avg / 20));

    bars.forEach((bar, i) => {
        bar.style.height = i < level ? (6 + i * 3) + "px" : "4px";
    });
}


// ROOM EVENTS
function createRoomNow() {

    socket.emit("create-room", {
        admin: currentUser.firstname
    });
}

function startMeeting() {

    socket.emit("create-room", {
        admin: currentUser.firstname
    });
}


// JOIN SYSTEM
socket.on("meeting-started", async (data) => {

    roomId = data.roomId;
    activeRoom = roomId;

    // GUARANTEE MEDIA BEFORE JOIN
    if (!stream) {
        await ensureMediaReady();
    }

    socket.emit("join-room", {
        roomId,
        userId: myId
    });
});

function joinRoomNow() {

    const token = document.getElementById("roomToken").value.trim();

    roomId = token;

    socket.emit("join-room", {
        roomId,
        userId: myId
    });
}

function endMeeting() {

    if (!roomId) return;

    socket.emit("end-meeting", {
        roomId,
        adminToken: myId
    });
}

socket.on("meeting-ended", () => {

    alert("Meeting has ended");

    roomId = null;
    activeRoom = null;

    for (let id in peers) {
        peers[id].close();
    }

    peers = {};
    peerNames = {};

    document.getElementById("videos").innerHTML = "";

    // RESET MEDIA (IMPORTANT FIX)
    if (stream) {
        stream.getTracks().forEach(t => t.stop());
        stream = null;
        videoTrack = null;
        audioTrack = null;
    }

    // AUTO RESTART CAMERA (optional but requested behavior)
    setTimeout(() => ensureMediaReady(), 1000);
});

// USERS SYNC
socket.on("user-joined-room", (user) => {

    if (user.id === myId) return;

    peerNames[user.id] = user.firstname;

    createPeer(user.id);
});

// FIXED EXISTING USERS
socket.on("existing-users", (users) => {

    if (!stream) {
        pendingUsers.push(users);
        return;
    }

    processUsers(users);
});

async function processUsers(users) {

    for (let user of users) {

        if (user.id === myId) continue;

        peerNames[user.id] = user.firstname;

        const peer = createPeer(user.id);

        const offer = await peer.createOffer();
        await peer.setLocalDescription(offer);

        socket.emit("offer", {
            roomId,
            to: user.id,
            from: myId,
            offer,
            firstname: user.firstname
        });
    }
}

// PEER CREATION
function createPeer(userId) {

    if (!stream) {
        console.warn("Stream not ready, retry later");
        setTimeout(() => createPeer(userId), 1000);
        return null;
    }

    if (peers[userId]) return peers[userId];

    const peer = new RTCPeerConnection({
        iceServers: [{ urls: "stun:stun.l.google.com:19302" }]
    });

    stream.getTracks().forEach(track => {
        peer.addTrack(track, stream);
    });

    peer.ontrack = (event) => {
        addRemoteVideo(userId, event.streams[0], peerNames[userId]);
    };

    peer.onicecandidate = (event) => {
        if (event.candidate) {
            socket.emit("ice-candidate", {
                roomId,
                to: userId,
                from: myId,
                candidate: event.candidate
            });
        }
    };

    peers[userId] = peer;
    return peer;
}

// SIGNALING
socket.on("offer", async ({ offer, from, firstname }) => {

    let peer = peers[from] || createPeer(from);

    await peer.setRemoteDescription(offer);

    const answer = await peer.createAnswer();
    await peer.setLocalDescription(answer);

    socket.emit("answer", {
        roomId,
        to: from,
        from: myId,
        answer
    });

    // FORCE NAME SAVE HERE
    if (firstname) {
        peerNames[from] = firstname;
    }
});

socket.on("answer", async ({ answer, from }) => {

    const peer = peers[from];
    if (!peer) return;

    await peer.setRemoteDescription(answer);
});

socket.on("ice-candidate", async ({ candidate, from }) => {

    const peer = peers[from];
    if (!peer || !candidate) return;

    await peer.addIceCandidate(candidate);
});

// UI VIDEO
function addRemoteVideo(userId, stream, name) {

    let wrapper = document.getElementById("wrap-" + userId);

    if (!wrapper) {
        wrapper = document.createElement("div");
        wrapper.className = "video-box";
        wrapper.id = "wrap-" + userId;

        const video = document.createElement("video");
        video.id = userId;
        video.autoplay = true;
        video.playsInline = true;

        const tag = document.createElement("span");
        tag.className = "tag";

        // DIRECT NAME FIRST (no dependency sa peerNames)
        tag.innerText = name || peerNames[userId] || "User";

        wrapper.appendChild(video);
        wrapper.appendChild(tag);

        document.getElementById("videos").appendChild(wrapper);
    }

    document.getElementById(userId).srcObject = stream;
}

// CONTROLS
function toggleCamera() {
    videoTrack.enabled = !videoTrack.enabled;
}

function toggleMic() {
    audioTrack.enabled = !audioTrack.enabled;
}

// ERROR
socket.on("error", (msg) => {
    alert(msg);
});