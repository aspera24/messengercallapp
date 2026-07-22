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

let pendingCallAllResponses = 0;
let callAllLoading = false;
let toastTimeout;


const localVideo = document.getElementById("local");

let currentUser = null;
let myId = null;

let requestSoundPlaying = false;


function setCallAllLoading(loading) {

    const btn = document.getElementById("callAllBtn");

    if (!btn) return;

    callAllLoading = loading;
    btn.disabled = loading;

    btn.innerHTML = loading
        ? `
            <i class="fa-solid fa-spinner fa-spin"></i>
            Calling...
        `
        : `
            <i class="fa-solid fa-phone"></i>
            Call All
        `;
}

const sounds = {
    micOn: new Audio("/sounds/mic_on.mp3"),
    micOff: new Audio("/sounds/mic_off.mp3"),
    camOn: new Audio("/sounds/cam_on.mp3"),
    camOff: new Audio("/sounds/cam_off.mp3"),
    join: new Audio("/sounds/join.mp3"),
    leave: new Audio("/sounds/leave.mp3"),
    request: new Audio("/sounds/request.mp3")
};

Object.values(sounds).forEach(sound => {
    sound.preload = "auto";
});

sounds.request.loop = true;

function playSound(audio) {
    audio.currentTime = 0;
    audio.play().catch(() => { });
}

function stopSound(audio) {
    audio.pause();
    audio.currentTime = 0;
}

socket.on("connect", async () => {

    console.log("Socket connected:", socket.id);

    await loadCurrentUser();

    if (roomId && currentUser) {

        socket.emit("join-room", {
            roomId
        });

        if (videoTrack && audioTrack) {

            socket.emit("media-status", {
                camera: videoTrack.enabled,
                mic: audioTrack.enabled
            });

        }

    }

});

socket.io.on("reconnect", () => {
    console.log("Socket reconnected.");
});

socket.io.on("reconnect_attempt", () => {
    console.log("Trying to reconnect...");
});

async function loadCurrentUser() {

    try {

        const res = await fetch("/me", {
            credentials: "include"
        });

        if (!res.ok) {
            location.href = "/auth";
            return;
        }

        const data = await res.json();

        initUser(data);

        socket.emit("check-active-meeting");

        document.getElementById("uname").textContent =
            `Hi, ${currentUser.firstname}`;

    } catch (err) {

        console.error(err);

        location.href = "/auth";

    }

}

let userMediaStates = {};

const globalAudioContext = new AudioContext();
const remoteAudioNodes = {};
const remoteAnimationFrames = {};

let meetingStartTime = null;
let meetingTimerInterval = null;

window.toggleSidebar = function () {

    document.querySelector(".leftCont").classList.toggle("show");

    document.querySelector("#overlay").classList.toggle("show");

}

function startMeetingTimer(startedAt) {

    clearInterval(meetingTimerInterval);

    meetingStartTime = startedAt || Date.now();

    const timer = document.getElementById("meetingTimer");

    timer.style.display = "flex";

    meetingTimerInterval = setInterval(() => {

        const diff = Date.now() - meetingStartTime;

        const hours = Math.floor(diff / 3600000);
        const minutes = Math.floor((diff % 3600000) / 60000);
        const seconds = Math.floor((diff % 60000) / 1000);

        timer.querySelector("span").textContent =
            `${String(hours).padStart(2, "0")}:` +
            `${String(minutes).padStart(2, "0")}:` +
            `${String(seconds).padStart(2, "0")}`;

    }, 1000);

}

function stopMeetingTimer() {

    clearInterval(meetingTimerInterval);

    meetingStartTime = null;

    const timer = document.getElementById("meetingTimer");

    timer.querySelector("span").textContent = "00:00:00";

    timer.style.display = "none";

}

