const socket = io();

let myId = "";
let stream;
let peer;
let incomingData = null;


const local = document.getElementById("local");
const remote = document.getElementById("remote");

const registerBtn = document.getElementById("registerBtn");
const callBtn = document.getElementById("callBtn");

const incomingUI = document.getElementById("incoming");
const ringtone = document.getElementById("ringtone");


let roomId = "room1"; // default room
let peers = {}; // 🔥 multiple users

function joinRoom() {

    const userId = myId;

    socket.emit("join-room", {
        roomId,
        userId
    });

    alert("Joined room: " + roomId);
}

async function roomCall() {

    const offer = await peer.createOffer();
    await peer.setLocalDescription(offer);

    socket.emit("room-call", {
        roomId,
        from: myId,
        offer
    });
}


async function initCamera() {

    try {
        stream = await navigator.mediaDevices.getUserMedia({
            video: true,
            audio: true
        });

        local.srcObject = stream;

        registerBtn.disabled = false;
        callBtn.disabled = false;

    } catch (err) {
        console.error(err);
        alert("Camera/Mic denied. Please allow permission.");
    }
}

function register() {
    myId = document.getElementById("myId").value;
    socket.emit("register", myId);
}

async function call() {

    const target = document.getElementById("targetId").value;

    peer = createPeer(target);

    const offer = await peer.createOffer();
    await peer.setLocalDescription(offer);

    socket.emit("call-user", {
        from: myId,
        to: target,
        offer
    });
}

function createPeer(target) {

    const p = new RTCPeerConnection({
        iceServers: [{
            urls: "stun:stun.l.google.com:19302"
        }]
    });

    stream.getTracks().forEach(track => {
        p.addTrack(track, stream);
    });

    p.ontrack = e => {
        remote.srcObject = e.streams[0];
    };

    p.onicecandidate = e => {
        if (e.candidate) {
            socket.emit("ice-candidate", {
                to: target,
                candidate: e.candidate
            });
        }
    };

    return p;
}

socket.on("incoming-call", data => {

    incomingData = data;

    incomingUI.style.display = "block";

    ringtone.play();

});

async function acceptCall() {

    incomingUI.style.display = "none";
    ringtone.pause();

    peer = createPeer(incomingData.from);

    await peer.setRemoteDescription(incomingData.offer);

    // process queued ICE
    for (const c of iceQueue) {
        await peer.addIceCandidate(c);
    }
    iceQueue = [];

    const answer = await peer.createAnswer();
    await peer.setLocalDescription(answer);

    socket.emit("answer-call", {
        to: incomingData.from,
        answer
    });
}

function rejectCall() {
    incomingUI.style.display = "none";
    ringtone.pause();
    incomingData = null;
}

socket.on("call-answered", async answer => {
    await peer.setRemoteDescription(answer);
});

let iceQueue = [];

socket.on("ice-candidate", async candidate => {

    if (!peer || !peer.remoteDescription) {
        iceQueue.push(candidate);
        return;
    }

    await peer.addIceCandidate(candidate);
});

async function callAll() {

    if (!stream) {
        alert("Enable camera first!");
        return;
    }

    if (!myId) {
        alert("Please register first!");
        return;
    }

    if (!peer) {
        peer = createPeer("all");
    }

    const offer = await peer.createOffer();
    await peer.setLocalDescription(offer);

    socket.emit("call-all", {
        from: myId,
        offer
    });
}

socket.on("user-joined", async ({ userId }) => {

    console.log("New user joined:", userId);

    // create peer for new user
    peers[userId] = createPeer(userId);

});