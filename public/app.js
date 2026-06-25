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
let userMediaStates = {};



async function loadUser() {

    const res = await fetch("/session");
    const data = await res.json();

    if (!data.logged) {
        location.href = "/auth";
        return;
    }

    document.getElementById("uname").textContent = `Hi, ${data.user.firstname}`;
}

loadUser();

// SESSION
fetch("/session")
    .then(res => res.json())
    .then(data => {

        if (!data.logged) {
            location.href = "/auth.html";
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

    setTimeout(() => {

        if (videoTrack && audioTrack) {
            socket.emit("media-status",
                {
                    camera: videoTrack.enabled,
                    mic: audioTrack.enabled
                }
            );
        }

    }, 1000);

    setupUI();

}

// UI
function setupUI() {

    if (currentUser.acc_type === "employee") {
        document.querySelector(".actions").style.display = "none";
    }

    updateMeetingButtons(false);
}
// CAMERA
window.onload = async () => {
    await ensureMediaReady();

    socket.emit(
        "media-status",
        {
            camera:
                videoTrack.enabled,
            mic:
                audioTrack.enabled
        }
    );
};

async function ensureMediaReady(attempt = 0) {

    const loader =
        document.getElementById("localLoading");

    if (stream) {
        loader.style.display = "none";
        return true;
    }

    loader.style.display = "flex";

    try {

        stream =
            await navigator.mediaDevices.getUserMedia({
                video: true,
                audio: true
            });

        localVideo.srcObject = stream;

        videoTrack = stream.getVideoTracks()[0];
        audioTrack = stream.getAudioTracks()[0];

        setupMicLevel();

        loader.style.display = "none";

        return true;

    } catch (err) {

        console.log("[MEDIA] failed attempt:", attempt);

        if (attempt < 10) {
            setTimeout(
                () => ensureMediaReady(attempt + 1),
                1000
            );
        } else {

            loader.innerHTML = `
                <i class="fa-solid fa-triangle-exclamation"></i>
                <span>Camera Permission Denied</span>
            `;
        }

        return false;
    }
}

let pendingRequestToken = null;

socket.on("room-created", ({ roomId: newRoom }) => {

    roomId = newRoom;

    if (pendingRequestToken) {

        socket.emit("request-user", {
            roomId,
            token: pendingRequestToken
        });

        pendingRequestToken = null;
    }
});

function updateMeetingButtons(active) {

    const endBtn =
        document.getElementById("endBtn");

    endBtn.style.display =
        active
            ? "block"
            : "none";
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
        admin: currentUser.firstname,
        participants: getSelectedUsers()
    });
}

function startMeeting() {

    const participants =
        getSelectedUsers();

    if (participants.length === 0) {

        alert(
            "Please select at least one participant."
        );

        return;
    }

    socket.emit("create-room", {
        admin: currentUser.firstname,
        participants
    });
}


// JOIN SYSTEM
let joinedUsers = 0;