function initUser(data) {

    currentUser = data.user;
    myId = currentUser.token;

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

function setupUI() {

    const callAllBtn = document.getElementById("callAllBtn");

    if (currentUser.acc_type !== "admin") {

        document.querySelector(".userListCont").style.display = "none";

        callAllBtn?.remove();

    } else {

        loadUsers();

    }

    updateMeetingButtons(false);
}

window.onload = async () => {

    const ready = await ensureMediaReady();

    if (!ready) {
        console.log("Media initialization failed.");
        return;
    }

    if (audioContext?.state === "suspended") {
        await audioContext.resume();
    }

    socket.emit("media-status", {
        camera: videoTrack?.enabled ?? false,
        mic: audioTrack?.enabled ?? false
    });

};

async function ensureMediaReady(attempt = 0) {

    const loader = document.getElementById("localLoading");

    if (stream) {
        loader.style.display = "none";
        return true;
    }

    loader.style.display = "flex";

    try {
        const rawStream = await navigator.mediaDevices.getUserMedia({
            video: {
                width: { ideal: 640, max: 1280 },
                height: { ideal: 480, max: 720 },
                frameRate: { ideal: 30, max: 30 },
                facingMode: "user"
            },
            audio: {
                echoCancellation: false,
                noiseSuppression: true,
                autoGainControl: true,
                voiceIsolation: false,
                sampleRate: 48000,
                channelCount: 1
            }
        });

        const filteredVideo = await createFilteredStream(rawStream);
        const finalStream = new MediaStream();

        filteredVideo.getVideoTracks().forEach(track => {
            finalStream.addTrack(track);
        });

        rawStream.getAudioTracks().forEach(track => {
            finalStream.addTrack(track);
        });

        // const finalStream =
        //     new MediaStream();

        // rawStream.getVideoTracks().forEach(track => {
        //     finalStream.addTrack(track);
        // });

        // rawStream.getAudioTracks().forEach(track => {
        //     finalStream.addTrack(track);
        // });

        stream = finalStream;
        localVideo.srcObject = stream;

        const localPreview = document.getElementById("localPreview");
        localPreview.srcObject = stream;

        videoTrack = stream.getVideoTracks()[0];
        audioTrack = stream.getAudioTracks()[0];

        setupMicLevel();

        loader.style.display = "none";
        return true;

    } catch (err) {
        console.error("[MEDIA ERROR]", err);

        if (attempt < 10) {
            setTimeout(() => ensureMediaReady(attempt + 1), 1000);
        } else {
            loader.innerHTML = `
                <i class="fa-solid fa-triangle-exclamation"></i>
                <span>Camera Permission Denied</span>
            `;
        }
        return false;
    }
}

document.getElementById("cameraFilter").addEventListener("change", async e => {
    await changeCameraFilter(e.target.value);
});

document.getElementById("importLutBtn").addEventListener("click", () => {
    document.getElementById("lutFile").click();
});

document.getElementById("lutFile").addEventListener("change", async (e) => {
    const files = e.target.files;

    if (files.length > 0) {
        const selectedFile = files[0];
        await loadUserLUT(selectedFile);
    }
});

let pendingRequestTokens = [];
let pendingCallAll = false;

socket.on("room-created", ({ roomId: newRoom }) => {

    roomId = newRoom;

    if (pendingRequestTokens.length) {

        pendingRequestTokens.forEach(token => {

            socket.emit("request-user", {
                roomId,
                token
            });

        });

        pendingRequestTokens = [];
    }

    if (pendingCallAll) {

        pendingCallAll = false;

        setTimeout(() => {

            socket.emit("request-all-users", {
                roomId
            });

        }, 100);

    }

});

socket.on("calling-all-users", (tokens) => {

    tokens.forEach(token => {

        const btn =
            document.getElementById(`req-${token}`);

        if (!btn) return;

        btn.disabled = true;

        btn.innerHTML =
            `<i class="fa-solid fa-spinner fa-spin"></i>`;

    });

});

function updateMeetingButtons(active) {

    const endBtn = document.getElementById("endBtn");

    if (currentUser?.acc_type !== "admin") {
        endBtn.style.display = "none";
        return;
    }

    endBtn.style.display = active ? "block" : "none";
}

function setupMicLevel() {

    audioContext = new AudioContext();
    const source = audioContext.createMediaStreamSource(stream);

    analyser = audioContext.createAnalyser();
    analyser.fftSize = 32;

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

let joinedUsers = 0;

socket.on("meeting-started", async (data) => {

    roomId = data.roomId;
    activeRoom = roomId;

    if (!currentUser) {
        console.log("User not loaded yet.");
        return;
    }

    if (currentUser.acc_type === "admin") {
        joinedUsers = 0;
        updateMeetingButtons(false);
    }

    if (!stream) {
        await ensureMediaReady();

        while (pendingUsers.length) {
            processUsers(pendingUsers.shift());
        }

        if (audioContext?.state === "suspended") {
            await audioContext.resume();
        }
    }

    for (const id in peers) {
        peers[id].close();
    }

    peers = {};
    peerNames = {};

    socket.emit("join-room", {
        roomId
    });

    socket.emit("media-status", {
        camera: videoTrack.enabled,
        mic: audioTrack.enabled
    });

});

socket.on("meeting-timer-start", ({ startedAt }) => {
    startMeetingTimer(startedAt);
});

function joinRoomNow() {

    const token = document.getElementById("roomToken").value.trim();

    roomId = token;

    socket.emit("join-room", {
        roomId
    });

    socket.emit("media-status", {
        camera: videoTrack.enabled,
        mic: audioTrack.enabled
    });
}

function endMeeting() {

    playSound(sounds.leave);

    if (!roomId) return;

    socket.emit("end-meeting", {
        roomId,
        adminToken: myId
    });
}

socket.on("meeting-ended", ({ joinedUsers }) => {

    roomId = null;
    activeRoom = null;

    if (currentUser.acc_type === "admin") {
        updateMeetingButtons(false);
    }

    // Close all peers
    for (let id in peers) {
        peers[id].close();
    }

    // Disconnect all audio analysers
    Object.values(remoteAudioNodes).forEach(node => {
        try {
            node.source.disconnect();
            node.analyser.disconnect();
        } catch (e) { }
    });

    // Stop all animation frames
    Object.values(remoteAnimationFrames).forEach(frameId => {
        cancelAnimationFrame(frameId);
    });

    // Clear objects
    Object.keys(remoteAudioNodes).forEach(id => {
        delete remoteAudioNodes[id];
    });

    Object.keys(remoteAnimationFrames).forEach(id => {
        delete remoteAnimationFrames[id];
    });

    peers = {};
    peerNames = {};

    document.getElementById("videos").innerHTML = "";

    // RESET MEDIA
    if (stream) {
        stream.getTracks().forEach(t => t.stop());
        stream = null;
        videoTrack = null;
        audioTrack = null;
    }

    // Restart local media
    setTimeout(async () => {

        await ensureMediaReady();

        if (videoTrack) videoTrack.enabled = true;
        if (audioTrack) audioTrack.enabled = true;

        updateMediaStatus();

        socket.emit("media-status", {
            camera: true,
            mic: true
        });

        if (audioContext?.state === "suspended") {
            await audioContext.resume();
        }

    }, 1000);

    joinedUsers.forEach(token => {

        const reqBtn = document.getElementById(`req-${token}`);
        const deleteBtn = document.getElementById(`delete-${token}`);

        if (reqBtn) {
            reqBtn.disabled = false;
            reqBtn.innerHTML = `
                <i class="fa-solid fa-paper-plane"></i>
            `;
        }

        if (deleteBtn) {
            deleteBtn.disabled = false;
        }

    });

    stopMeetingTimer();

    if (currentUser?.acc_type !== "admin") {
        showToast(
            "info",
            "Meeting Ended",
            "The meeting has ended by the administrator."
        );
    }

});

socket.on("user-disconnected", (userId) => {

    joinedUsers = Math.max(0, joinedUsers - 1);

    if (currentUser.acc_type === "admin") {
        updateMeetingButtons(joinedUsers > 0);

        const btn = document.getElementById(`req-${userId}`);

        if (btn) {
            btn.disabled = false;
            btn.innerHTML = `
                <i class="fa-solid fa-paper-plane"></i>
            `;
        }

    }

    if (remoteAnimationFrames[userId]) {
        cancelAnimationFrame(remoteAnimationFrames[userId]);
        delete remoteAnimationFrames[userId];
    }

    if (peers[userId]) {
        peers[userId].close();
        delete peers[userId];
    }

    delete peerNames[userId];
    delete userMediaStates[userId];

    if (remoteAudioNodes[userId]) {
        try {
            remoteAudioNodes[userId].source.disconnect();
            remoteAudioNodes[userId].analyser.disconnect();
        } catch (e) { }

        delete remoteAudioNodes[userId];
    }

    const wrapper = document.getElementById(
        "wrap-" + userId
    );

    if (wrapper) {
        wrapper.remove();
    }

    if (currentUser?.acc_type === "admin") {
        loadUsers();
    }
});

socket.on("room-info", data => {
    joinedUsers = data.participants;
    updateMeetingButtons(joinedUsers > 0);
});

socket.on("user-joined-room", (user) => {

    if (user.id !== myId) {
        playSound(sounds.join);
    }

    if (currentUser.acc_type === "admin") {
        joinedUsers++;
        updateMeetingButtons(joinedUsers > 0);

        const btn = document.getElementById(`req-${user.id}`);

        if (btn) {
            btn.disabled = true;
            btn.innerHTML = `
            <i class="fa-solid fa-circle-check"></i>
        `;
        }
    }

    peerNames[user.id] = user.firstname;

    userMediaStates[user.id] =
        user.media || {
            camera: true,
            mic: true
        };

    updateRemoteStatus(user.id);
    if (currentUser?.acc_type === "admin") {
        loadUsers();
    }
});

socket.on("media-status-changed", ({ userId, camera, mic }) => {
    userMediaStates[userId] = {
        camera,
        mic
    };

    updateRemoteStatus(userId);
});

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

function createPeer(userId) {

    if (!stream) {
        console.warn("Stream not ready, retry later");
        setTimeout(() => createPeer(userId), 1000);
        return null;
    }

    if (peers[userId]) return peers[userId];

    const peer = new RTCPeerConnection({
        iceServers: [

            // // STUN
            // {
            //     urls: "stun:free.expressturn.com:3478"
            // },

            // // TURN UDP
            // {
            //     urls: "turn:free.expressturn.com:3478",
            //     username: "000000002099628167",
            //     credential: "PyKbxhcNRcJDRCEouusG4nCatzg="
            // },

            // // TURN TCP
            // {
            //     urls: "turn:free.expressturn.com:3478?transport=tcp",
            //     username: "000000002099628167",
            //     credential: "PyKbxhcNRcJDRCEouusG4nCatzg="
            // },

            {
                urls: "stun:stun.l.google.com:19302"
            },
            {
                urls: [
                    "turn:turn.evan-brass.net",
                    "turn:turn.evan-brass.net?transport=tcp",
                    "turns:turn.evan-brass.net:443?transport=tcp"
                ],
                username: "user",
                credential: "password"
            }

        ]
    });




    stream.getTracks().forEach(track => {
        peer.addTrack(track, stream);
    });

    const sender = peer.getSenders()
        .find(s => s.track?.kind === "video");

    if (sender) {
        const params = sender.getParameters();

        params.encodings = [{
            maxBitrate: 1500000,
            maxFramerate: 30
        }];

        sender.setParameters(params);
    }

    // PRIORITIZE OPUS AUDIO
    const transceiver = peer.getTransceivers()
        .find(t => t.sender.track?.kind === "audio");

    if (transceiver) {

        const codecs = RTCRtpSender.getCapabilities("audio").codecs;

        const opus = codecs.filter(codec =>
            codec.mimeType.toLowerCase() === "audio/opus"
        );

        if (opus.length > 0) {
            transceiver.setCodecPreferences(opus);
        }
    }

    peer.ontrack = (event) => {

        const video = document.getElementById(userId);

        if (
            video &&
            video.srcObject &&
            video.srcObject.id === event.streams[0].id
        ) {
            return;
        }

        addRemoteVideo(userId, event.streams[0]);
    };

    peer.onicecandidate = (e) => {

        if (e.candidate) {

            socket.emit("ice-candidate", {
                roomId,
                to: userId,
                from: myId,
                candidate: e.candidate
            });

        }

    };


    peer.onconnectionstatechange = () => {

        if (
            peer.connectionState === "failed" ||
            peer.connectionState === "closed"
        ) {

            peer.close();
            delete peers[userId];

        }

    };

    peer.oniceconnectionstatechange = () => {

        if (peer.iceConnectionState === "failed") {
            peer.restartIce();
        }

    };

    peers[userId] = peer;
    return peer;
}

socket.on("offer", async ({ offer, from, firstname }) => {

    let peer = peers[from];

    if (!peer) {
        peer = createPeer(from);
    }

    if (!peer) return;

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

    try {
        await peer.setRemoteDescription(answer);
    } catch (err) {
        console.log(err);
    }
});

socket.on("ice-candidate", async ({ candidate, from }) => {

    const peer = peers[from];
    if (!peer || !candidate) return;

    try {
        await peer.addIceCandidate(candidate);
    } catch (e) {
        console.log("ICE ignored", e);
    }
});

function getSelectedUsers() {

    return [
        ...document.querySelectorAll(
            "#userList input:checked"
        )
    ].map(x => x.value);
}

let table;

async function loadUsers() {

    const res = await fetch("/users", {
        credentials: "include"
    });

    const users = await res.json();

    if (table) {
        table.destroy();
        $("#userTable tbody").empty();
    }

    table = new DataTable("#userTable", {

        data: users,

        columns: [

            {
                data: "firstname"
            },

            {
                data: null,
                orderable: false,
                render: function (data) {

                    return `

                        <button
                            title="Request a call"
                            class="reqBtn"
                            id="req-${data.token}"
                            onclick="requestUser('${data.token}')"
                            ${data.joined ? "disabled" : ""}
                        >

                        ${data.joined
                            ? '<i class="fa-solid fa-circle-check"></i>'
                            : '<i class="fa-solid fa-paper-plane"></i>'
                        }

                        </button>

                        <button
                            title="Remove user"
                            class="deleteBtn"
                            id="delete-${data.token}"
                            onclick="deleteUser('${data.token}')"
                            ${data.joined ? "disabled" : ""}
                        >
                            <i class="fa-solid fa-trash-can"></i>
                        </button>

                    `;
                }
            }

        ],

        pageLength: 10,
        lengthMenu: [
            [10, 15, 25, 50, -1],
            [10, 15, 25, 50, "All"]
        ],
        responsive: true,
        searching: true,
        ordering: true,
        info: true,
        lengthChange: true,
        pagingType: "simple",
        columnDefs: [
            {
                targets: 0,
                width: "250px"
            },
            {
                targets: 1,
                width: "10px"
            }
        ],
        language: {
            paginate: {
                previous: "Prev",
                next: "Next"
            }
        }

    });

}

async function requestUser(token) {

    const btn = document.getElementById(`req-${token}`);

    btn.disabled = true;

    btn.innerHTML = `
        <i class="fa-solid fa-spinner fa-spin"></i>
    `;

    if (!roomId) {

        socket.emit("create-room", {
            admin: currentUser.firstname,
            participants: []
        });

        pendingRequestTokens.push(token);
        return;
    }

    socket.emit("request-user", {
        roomId,
        token
    });
}

async function deleteUser(token) {
    if (!confirm("Delete this employee?")) return;
    socket.emit("delete-user", { token });
}

function callAllUsers() {

    if (callAllLoading) return;

    setCallAllLoading(true);

    if (!roomId) {

        socket.emit("create-room", {
            admin: currentUser.firstname,
            participants: []
        });

        pendingCallAll = true;
        return;
    }

    socket.emit("request-all-users", {
        roomId
    });

}

socket.on("call-all-started", ({ total }) => {

    pendingCallAllResponses = total;
    setCallAllLoading(true);

});

socket.on("call-all-progress", ({ remaining }) => {

    pendingCallAllResponses = remaining;

    if (remaining === 0) {
        setCallAllLoading(false);
    }

});



function showToast(type, title, message) {

    const toast =
        document.getElementById("toast");

    const icon =
        document.getElementById("toastIcon");

    document.getElementById("toastTitle").innerText =
        title;

    document.getElementById("toastMessage").innerText =
        message;

    toast.className = "toast";

    switch (type) {

        case "success":

            toast.style.borderLeftColor = "#22c55e";
            icon.className =
                "fa-solid fa-circle-check";
            icon.parentElement.style.background =
                "#ecfdf5";
            icon.parentElement.style.color =
                "#22c55e";

            break;

        case "error":

            toast.style.borderLeftColor = "#ef4444";
            icon.className =
                "fa-solid fa-circle-xmark";
            icon.parentElement.style.background =
                "#fef2f2";
            icon.parentElement.style.color =
                "#ef4444";

            break;

        case "warning":

            toast.style.borderLeftColor = "#f59e0b";
            icon.className =
                "fa-solid fa-circle-exclamation";
            icon.parentElement.style.background =
                "#fffbeb";
            icon.parentElement.style.color =
                "#f59e0b";

            break;

        default:

            toast.style.borderLeftColor = "#2563eb";
            icon.className =
                "fa-solid fa-circle-info";
            icon.parentElement.style.background =
                "#eff6ff";
            icon.parentElement.style.color =
                "#2563eb";
    }

    clearTimeout(toastTimeout);
    toast.classList.add("show");
    toastTimeout = setTimeout(() => {
        toast.classList.remove("show");
    }, 4000);

}

socket.on("call-all-expired", () => {

    showToast(
        "warning",
        "Meeting Request Unsuccessful",
        "No one accepted your meeting request. Please try again."
    );

});

document
    .getElementById("toastClose")
    .addEventListener("click", () => {

        document
            .getElementById("toast")
            .classList.remove("show");

    });


socket.on("user-deleted", (token) => {

    document.querySelector(`#delete-${token}`)
        ?.closest(".user-item")
        ?.remove();

});



let requestedRoom = null;
let requestCountdownTimer = null;

socket.on("meeting-request", (data) => {

    requestedRoom = data.roomId;

    document.getElementById("meetingRequestText").innerText =
        `${data.admin} wants you to join the meeting.`;

    document.getElementById("meetingRequestModal").style.display = "flex";

    if (!requestSoundPlaying) {
        requestSoundPlaying = true;
        sounds.request.currentTime = 0;
        sounds.request.loop = true;
        sounds.request.play().catch(() => { });
    }

    if (requestCountdownTimer) {
        clearInterval(requestCountdownTimer);
    }

    let seconds = 20;

    requestCountdownTimer = setInterval(() => {

        seconds--;

        if (seconds <= 0) {

            clearInterval(requestCountdownTimer);
            requestCountdownTimer = null;

            sounds.request.pause();
            sounds.request.currentTime = 0;
            requestSoundPlaying = false;

            requestedRoom = null;

            document.getElementById("meetingRequestModal").style.display = "none";

        }

    }, 1000);

});

socket.on("request-accepted", ({ token }) => {

    const reqBtn = document.getElementById(`req-${token}`);
    const deleteBtn = document.getElementById(`delete-${token}`);

    if (reqBtn) {
        reqBtn.disabled = false;
        reqBtn.innerHTML = `
        <i class="fa-solid fa-paper-plane"></i>
    `;
    }

    if (deleteBtn) {
        deleteBtn.disabled = false;
    }
});

socket.on("request-declined", ({ token }) => {

    const reqBtn = document.getElementById(`req-${token}`);
    const deleteBtn = document.getElementById(`delete-${token}`);

    if (reqBtn) {
        reqBtn.disabled = false;
        reqBtn.innerHTML = `
            <i class="fa-solid fa-paper-plane"></i>
        `;
    }

    if (deleteBtn) {
        deleteBtn.disabled = false;
    }

});

socket.on("request-expired", ({ token }) => {

    const reqBtn = document.getElementById(`req-${token}`);
    const deleteBtn = document.getElementById(`delete-${token}`);

    if (reqBtn) {
        reqBtn.disabled = false;
        reqBtn.innerHTML = `
            <i class="fa-solid fa-paper-plane"></i>
        `;
    }

    if (deleteBtn) {
        deleteBtn.disabled = false;
    }

    showToast(
        "warning",
        "Meeting Request Unsuccessful",
        "The employee did not accept the meeting request."
    );

});

socket.on("removed-from-meeting", () => {

    roomId = null;

    for (let id in peers) {

        peers[id].close();

        const wrapper = document.getElementById(
            "wrap-" + id
        );

        if (wrapper) {
            wrapper.remove();
        }

    }

    Object.values(remoteAnimationFrames).forEach(id => {
        cancelAnimationFrame(id);
    });

    Object.keys(remoteAnimationFrames).forEach(id => {
        delete remoteAnimationFrames[id];
    });

    peers = {};
    peerNames = {};
    userMediaStates = {};

    document.getElementById("videos").innerHTML = "";

    if (stream) {
        stream.getTracks().forEach(track => track.stop());

        stream = null;
        videoTrack = null;
        audioTrack = null;
    }

    setTimeout(async () => {

        await ensureMediaReady();

        if (audioContext?.state === "suspended") {
            await audioContext.resume();
        }

        if (videoTrack) {
            videoTrack.enabled = true;
        }

        if (audioTrack) {
            audioTrack.enabled = true;
        }

        updateMediaStatus();

        socket.emit("media-status", {
            camera: true,
            mic: true
        });

    }, 500);

    if (currentUser?.acc_type !== "admin") {
        showToast(
            "warning",
            "Removed From Meeting",
            "You were removed from the meeting by the administrator."
        );
    }

    stopMeetingTimer();
});

document.getElementById("acceptMeetingBtn").onclick = async () => {

    if (requestCountdownTimer) {
        clearInterval(requestCountdownTimer);
        requestCountdownTimer = null;
    }

    sounds.request.pause();
    sounds.request.currentTime = 0;
    requestSoundPlaying = false;

    document.getElementById(
        "meetingRequestModal"
    ).style.display = "none";

    roomId = requestedRoom;

    socket.emit("meeting-request-accepted");

    playSound(sounds.join);

    if (!stream) {
        await ensureMediaReady();
        if (audioContext?.state === "suspended") {
            await audioContext.resume();
        }
    }

    socket.emit("join-room", {
        roomId
    });

    socket.emit("media-status", {
        camera: videoTrack.enabled,
        mic: audioTrack.enabled
    });
};

document.getElementById("declineMeetingBtn").onclick = () => {

    if (requestCountdownTimer) {
        clearInterval(requestCountdownTimer);
        requestCountdownTimer = null;
    }

    sounds.request.pause();
    sounds.request.currentTime = 0;
    requestSoundPlaying = false;

    document.getElementById("meetingRequestModal").style.display = "none";

    socket.emit("meeting-request-declined");

    requestedRoom = null;

};

function addRemoteVideo(userId, stream) {

    let wrapper = document.getElementById("wrap-" + userId);

    if (!wrapper) {

        wrapper = document.createElement("div");
        wrapper.className = "video-box";
        wrapper.id = "wrap-" + userId;

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

        const micLevel = document.createElement("div");
        micLevel.className = "mic-level userlevel";
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
        document.getElementById("videos").appendChild(wrapper);

    }

    const tag = wrapper.querySelector(".tag");

    if (peerNames[userId]) {
        tag.innerText = peerNames[userId];
    }

    const remoteVideo = document.getElementById(userId);
    delete remoteVideo.dataset.micReady;

    if (remoteVideo.srcObject !== stream) {

        remoteVideo.srcObject = stream;
        delete remoteVideo.dataset.micReady;

        remoteVideo.onplaying = () => {

            if (remoteLoader) remoteLoader.style.display = "none";

            if (!remoteVideo.dataset.micReady) {
                setupRemoteMicLevel(userId, stream);
                remoteVideo.dataset.micReady = "true";
            }

        };

        if (document.body.contains(remoteVideo)) {

            const promise = remoteVideo.play();

            if (promise) {

                promise.catch(err => {
                    if (err.name !== "AbortError") {
                        console.error(err);
                    }
                });

            }

        }
    }




    // HIDE LOADER
    const remoteLoader = document.getElementById(
        "loading-" + userId
    );

    remoteVideo.onloadeddata = () => {

        if (remoteLoader) {
            remoteLoader.style.display = "none";
        };

    };


    remoteVideo.muted = false;
    remoteVideo.volume = 0.7;
    remoteVideo.controls = false;

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

async function setupRemoteMicLevel(userId, remoteStream) {

    if (remoteAnimationFrames[userId]) {
        cancelAnimationFrame(remoteAnimationFrames[userId]);
        delete remoteAnimationFrames[userId];
    }

    if (globalAudioContext.state === "suspended") {
        await globalAudioContext.resume();
    }

    // Remove old nodes 
    if (remoteAudioNodes[userId]) {
        try {
            remoteAudioNodes[userId].source.disconnect();
            remoteAudioNodes[userId].analyser.disconnect();
        } catch (e) {
            console.log(e);
        }
    }

    const source = globalAudioContext.createMediaStreamSource(remoteStream);
    const analyser = globalAudioContext.createAnalyser();

    source.connect(analyser);

    remoteAudioNodes[userId] = {
        source,
        analyser
    };

    const dataArray =
        new Uint8Array(
            analyser.frequencyBinCount
        );

    async function animate() {

        const bars = document.querySelectorAll(
            `#mic-${userId} .bar`
        );

        if (globalAudioContext.state !== "running") {
            await globalAudioContext.resume();
        }

        remoteAnimationFrames[userId] = requestAnimationFrame(animate);

        const wrapper = document.getElementById("wrap-" + userId);

        if (!wrapper) {
            return;
        }


        const track = remoteStream.getAudioTracks()[0];

        if (!track) {
            return;
        }


        if (track.muted) {

            bars.forEach(bar => {
                bar.style.height = "4px";
            });

            wrapper.classList.remove("mic-active");

            return;

        }


        let avg = 0;

        // CHECK IF REMOTE MIC IS ON
        const state = userMediaStates[userId] || {
            mic: true,
            camera: true
        };

        analyser.getByteFrequencyData(dataArray);

        avg = dataArray.reduce((a, b) => a + b, 0) / dataArray.length;




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

function toggleCamera() {

    playSound(
        videoTrack.enabled
            ? sounds.camOn
            : sounds.camOff
    );

    videoTrack.enabled = !videoTrack.enabled;

    socket.emit("media-status", {
        camera: videoTrack.enabled,
        mic: audioTrack.enabled
    });

    updateMediaStatus();
}

function toggleMic() {

    playSound(
        audioTrack.enabled
            ? sounds.micOn
            : sounds.micOff
    );

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

    // if (!confirm("Do you want to logout?")) {
    //     return;
    // }

    const btn = document.getElementById("logoutBtn");

    btn.disabled = true;

    btn.innerHTML = `
        <i class="fa-solid fa-spinner fa-spin"></i>
        <span>Signing out...</span>
    `;

    socket.emit("admin-logout");

    window.location.href = "/logout";
}

const addEmpBtn = document.getElementById("addEmp");
const addEmployeeModal = document.getElementById("addEmployeeModal");

addEmpBtn.addEventListener("click", () => {
    addEmployeeModal.style.display = "flex";
});

document.getElementById("closeEmployeeModal").addEventListener("click", () => {
    addEmployeeModal.style.display = "none";
});

addEmployeeModal.addEventListener("click", (e) => {
    if (e.target === addEmployeeModal) {
        addEmployeeModal.style.display = "none";
    }
});

const empPassword = document.getElementById("empPassword");
const toggleEmpPassword = document.getElementById("toggleEmpPassword");

toggleEmpPassword.addEventListener("click", () => {

    if (empPassword.type === "password") {

        empPassword.type = "text";

        toggleEmpPassword.classList.remove("fa-eye");
        toggleEmpPassword.classList.add("fa-eye-slash");

    } else {

        empPassword.type = "password";

        toggleEmpPassword.classList.remove("fa-eye-slash");
        toggleEmpPassword.classList.add("fa-eye");

    }

});

document.getElementById("saveEmployeeBtn").addEventListener("click", async () => {

    const firstname = document.getElementById("empFirstname").value.trim();
    const lastname = document.getElementById("empLastname").value.trim();
    const username = document.getElementById("empUsername").value.trim();
    const password = document.getElementById("empPassword").value.trim();

    if (!firstname || !lastname || !username || !password) {
        return alert("Please fill in all fields.");
    }

    const btn = document.getElementById("saveEmployeeBtn");

    btn.disabled = true;
    btn.innerHTML = `
        <i class="fa-solid fa-spinner fa-spin"></i>
        Saving...
    `;

    try {

        const res = await fetch("/add-employee", {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            credentials: "include",
            body: JSON.stringify({
                firstname,
                lastname,
                username,
                password
            })
        });

        const data = await res.json();

        if (!res.ok) {
            throw new Error(data.message);
        }

        showToast(
            "success",
            "Employee Added",
            "The employee account has been created successfully."
        );

        addEmployeeModal.style.display = "none";

        document.getElementById("empFirstname").value = "";
        document.getElementById("empLastname").value = "";
        document.getElementById("empUsername").value = "";
        document.getElementById("empPassword").value = "";

        loadUsers();

    } catch (err) {

        alert(err.message);

    } finally {

        btn.disabled = false;
        btn.innerHTML = "Save";

    }

});


// ERROR
socket.on("request-error", ({ token, message }) => {

    alert(message);

    const reqBtn = document.getElementById(`req-${token}`);
    const deleteBtn = document.getElementById(`delete-${token}`);

    if (reqBtn) reqBtn.disabled = false;
    if (deleteBtn) deleteBtn.disabled = false;

    reqBtn.innerHTML = `
        <i class="fa-solid fa-paper-plane"></i>
    `;
});