socket.on("meeting-started", async (data) => {

    roomId = data.roomId;
    activeRoom = roomId;

    if (currentUser.acc_type === "admin") {
        joinedUsers = 0;
        updateMeetingButtons(false);
    }

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

    roomId = null;
    activeRoom = null;

    if (currentUser.acc_type === "admin") {
        updateMeetingButtons(false);
    }

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

socket.on("user-disconnected", (userId) => {

    joinedUsers = Math.max(0, joinedUsers - 1);

    if (currentUser.acc_type === "admin") {
        updateMeetingButtons(joinedUsers > 0);
    }

    if (peers[userId]) {

        peers[userId].close();

        delete peers[userId];
    }

    delete peerNames[userId];
    delete userMediaStates[userId];

    const wrapper = document.getElementById(
        "wrap-" + userId
    );

    if (wrapper) {
        wrapper.remove();
    }
}
);

socket.on("user-joined-room", (user) => {

    if (currentUser.acc_type === "admin") {
        joinedUsers++;
        updateMeetingButtons(joinedUsers > 0);
    }

    peerNames[user.id] = user.firstname;

    userMediaStates[user.id] =
        user.media || {
            camera: true,
            mic: true
        };

    updateRemoteStatus(user.id);
});

socket.on("media-status-changed", ({ userId, camera, mic }) => {
    userMediaStates[userId] = {
        camera,
        mic
    };

    updateRemoteStatus(userId);
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

    for (const user of users) {

        if (user.id === myId) continue;

        if (peers[user.id]) continue;

        peerNames[user.id] = user.firstname;

        const peer = createPeer(user.id);

        const offer = await peer.createOffer();

        await peer.setLocalDescription(offer);

        socket.emit("offer", {
            roomId,
            to: user.id,
            from: myId,
            offer,
            firstname: currentUser.firstname
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
        addRemoteVideo(userId, event.streams[0]);
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

    if (
        peer.signalingState !== "stable" &&
        peer.signalingState !== "have-remote-offer"
    ) {
        return;
    }

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

    if (peer.signalingState !== "have-local-offer") {
        console.warn(
            "Ignoring answer:",
            peer.signalingState
        );
        return;
    }

    await peer.setRemoteDescription(answer);
});

socket.on("ice-candidate", async ({ candidate, from }) => {

    const peer = peers[from];
    if (!peer || !candidate) return;

    await peer.addIceCandidate(candidate);
});

function getSelectedUsers() {

    return [
        ...document.querySelectorAll(
            "#userList input:checked"
        )
    ].map(x => x.value);
}

async function loadUsers() {

    const res = await fetch("/users");
    const users = await res.json();

    const container =
        document.getElementById("userList");

    container.innerHTML = "";

    users.forEach(user => {

        container.innerHTML += `
            <div class="user-item">

                <span>
                    ${user.firstname} ${user.lastname}
                </span>

                <button
                    id="req-${user.token}"
                    onclick="requestUser('${user.token}')"
                >
                    Request
                </button>

            </div>
        `;
    });
}

loadUsers();

async function requestUser(token) {

    const btn =
        document.getElementById(`req-${token}`);

    btn.disabled = true;

    btn.innerHTML = `
        <i class="fa-solid fa-spinner fa-spin"></i>
        Requesting...
    `;

    if (!roomId) {

        socket.emit("create-room", {
            admin: currentUser.firstname,
            participants: []
        });

        pendingRequestToken = token;
        return;
    }

    socket.emit("request-user", {
        roomId,
        token
    });
}

let requestedRoom = null;

socket.on("meeting-request", (data) => {
    requestedRoom = data.roomId;
    document.getElementById("meetingRequestText").innerText = `${data.admin} wants you to join the meeting.`;
    document.getElementById("meetingRequestModal").style.display = "flex";
});

socket.on("request-accepted", ({ token }) => {

    const btn =
        document.getElementById(`req-${token}`);

    if (!btn) return;

    btn.disabled = false;
    btn.innerHTML = "Request User";
});

socket.on("removed-from-meeting", () => {

    roomId = null;

    for (let id in peers) {

        peers[id].close();

        const wrapper =
            document.getElementById(
                "wrap-" + id
            );

        if (wrapper) {
            wrapper.remove();
        }
    }

    peers = {};
    peerNames = {};
    userMediaStates = {};

    document.getElementById(
        "videos"
    ).innerHTML = "";

    alert(
        "You were removed from the meeting."
    );
});

document.getElementById("acceptMeetingBtn").onclick = async () => {

    document.getElementById(
        "meetingRequestModal"
    ).style.display = "none";

    roomId = requestedRoom;

    socket.emit("meeting-request-accepted");

    if (!stream) {
        await ensureMediaReady();
    }

    socket.emit("join-room", {
        roomId,
        userId: myId
    });
};

document.getElementById("declineMeetingBtn").onclick = () => {
    document.getElementById("meetingRequestModal").style.display = "none";
    requestedRoom = null;
};


// UI VIDEO
function addRemoteVideo(userId, stream) {

    let wrapper = document.getElementById("wrap-" + userId);

    if (!wrapper) {

        wrapper = document.createElement("div");
        wrapper.className = "video-box";
        wrapper.id = "wrap-" + userId;

        // LOADING
        const loading = document.createElement("div");
        loading.className = "video-loading";
        loading.id = "loading-" + userId;

        loading.innerHTML = `
            <i class="fa-solid fa-spinner fa-spin"></i>
            <span>Connecting...</span>
        `;

        const video = document.createElement("video");
        video.id = userId;
        video.autoplay = true;
        video.playsInline = true;

        const tag = document.createElement("span");
        tag.className = "tag";
        tag.innerText = peerNames[userId] || userId;

        // MIC LEVEL
        const micLevel = document.createElement("div");
        micLevel.className = "mic-level";
        micLevel.id = "mic-" + userId;

        micLevel.innerHTML = `
            <div class="bar"></div>
            <div class="bar"></div>
            <div class="bar"></div>
            <div class="bar"></div>
            <div class="bar"></div>
        `;

        const status = document.createElement("div");
        status.className = "remote-status";
        status.id = "status-" + userId;

        wrapper.appendChild(loading);
        wrapper.appendChild(video);
        wrapper.appendChild(tag);
        wrapper.appendChild(status);
        wrapper.appendChild(micLevel);

        document
            .getElementById("videos")
            .appendChild(wrapper);
    }

    const tag = wrapper.querySelector(".tag");

    if (peerNames[userId]) {
        tag.innerText = peerNames[userId];
    }

    const remoteVideo = document.getElementById(userId);
    remoteVideo.srcObject = stream;

    // HIDE LOADER
    const remoteLoader = document.getElementById(
        "loading-" + userId
    );

    remoteVideo.onloadeddata = () => {

        if (remoteLoader) {
            remoteLoader.style.display = "none";
        };

    };

    // SETUP MIC LEVEL ONLY ONCE
    if (!remoteVideo.dataset.micReady) {

        setupRemoteMicLevel(
            userId,
            stream
        );

        remoteVideo.dataset.micReady = "true";
    }

    if (
        currentUser.acc_type === "admin" &&
        !wrapper.querySelector(
            ".remove-user-btn"
        )
    ) {

        const removeBtn = document.createElement("button");

        removeBtn.className = "remove-user-btn";

        removeBtn.innerHTML = '<i class="fa-solid fa-xmark"></i>';

        removeBtn.onclick = () => {

            if (confirm("Remove this user?")) {
                socket.emit(
                    "remove-user",
                    {
                        roomId,
                        userId
                    }
                );
            }
        };

        wrapper.appendChild(
            removeBtn
        );
    }

    updateRemoteStatus(userId);
}


function setupRemoteMicLevel(userId, remoteStream) {

    const ctx = new AudioContext();

    const source = ctx.createMediaStreamSource(
        remoteStream
    );

    const analyser = ctx.createAnalyser();
    analyser.fftSize = 64;

    source.connect(analyser);

    const dataArray =
        new Uint8Array(
            analyser.frequencyBinCount
        );

    function animate() {

        const wrapper = document.getElementById(
            "wrap-" + userId
        );

        if (!wrapper) return;

        requestAnimationFrame(
            animate
        );

        let avg = 0;

        // CHECK IF REMOTE MIC IS ON
        const state = userMediaStates[userId];

        if (state?.mic) {

            analyser.getByteFrequencyData(
                dataArray
            );

            avg = dataArray.reduce(
                (a, b) => a + b,
                0
            ) / dataArray.length;
        }

        const bars = document.querySelectorAll(
            `#mic-${userId} .bar`
        );

        // SAME LOGIC SA IMONG LOCAL
        if (state?.mic && avg > 10) {
            wrapper.classList.add("mic-active");
        } else {
            wrapper.classList.remove("mic-active");
        }

        if (!state?.mic) {
            bars.forEach(bar => {
                bar.style.height = "4px";
            });
            return;
        }

        const level = Math.min(5, Math.floor(avg / 20));

        bars.forEach(
            (bar, i) => {

                bar.style.height = i < level
                    ? (6 + i * 3) + "px"
                    : "4px";
            }
        );
    }

    animate();
}


// CONTROLS
function toggleCamera() {

    videoTrack.enabled = !videoTrack.enabled;

    socket.emit("media-status", {
        camera: videoTrack.enabled,
        mic: audioTrack.enabled
    });

    updateMediaStatus();
}

function toggleMic() {

    audioTrack.enabled = !audioTrack.enabled;

    socket.emit("media-status", {
        camera: videoTrack.enabled,
        mic: audioTrack.enabled
    });

    updateMediaStatus();
}

function updateMediaStatus() {

    const camIcon = document.querySelector("#camBtn i");
    const micIcon = document.querySelector("#micBtn i");

    // CAMERA ICON
    if (videoTrack.enabled) {
        camIcon.className = "fa-solid fa-video";
    } else {
        camIcon.className = "fa-solid fa-video-slash";
    }

    // MIC ICON
    if (audioTrack.enabled) {
        micIcon.className = "fa-solid fa-microphone";
    } else {
        micIcon.className = "fa-solid fa-microphone-slash";
    }
}


function updateRemoteStatus(userId) {

    const status = document.getElementById(
        "status-" + userId
    );

    if (!status) return;

    const state = userMediaStates[userId];

    if (!state) return;

    if (!state.camera) {

        status.style.display = "flex";

        status.innerHTML = `
            <i class="fa-solid fa-video-slash"></i>
            Camera Off
        `;

    } else {

        status.style.display = "none";

    }
}

function logout() {
    if (confirm("Do you want to logout?")) {
        return window.location.href = "/logout";
    }
}


// ERROR
socket.on("error", (msg) => {
    alert(msg);
});