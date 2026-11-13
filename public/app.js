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

let lastLocalMicUpdate = 0;
let remoteLastUpdates = {};

// Active-speaker visual switching only. Remote audio playback/peer connections stay untouched.
// Active speaker settings
let activeSpeakerId = null;
let activeSpeakerReturnTimer = null;
let localIsSpeaking = false;

// Automatic switching ON by default
let autoSpeakerSwitchEnabled =
    localStorage.getItem("meetflow_auto_speaker_switch") !== "false";

const ACTIVE_SPEAKER_HOLD_MS = 1200;
const ACTIVE_SPEAKER_THRESHOLD = 10;

// Saved camera/microphone preferences from the server
let savedMediaStatus = {
    camera: false,
    mic: false,
    cameraFacingMode: "user"
};

let mediaStatusLoaded = false;

function setCallAllLoading(loading) {
    const btn = document.getElementById("callAllBtn");
    if (!btn) return;

    callAllLoading = loading;
    btn.disabled = loading;

    btn.innerHTML = loading
        ? `<i class="fa-solid fa-spinner fa-spin"></i> Calling...`
        : `<i class="fa-solid fa-phone"></i> Call All`;
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

    loadMissedCalls();

    // Retrieve saved camera and microphone preferences
    socket.emit("get-media-status");
});

socket.io.on("reconnect", () => { console.log("Socket reconnected."); });
socket.io.on("reconnect_attempt", () => { console.log("Trying to reconnect..."); });


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

        const profileImg = document.getElementById("hasProfile");
        const profileIcon = document.getElementById("profile");

        // LOAD AUTHENTICATED USER PROFILE PICTURE
        profileImg.src = `/profile/picture?v=${Date.now()}`;

        profileImg.onload = () => {
            profileImg.style.display = "block";
            profileIcon.style.display = "none";
        };

        profileImg.onerror = () => {
            profileImg.style.display = "none";
            profileIcon.style.display = "flex";
        };

    } catch (err) {

        console.error(err);
        location.href = "/auth";

    }
}


let missedCallCursor = null;
let missedCallHasMore = true;
let missedCallLoading = false;
let missedCallsInitialized = false;

async function loadMissedCalls(reset = false) {
    if (missedCallLoading) return;
    if (!reset && !missedCallHasMore) return;

    const list = document.getElementById("missedCallList");
    if (!list) return;

    try {
        missedCallLoading = true;
        if (reset) {
            missedCallCursor = null;
            missedCallHasMore = true;
            missedCallsInitialized = false;
            list.innerHTML = "";
        }

        const params = new URLSearchParams();
        params.set("limit", "10");
        if (missedCallCursor) {
            params.set("cursor", missedCallCursor);
        }

        const res = await fetch(`/missed-calls?${params.toString()}`, { credentials: "include" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);

        const data = await res.json();
        const calls = data.calls || [];
        missedCallHasMore = data.hasMore;
        missedCallCursor = data.nextCursor || null;

        if (!calls.length && !missedCallsInitialized) {
            list.innerHTML = `<div class="empty">No missed calls.</div>`;
            missedCallsInitialized = true;
            return;
        }

        const emptyMsg = list.querySelector(".empty");
        if (emptyMsg && calls.length) {
            emptyMsg.remove();
        }

        calls.reverse().forEach((call) => {
            const callId = call.id;
            if (!callId) return;

            const exists = list.querySelector(`[data-id="${callId}"]`);
            if (exists) return;

            const wrapper = document.createElement("div");
            wrapper.className = "missed-item-wrapper";
            wrapper.setAttribute("data-id", callId);

            const innerDiv = document.createElement("div");
            innerDiv.className = "missed-item";
            innerDiv.innerHTML = `
                <div class="left"><i class="fa-solid fa-phone-volume"></i></div>
                <div class="right">
                    <div class="notify-text">You missed a call from <span class="name">${call.firstname}</span></div>
                    <div class="time">${new Date(call.created_at).toLocaleString()}</div>
                </div>
            `;
            wrapper.appendChild(innerDiv);
            list.insertBefore(wrapper, list.firstChild);

            requestAnimationFrame(() => {
                requestAnimationFrame(() => {
                    wrapper.classList.add("show");
                });
            });
        });

        missedCallsInitialized = true;
    } catch (error) {
        console.error("Error fetching missed calls:", error);
    } finally {
        missedCallLoading = false;
    }
}

async function addLatestMissedCall() {
    try {
        const res = await fetch("/missed-calls?limit=1", { credentials: "include" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);

        const data = await res.json();
        const calls = data.calls || [];
        if (!calls.length) return;

        const call = calls[0];
        const list = document.getElementById("missedCallList");
        if (!list) return;

        const exists = list.querySelector(`[data-id="${call.id}"]`);
        if (exists) return;

        const emptyMsg = list.querySelector(".empty");
        if (emptyMsg) emptyMsg.remove();

        const wrapper = document.createElement("div");
        wrapper.className = "missed-item-wrapper";
        wrapper.setAttribute("data-id", call.id);

        const innerDiv = document.createElement("div");
        innerDiv.className = "missed-item";
        innerDiv.innerHTML = `
            <div class="left"><i class="fa-solid fa-phone-volume"></i></div>
            <div class="right">
                <div>You missed a call from <span class="name">${call.firstname}</span></div>
                <div class="time">${new Date(call.created_at).toLocaleString()}</div>
            </div>
        `;
        wrapper.appendChild(innerDiv);
        list.insertBefore(wrapper, list.firstChild);

        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                wrapper.classList.add("show");
            });
        });
    } catch (error) {
        console.error("Error loading new missed call:", error);
    }
}

const missedCallContainer = document.querySelector(".missedCallContainer");
if (missedCallContainer) {
    missedCallContainer.addEventListener("scroll", () => {
        const distanceFromBottom = missedCallContainer.scrollHeight - missedCallContainer.scrollTop - missedCallContainer.clientHeight;
        if (distanceFromBottom <= 100 && missedCallHasMore && !missedCallLoading) {
            loadMissedCalls();
        }
    });
}

let userMediaStates = {};
const globalAudioContext = new AudioContext();
const remoteAudioNodes = {};
const remoteAnimationFrames = {};

let meetingStartTime = null;
let meetingTimerInterval = null;

window.toggleSidebar = function () {
    const sidebar = document.querySelector(".leftCont");
    const overlay = document.querySelector("#overlay");

    if (!sidebar || !overlay) return;

    const isOpen = sidebar.classList.contains("show");

    sidebar.classList.toggle("show", !isOpen);
    overlay.classList.toggle("show", !isOpen);
};


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

    setupUI();
}

function setupUI() {
    const callAllBtn = document.getElementById("callAllBtn");
    const addEmpBtn = document.getElementById("addEmp");
    const actionsHeader = document.querySelector("#userTable thead th:nth-child(2)");

    if (currentUser.acc_type !== "admin") {
        callAllBtn?.remove();
        if (addEmpBtn) addEmpBtn.style.display = "none";
        if (actionsHeader) actionsHeader.style.display = "none";
        loadUsers();
        document.getElementById("missedCallContainer").style.display = "block";
    } else {
        if (addEmpBtn) addEmpBtn.style.display = "";
        if (actionsHeader) actionsHeader.style.display = "";
        loadUsers();
        document.getElementById("missedCallContainer").style.display = "none";
    }
    updateMeetingButtons(false);
}

window.onload = async () => {
    // Wait for saved media settings, but don't wait forever
    if (!mediaStatusLoaded) {
        await new Promise(resolve => {
            const startedAt = Date.now();

            const checkStatus = setInterval(() => {
                if (mediaStatusLoaded || Date.now() - startedAt >= 5000) {
                    clearInterval(checkStatus);
                    resolve();
                }
            }, 50);
        });
    }

    const ready = await ensureMediaReady();

    if (!ready) {
        console.log("[MEDIA] Media initialization failed.");
        return;
    }

    if (audioContext?.state === "suspended") {
        await audioContext.resume();
    }

    applySavedMediaStatus();
};

let currentFacingMode = "user";
let cameraStream = null;
let switchingCamera = false;

// ==========================================
// MOBILE CAMERA SWITCH SUPPORT
// ==========================================

const isMobileDevice =
    navigator.userAgentData?.mobile === true ||
    /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);

let activeCameraType = "external";

function updateCameraSwitchButton() {

    const buttons = document.querySelectorAll(
        '#switchCameraBtn, #switchCamBtn, [onclick*="switchCamera"]'
    );

    const canSwitch =
        isMobileDevice &&
        (activeCameraType === "front" ||
            activeCameraType === "rear");

    buttons.forEach(btn => {

        btn.disabled = !canSwitch || switchingCamera;

        btn.title = !isMobileDevice
            ? "Camera switching is only available on mobile"
            : !canSwitch
                ? "Camera switching unavailable for this camera"
                : "Switch front/rear camera";

        btn.classList.toggle("camera-switch-disabled", !canSwitch);

    });
}

// async function buildFilteredCameraStream(rawCameraStream) {
//     try {
//         const result =
//             await createFilteredStream(rawCameraStream);

//         if (!result) {
//             throw new Error("Filter returned no stream");
//         }

//         const processedVideoTrack =
//             result.getVideoTracks()[0];

//         if (!processedVideoTrack) {
//             throw new Error(
//                 "Filter returned no video track"
//             );
//         }

//         /*
//          * IMPORTANT:
//          * canvas.captureStream() only contains VIDEO.
//          * Add the original microphone track back.
//          */
//         const finalStream =
//             new MediaStream();

//         // Filtered video
//         finalStream.addTrack(
//             processedVideoTrack
//         );

//         // Original microphone
//         const originalAudioTrack =
//             rawCameraStream.getAudioTracks()[0];

//         if (originalAudioTrack) {
//             finalStream.addTrack(
//                 originalAudioTrack
//             );
//         }

//         filteredStream = finalStream;
//         filteredVideoTrack = processedVideoTrack;

//         console.log(
//             "[FILTER] Final stream:",
//             {
//                 videoTracks: finalStream.getVideoTracks().length,
//                 audioTracks: finalStream.getAudioTracks().length
//             }
//         );

//         return finalStream;

//     } catch (error) {
//         console.warn(
//             "[FILTER] Failed. Falling back to raw camera:",
//             error
//         );

//         filteredStream = null;
//         filteredVideoTrack = null;

//         /*
//          * Fallback:
//          * Return the original VIDEO + AUDIO.
//          */
//         const fallback =
//             new MediaStream();

//         const video =
//             rawCameraStream.getVideoTracks()[0];

//         const audio =
//             rawCameraStream.getAudioTracks()[0];

//         if (video) {
//             fallback.addTrack(video);
//         }

//         if (audio) {
//             fallback.addTrack(audio);
//         }

//         return fallback;
//     }
// }

async function ensureMediaReady(attempt = 0) {
    const loader = document.getElementById("localLoading");

    if (!navigator.onLine) {
        console.log("[MEDIA] Offline. Camera and microphone blocked.");
        if (loader) {
            loader.style.display = "flex";
            loader.innerHTML = `<i class="fa-solid fa-wifi"></i> <span>Waiting for internet connection...</span>`;
        }
        return false;
    }

    if (stream) {
        const existingVideoTrack = stream.getVideoTracks()[0];

        if (existingVideoTrack?.readyState === "live") {
            if (loader) loader.style.display = "none";
            return true;
        }

        stream.getTracks().forEach(track => {
            try {
                track.stop();
            } catch (error) {
                console.warn("[MEDIA] Could not stop stale track:", error);
            }
        });

        stream = null;
        cameraStream = null;
        videoTrack = null;
        audioTrack = null;
    }

    if (loader) {
        loader.style.display = "flex";
        loader.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> <span>Starting camera...</span>`;
    }

    try {
        console.log("[MEDIA] Internet available. Requesting camera/mic...");


        const videoConstraints = {
            facingMode: { ideal: currentFacingMode },
            width: { ideal: 1920 },
            height: { ideal: 1080 },
            frameRate: { ideal: 30 }
        };


        const rawStream = await navigator.mediaDevices.getUserMedia({
            video: videoConstraints,
            audio: {
                echoCancellation: false,
                noiseSuppression: true,
                autoGainControl: true,
                sampleRate: 48000,
                channelCount: 1
            }
        });

        cameraStream = rawStream;

        if (!navigator.onLine) {
            rawStream.getTracks().forEach(track => track.stop());
            return false;
        }

        stream = rawStream;

        localVideo.srcObject = stream;

        updateCameraMirror();

        const localPreview = document.getElementById("localPreview");

        if (localPreview) {
            localPreview.srcObject = stream;
        }

        videoTrack = stream.getVideoTracks()[0];
        audioTrack = stream.getAudioTracks()[0];
        await detectCameraType(videoTrack);
        updateCameraMirror();

        // Apply saved database status after the tracks are ready
        if (mediaStatusLoaded) {
            applySavedMediaStatus();
        } else {
            // Until the server provides the saved status,
            // use the current default state.
            updateMediaStatus();
        }

        console.log("[CAMERA SETTINGS]", videoTrack.getSettings());

        setupMicLevel();

        if (loader) loader.style.display = "none";

        return true;

    } catch (err) {
        console.error("[MEDIA ERROR]", err);
        if (attempt < 10) {
            setTimeout(() => { ensureMediaReady(attempt + 1); }, 1000);
        } else {
            if (loader) loader.innerHTML = `<i class="fa-solid fa-triangle-exclamation"></i> <span>Camera Permission Denied</span>`;
        }
        return false;
    }
}




async function switchCamera() {

    // MOBILE ONLY
    if (!isMobileDevice) {
        console.warn("[CAMERA] Switching is only available on mobile.");
        return false;
    }

    // Only front/rear cameras are supported.
    if (!["front", "rear"].includes(activeCameraType)) {
        console.warn("[CAMERA] External camera detected. Switching disabled.");
        return false;
    }

    // Prevent rapid clicking / overlapping requests.
    if (switchingCamera) return false;

    if (!navigator.mediaDevices?.getUserMedia || !navigator.onLine) {
        return false;
    }

    switchingCamera = true;
    updateCameraSwitchButton();

    const previousFacingMode = currentFacingMode;

    const targetFacingMode =
        previousFacingMode === "user"
            ? "environment"
            : "user";

    const oldCameraStream = cameraStream;
    const oldVideoTrack = videoTrack;
    const oldAudioTrack = audioTrack;

    const oldVideoEnabled =
        oldVideoTrack?.enabled ?? savedMediaStatus.camera;

    let newCameraStream = null;

    console.log("[CAMERA] Switching:", {
        from: previousFacingMode,
        to: targetFacingMode
    });

    try {

        /*
         * Release the current mobile camera.
         * Keep the microphone running.
         */
        if (oldCameraStream) {
            oldCameraStream.getVideoTracks().forEach(track => {
                track.stop();
            });
        }

        cameraStream = null;

        await new Promise(resolve => setTimeout(resolve, 300));

        /*
         * Request the EXACT opposite camera.
         * No arbitrary device index selection.
         */
        newCameraStream =
            await navigator.mediaDevices.getUserMedia({
                video: {
                    facingMode: {
                        exact: targetFacingMode
                    },
                    width: { ideal: 1920 },
                    height: { ideal: 1080 },
                    frameRate: { ideal: 30 }
                },
                audio: false
            });

        const newVideoTrack =
            newCameraStream.getVideoTracks()[0];

        if (!newVideoTrack) {
            throw new Error("No video track received.");
        }

        // Preserve camera ON/OFF state.
        newVideoTrack.enabled = oldVideoEnabled;

        /*
         * Verify the actual camera.
         */
        const actualFacingMode =
            newVideoTrack.getSettings().facingMode;

        if (
            actualFacingMode &&
            actualFacingMode !== targetFacingMode
        ) {
            throw new Error(
                `Wrong camera returned: ${actualFacingMode}`
            );
        }

        /*
         * Rebuild local stream.
         * Preserve the original microphone.
         */
        const newLocalStream = new MediaStream();

        newLocalStream.addTrack(newVideoTrack);

        if (oldAudioTrack?.readyState === "live") {
            newLocalStream.addTrack(oldAudioTrack);
        }

        /*
         * Replace video track on all WebRTC peers.
         */
        for (const peerId in peers) {

            const peer = peers[peerId];
            if (!peer) continue;

            const sender = peer.getSenders().find(
                sender => sender.track?.kind === "video"
            );

            if (sender) {
                await sender.replaceTrack(newVideoTrack);
            }
        }

        /*
         * Update camera state ONLY after success.
         */
        currentFacingMode = targetFacingMode;

        cameraStream = newCameraStream;
        stream = newLocalStream;

        videoTrack = newVideoTrack;
        audioTrack = oldAudioTrack;

        await detectCameraType(newVideoTrack);

        updateCameraMirror();

        /*
         * Update local video.
         */
        [localVideo, document.getElementById("localPreview")]
            .forEach(video => {

                if (!video) return;

                video.srcObject = newLocalStream;
                video.muted = true;
                video.autoplay = true;
                video.playsInline = true;

                video.play().catch(() => { });
            });

        /*
         * Save actual selected camera.
         */
        saveMediaPreferences();

        socket.emit("media-status", {
            camera: !!videoTrack.enabled,
            mic: !!audioTrack?.enabled
        });

        console.log("[CAMERA] Successfully switched:", {
            facingMode: currentFacingMode,
            cameraType: activeCameraType
        });

        return true;

    } catch (error) {

        console.error(
            "[CAMERA] Switch failed:",
            error.name,
            error.message
        );

        // Stop unsuccessful new camera.
        newCameraStream?.getTracks().forEach(track => track.stop());

        /*
         * Restore the previous camera.
         */
        try {

            const restoredStream =
                await navigator.mediaDevices.getUserMedia({
                    video: {
                        facingMode: {
                            exact: previousFacingMode
                        },
                        width: { ideal: 1920 },
                        height: { ideal: 1080 },
                        frameRate: { ideal: 30 }
                    },
                    audio: false
                });

            const restoredVideoTrack =
                restoredStream.getVideoTracks()[0];

            if (!restoredVideoTrack) {
                throw new Error("Could not restore previous camera.");
            }

            restoredVideoTrack.enabled = oldVideoEnabled;

            const restoredLocalStream = new MediaStream();

            restoredLocalStream.addTrack(restoredVideoTrack);

            if (oldAudioTrack?.readyState === "live") {
                restoredLocalStream.addTrack(oldAudioTrack);
            }

            for (const peerId in peers) {

                const peer = peers[peerId];
                if (!peer) continue;

                const sender = peer.getSenders().find(
                    sender => sender.track?.kind === "video"
                );

                if (sender) {
                    await sender.replaceTrack(restoredVideoTrack);
                }
            }

            currentFacingMode = previousFacingMode;

            cameraStream = restoredStream;
            stream = restoredLocalStream;

            videoTrack = restoredVideoTrack;
            audioTrack = oldAudioTrack;

            await detectCameraType(restoredVideoTrack);

            updateCameraMirror();

            [localVideo, document.getElementById("localPreview")]
                .forEach(video => {

                    if (!video) return;

                    video.srcObject = restoredLocalStream;
                    video.play().catch(() => { });
                });

            console.warn("[CAMERA] Previous camera restored.");

        } catch (restoreError) {

            console.error(
                "[CAMERA] Restoration failed:",
                restoreError
            );

        }

        return false;

    } finally {

        switchingCamera = false;
        updateCameraSwitchButton();

    }
}

window.switchCamera = switchCamera;


async function detectCameraType(track) {

    if (!track || !isMobileDevice) {
        activeCameraType = "external";
        updateCameraSwitchButton();
        return activeCameraType;
    }

    const settings = track.getSettings();

    let facingMode = settings.facingMode;

    // Use actual camera label if facingMode is unavailable.
    if (!facingMode) {

        try {

            const devices =
                await navigator.mediaDevices.enumerateDevices();

            const device = devices.find(device =>
                device.kind === "videoinput" &&
                device.deviceId === settings.deviceId
            );

            const label = device?.label || track.label || "";

            if (/\b(front|user|facetime|selfie)\b/i.test(label)) {
                facingMode = "user";
            }

            else if (/\b(back|rear|environment|world)\b/i.test(label)) {
                facingMode = "environment";
            }

        } catch (error) {
            console.warn("[CAMERA] Detection failed:", error);
        }
    }

    if (facingMode === "user") {
        activeCameraType = "front";
        currentFacingMode = "user";
    }

    else if (facingMode === "environment") {
        activeCameraType = "rear";
        currentFacingMode = "environment";
    }

    else {
        activeCameraType = "external";
    }

    console.log("[CAMERA TYPE]", {
        type: activeCameraType,
        facingMode,
        deviceId: settings.deviceId,
        label: track.label
    });

    updateCameraSwitchButton();

    return activeCameraType;
}

function updateCameraMirror() {
    const isFrontCamera = activeCameraType === "front";

    const videos = [
        localVideo,
        document.getElementById("localPreview")
    ];

    videos.forEach(video => {
        if (!video) return;

        video.classList.remove(
            "camera-user",
            "camera-environment"
        );

        video.classList.add(
            isFrontCamera
                ? "camera-user"
                : "camera-environment"
        );
    });
}

let mediaStoppedBecauseOffline = false;
let restoringMedia = false;

function stopLocalMediaBecauseOffline() {
    mediaStoppedBecauseOffline = true;
    if (stream) {
        stream.getTracks().forEach(track => { try { track.stop(); } catch (e) { } });
    }
    videoTrack = null;
    audioTrack = null;
    stream = null;

    if (localVideo) localVideo.srcObject = null;
    const localPreview = document.getElementById("localPreview");
    if (localPreview) localPreview.srcObject = null;

    const loader = document.getElementById("localLoading");
    if (loader) {
        loader.style.display = "flex";
        loader.innerHTML = `<i class="fa-solid fa-wifi"></i> <span>No internet connection</span>`;
    }

    const camIcon = document.querySelector("#camBtn i");
    const micIcon = document.querySelector("#micBtn i");
    if (camIcon) camIcon.className = "fa-solid fa-video-slash";
    if (micIcon) micIcon.className = "fa-solid fa-microphone-slash";
}

async function restoreLocalMediaAfterOnline() {
    if (!navigator.onLine || !mediaStoppedBecauseOffline || restoringMedia) return;

    restoringMedia = true;

    try {
        const ready = await ensureMediaReady();

        if (!ready) return;

        // ensureMediaReady already applies saved preferences
        mediaStoppedBecauseOffline = false;

        updateMediaStatus();

    } catch (err) {
        console.error(err);
    } finally {
        restoringMedia = false;
    }
}

window.addEventListener("offline", () => { stopLocalMediaBecauseOffline(); });
window.addEventListener("online", () => { restoreLocalMediaAfterOnline(); });

// document.getElementById("cameraFilter").addEventListener("change", async e => {
//     await changeCameraFilter(e.target.value);
// });

// document.getElementById("importLutBtn").addEventListener("click", () => {
//     document.getElementById("lutFile").click();
// });

// document.getElementById("lutFile").addEventListener("change", async (e) => {
//     const files = e.target.files;
//     if (files.length > 0) {
//         await loadUserLUT(files[0]);
//     }
// });

let pendingRequestTokens = [];
let pendingCallAll = false;

socket.on("room-created", ({ roomId: newRoom }) => {
    roomId = newRoom;
    if (pendingRequestTokens.length) {
        pendingRequestTokens.forEach(token => {
            socket.emit("request-user", { roomId, token });
        });
        pendingRequestTokens = [];
    }
    if (pendingCallAll) {
        pendingCallAll = false;
        setTimeout(() => { socket.emit("request-all-users", { roomId }); }, 100);
    }
});

socket.on("calling-all-users", (tokens) => {
    tokens.forEach(token => {
        const btn = document.getElementById(`req-${token}`);
        if (!btn) return;
        btn.disabled = true;
        btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i>`;
    });
});

function updateMeetingButtons(active) {
    const endBtn = document.getElementById("endBtn");
    if (currentUser?.acc_type !== "admin") {
        endBtn.style.display = "none";
        return;
    }
    endBtn.style.display = active ? "flex" : "none";
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

function updateMicLevel(now = 0) {
    if (now - lastLocalMicUpdate < 66) {
        requestAnimationFrame(updateMicLevel);
        return;
    }
    lastLocalMicUpdate = now;

    if (!analyser) return;
    analyser.getByteFrequencyData(dataArray);

    let avg = dataArray.reduce((a, b) => a + b, 0) / dataArray.length;
    const box = document.getElementById("localBox");
    const bars = document.querySelectorAll("#localBox .mic-level .bar");
    const localMicEnabled = !!audioTrack?.enabled && !audioTrack?.muted;
    const wasLocalSpeaking = localIsSpeaking;
    // Hysteresis: higher threshold to start speaking,
    // lower threshold to stop, para dili sige'g balik-balik.
    if (!localMicEnabled) {
        localIsSpeaking = false;
    }
    else if (!localIsSpeaking && avg >= 30) {
        localIsSpeaking = true;
    } else if (localIsSpeaking && avg <= 12) {
        localIsSpeaking = false;
    }

    if (localIsSpeaking) {
        box?.classList.add("mic-active");
        // Local speaker takes priority immediately; stop remote speaker switching
        // while the local microphone is actively detecting speech.
        if (activeSpeakerReturnTimer) {
            clearTimeout(activeSpeakerReturnTimer);
            activeSpeakerReturnTimer = null;
        }
        if (activeSpeakerId !== null) setActiveSpeaker(null);
    } else {
        box?.classList.remove("mic-active");
    }

    let level = Math.min(5, Math.floor(avg / 20));
    bars.forEach((bar, i) => {
        bar.style.height = i < level ? (6 + i * 3) + "px" : "4px";
    });

    requestAnimationFrame(updateMicLevel);
}

function createRoomNow() {
    socket.emit("create-room", {
        admin: currentUser.firstname,
        participants: getSelectedUsers()
    });
}

function startMeeting() {
    const participants = getSelectedUsers();
    if (participants.length === 0) {
        alert("Please select at least one participant.");
        return;
    }
    socket.emit("create-room", { admin: currentUser.firstname, participants });
}

let joinedUsers = 0;

socket.on("meeting-started", async (data) => {

    roomId = data.roomId;
    activeRoom = roomId;

    if (data.startedAt) {
        startMeetingTimer(new Date(data.startedAt).getTime());
    }

    if (!currentUser) return;

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

    for (const id in peers) { try { peers[id].close(); } catch (e) { } }
    peers = {};
    peerNames = {};

    socket.emit("join-room", { roomId });
    socket.emit("media-status", { camera: videoTrack.enabled, mic: audioTrack.enabled });
});

socket.on("meeting-timer-start", ({ startedAt }) => { startMeetingTimer(startedAt); });

function joinRoomNow() {
    const token = document.getElementById("roomToken").value.trim();
    roomId = token;
    socket.emit("join-room", { roomId });
    socket.emit("media-status", { camera: videoTrack.enabled, mic: audioTrack.enabled });
}

function endMeeting() {
    playSound(sounds.leave);
    if (!roomId) return;
    socket.emit("end-meeting", { roomId, adminToken: myId });
}

socket.on("meeting-ended", ({ joinedUsers }) => {
    roomId = null;
    activeRoom = null;

    if (currentUser.acc_type === "admin") updateMeetingButtons(false);

    for (let id in peers) { try { peers[id].close(); } catch (e) { } }

    Object.values(remoteAudioNodes).forEach(node => {
        try { node.source.disconnect(); node.analyser.disconnect(); } catch (e) { }
    });

    Object.values(remoteAnimationFrames).forEach(frameId => { cancelAnimationFrame(frameId); });

    Object.keys(remoteAudioNodes).forEach(id => { delete remoteAudioNodes[id]; });
    Object.keys(remoteAnimationFrames).forEach(id => { delete remoteAnimationFrames[id]; });

    peers = {};
    peerNames = {};
    remoteLastUpdates = {};

    document.getElementById("videos").innerHTML = "";
    if (activeSpeakerReturnTimer) clearTimeout(activeSpeakerReturnTimer);
    activeSpeakerReturnTimer = null;
    activeSpeakerId = null;
    setActiveSpeaker(null);

    if (stream) {
        stream.getTracks().forEach(t => t.stop());
        stream = null;
        videoTrack = null;
        audioTrack = null;
    }

    setTimeout(async () => {
        const ready = await ensureMediaReady();

        if (!ready) return;

        // Keep the user's saved camera/mic preferences
        applySavedMediaStatus();

        if (audioContext?.state === "suspended") {
            await audioContext.resume();
        }
    }, 1000);

    joinedUsers.forEach(token => {
        const reqBtn = document.getElementById(`req-${token}`);
        const deleteBtn = document.getElementById(`delete-${token}`);
        if (reqBtn) {
            reqBtn.disabled = false;
            reqBtn.innerHTML = `<i class="fa-solid fa-video"></i>`;
        }
        if (deleteBtn) deleteBtn.disabled = false;
    });

    stopMeetingTimer();

    if (currentUser?.acc_type !== "admin") {
        showToast("info", "Meeting Ended", "The meeting has ended by the administrator.");
    }
});

socket.on("user-disconnected", (userId) => {
    joinedUsers = Math.max(0, joinedUsers - 1);

    if (currentUser.acc_type === "admin") {
        updateMeetingButtons(joinedUsers > 0);
        const btn = document.getElementById(`req-${userId}`);
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = `<i class="fa-solid fa-video"></i>`;
        }
    }

    if (remoteAnimationFrames[userId]) {
        cancelAnimationFrame(remoteAnimationFrames[userId]);
        delete remoteAnimationFrames[userId];
    }
    delete remoteLastUpdates[userId];

    if (peers[userId]) {
        try { peers[userId].close(); } catch (e) { }
        delete peers[userId];
    }

    delete peerNames[userId];
    delete userMediaStates[userId];

    if (remoteAudioNodes[userId]) {
        try { remoteAudioNodes[userId].source.disconnect(); remoteAudioNodes[userId].analyser.disconnect(); } catch (e) { }
        delete remoteAudioNodes[userId];
    }

    if (activeSpeakerId === userId) {
        if (activeSpeakerReturnTimer) clearTimeout(activeSpeakerReturnTimer);
        activeSpeakerReturnTimer = null;
        setActiveSpeaker(null);
    }

    const wrapper = document.getElementById("wrap-" + userId);
    if (wrapper) wrapper.remove();

    if (currentUser?.acc_type === "admin") loadUsers();
});

socket.on("room-info", data => {
    joinedUsers = data.participants;
    updateMeetingButtons(joinedUsers > 0);
});

socket.on("user-joined-room", (user) => {
    if (user.id !== myId) playSound(sounds.join);

    if (currentUser.acc_type === "admin") {
        joinedUsers++;
        updateMeetingButtons(joinedUsers > 0);
        const btn = document.getElementById(`req-${user.id}`);
        if (btn) btn.innerHTML = `<i class="fa-solid fa-circle-check"></i>`;
    }

    peerNames[user.id] = user.firstname;
    userMediaStates[user.id] = user.media || { camera: true, mic: true };

    updateRemoteStatus(user.id);
    if (currentUser?.acc_type === "admin") loadUsers();
});

socket.on("media-status-changed", ({ userId, camera, mic }) => {
    userMediaStates[userId] = { camera, mic };
    updateRemoteStatus(userId);
});

socket.on("media-status-loaded", (data = {}) => {
    savedMediaStatus = {
        camera: Boolean(Number(data.camera ?? 1)),
        mic: Boolean(Number(data.mic ?? 1)),
        cameraFacingMode: data.cameraFacingMode || "user"
    };

    currentFacingMode = savedMediaStatus.cameraFacingMode;

    mediaStatusLoaded = true;

    console.log("[MEDIA] Loaded saved preferences:", savedMediaStatus);

    if (videoTrack && audioTrack) {
        applySavedMediaStatus();
    }
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
        if (user.id === myId || peers[user.id]) continue;

        peerNames[user.id] = user.firstname;

        const peer = createPeer(user.id);
        if (!peer) continue;

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
    if (!stream) return null;
    if (peers[userId]) return peers[userId];

    const peer = new RTCPeerConnection({
        iceServers: [
            { urls: "stun:stun.l.google.com:19302" },
            {
                urls: [
                    "turn:turn.evan-brass.net",
                    "turn:turn.evan-brass.net?transport=tcp",
                    "turns:turn.evan-brass.net:443?transport=tcp"
                ],
                username: "user",
                credential: "password"
            }
        ],
        iceTransportPolicy: "all",
        bundlePolicy: "max-bundle",
        rtcpMuxPolicy: "require"
    });

    stream.getTracks().forEach(track => { peer.addTrack(track, stream); });

    const sender = peer.getSenders().find(s => s.track?.kind === "video");
    if (sender) {
        try {
            const params = sender.getParameters();
            params.encodings = [{
                maxBitrate: 800000,
                maxFramerate: 24,
                scaleResolutionDownBy: 1
            }];
            sender.setParameters(params);
        } catch (e) {
            console.error("Error setting video parameters:", e);
        }
    }

    const transceiver = peer.getTransceivers().find(t => t.sender.track?.kind === "audio");
    if (transceiver) {
        const codecs = RTCRtpSender.getCapabilities("audio").codecs;
        const opus = codecs.filter(codec => codec.mimeType.toLowerCase() === "audio/opus");
        if (opus.length > 0) transceiver.setCodecPreferences(opus);
    }

    peer.ontrack = (event) => {
        const video = document.getElementById(userId);
        if (video && video.srcObject && video.srcObject.id === event.streams[0].id) return;
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
        if (peer.connectionState === "failed" || peer.connectionState === "closed") {
            try { peer.close(); } catch (e) { }
            delete peers[userId];
        }
    };

    peer.oniceconnectionstatechange = () => {
        if (peer.iceConnectionState === "failed") {
            try { peer.restartIce(); } catch (e) { }
        }
    };

    peers[userId] = peer;
    return peer;
}


// ==========================================
// INDEPENDENT INTERNET NETWORK MONITOR
// ==========================================

const networkMonitor = {
    endpoint: "https://www.cloudflare.com/cdn-cgi/trace",
    interval: 5000,
    samples: [],
    running: false,
    maxSamples: 10
};


// ==========================================
// INTERNET SPEED TEST SETTINGS
// ==========================================

const internetSpeedTest = {
    running: false,
    download: null,
    upload: null,
    interval: 60000
};


// ==========================================
// HTTP CONNECTIVITY CHECK
// ==========================================

async function checkInternetConnection() {

    const controller = new AbortController();

    const timeout = setTimeout(() => {
        controller.abort();
    }, 5000);

    const start = performance.now();

    try {

        await fetch(
            `${networkMonitor.endpoint}?_=${Date.now()}`,
            {
                method: "GET",
                mode: "no-cors",
                cache: "no-store",
                credentials: "omit",
                signal: controller.signal
            }
        );

        return {
            online: true,
            ping: performance.now() - start,
            timestamp: Date.now()
        };

    } catch (error) {

        return {
            online: false,
            ping: null,
            timestamp: Date.now()
        };

    } finally {

        clearTimeout(timeout);

    }

}


// ==========================================
// MEETFLOW SERVER CONNECTION CHECK
// ==========================================

async function checkMeetFlowServer() {

    const controller = new AbortController();

    const timeout = setTimeout(() => {
        controller.abort();
    }, 5000);

    try {

        const response = await fetch(
            `/me?_=${Date.now()}`,
            {
                method: "GET",
                credentials: "include",
                cache: "no-store",
                signal: controller.signal
            }
        );

        // Any HTTP response means the server is reachable.
        // This includes 401 Unauthorized.

        return {
            online: true,
            status: response.status
        };

    } catch (error) {

        return {
            online: false,
            status: null
        };

    } finally {

        clearTimeout(timeout);

    }

}


// ==========================================
// NETWORK QUALITY CALCULATION
// ==========================================

function calculateNetworkQuality(ping, jitter, packetLoss) {

    if (
        ping > 350 ||
        jitter > 60 ||
        packetLoss >= 7
    ) {

        return {
            label: "Poor",
            className: "poor"
        };

    }

    if (
        ping > 200 ||
        jitter > 35 ||
        packetLoss >= 3
    ) {

        return {
            label: "Fair",
            className: "fair"
        };

    }

    if (
        ping > 100 ||
        jitter > 20 ||
        packetLoss >= 1
    ) {

        return {
            label: "Good",
            className: "good"
        };

    }

    return {
        label: "Excellent",
        className: "excellent"
    };

}


// ==========================================
// UPDATE NETWORK UI
// ==========================================

function renderNetworkStatus(internet, server) {

    const container = document.getElementById("networkStatus");
    const icon = document.getElementById("networkIcon");

    const qualityElement = document.getElementById("networkQuality");
    const connectionElement = document.getElementById("networkConnectionStatus");
    const pingElement = document.getElementById("networkPing");
    const detailsElement = document.getElementById("networkDetails");
    const serverElement = document.getElementById("meetflowServerStatus");

    if (!container) return;


    // INTERNET STATUS

    if (connectionElement) {

        connectionElement.textContent =
            `Internet: ${internet ? "Connected" : "Unavailable"}`;

    }


    // MEETFLOW SERVER STATUS

    if (serverElement) {

        serverElement.textContent =
            `MeetFlow: ${server ? "Online" : "Unreachable"}`;

    }


    // INTERNET UNAVAILABLE

    if (!internet) {

        container.classList.remove(
            "excellent",
            "good",
            "fair",
            "poor"
        );

        container.classList.add("offline");

        if (qualityElement) {
            qualityElement.textContent = "Offline";
        }

        if (pingElement) {
            pingElement.textContent = "Ping: -- ms";
        }

        if (detailsElement) {
            detailsElement.textContent = "Jitter: -- ms · Loss: --%";
        }

        if (icon) {
            icon.className = "fa-solid fa-wifi";
        }

        container.title =
            "Internet: Unavailable\n" +
            `MeetFlow: ${server ? "Online" : "Unreachable"}`;

        return;

    }


    container.classList.remove("offline");


    // GET SUCCESSFUL PING SAMPLES

    const samples = networkMonitor.samples;

    const validSamples = samples.filter(
        sample => sample.online && typeof sample.ping === "number"
    );

    if (!validSamples.length) return;


    // AVERAGE PING

    const averagePing =
        validSamples.reduce(
            (total, sample) => total + sample.ping,
            0
        ) / validSamples.length;


    // JITTER
    // Average difference between consecutive successful checks.

    let differences = [];

    for (let i = 1; i < samples.length; i++) {

        const previous = samples[i - 1];
        const current = samples[i];

        if (previous.online && current.online) {

            differences.push(
                Math.abs(current.ping - previous.ping)
            );

        }

    }

    const jitter = differences.length
        ? differences.reduce((a, b) => a + b, 0) / differences.length
        : 0;


    // PACKET LOSS

    const failedChecks = samples.filter(
        sample => !sample.online
    ).length;

    const packetLoss =
        samples.length
            ? (failedChecks / samples.length) * 100
            : 0;


    // QUALITY

    const quality = calculateNetworkQuality(
        averagePing,
        jitter,
        packetLoss
    );


    container.classList.remove(
        "excellent",
        "good",
        "fair",
        "poor"
    );

    container.classList.add(quality.className);


    if (qualityElement) {
        qualityElement.textContent = quality.label;
    }

    if (pingElement) {
        pingElement.textContent =
            `Ping: ${averagePing.toFixed(0)} ms`;
    }

    if (detailsElement) {
        detailsElement.textContent =
            `Jitter: ${jitter.toFixed(1)} ms · Loss: ${packetLoss.toFixed(1)}%`;
    }

    if (icon) {
        icon.className = "fa-solid fa-wifi";
    }


    // TOOLTIP

    container.title =
        `Internet: Connected\n` +
        `MeetFlow: ${server ? "Online" : "Unreachable"}\n` +
        `Ping: ${averagePing.toFixed(1)} ms\n` +
        `Jitter: ${jitter.toFixed(1)} ms\n` +
        `Packet Loss: ${packetLoss.toFixed(1)}%`;

}


// ==========================================
// INTERNET DOWNLOAD SPEED TEST
// ==========================================

async function measureDownloadSpeed() {

    const bytes = 2_000_000;

    const controller = new AbortController();

    const timeout = setTimeout(() => {
        controller.abort();
    }, 15000);

    try {

        const start = performance.now();

        const response = await fetch(
            `https://speed.cloudflare.com/__down?bytes=${bytes}&_=${Date.now()}`,
            {
                method: "GET",
                cache: "no-store",
                signal: controller.signal
            }
        );

        if (!response.ok) {
            throw new Error("Download test failed");
        }

        const data = await response.arrayBuffer();

        const elapsed =
            (performance.now() - start) / 1000;

        if (elapsed <= 0 || !data.byteLength) {
            throw new Error("Invalid download measurement");
        }

        return (
            (data.byteLength * 8) /
            elapsed /
            1_000_000
        );

    } finally {

        clearTimeout(timeout);

    }

}


// ==========================================
// INTERNET UPLOAD SPEED TEST
// ==========================================

async function measureUploadSpeed() {

    const bytes = 512_000;

    const controller = new AbortController();

    const timeout = setTimeout(() => {
        controller.abort();
    }, 15000);

    try {

        const data = new Uint8Array(bytes);

        // Generate random data in chunks.

        for (let i = 0; i < data.length; i += 65536) {

            crypto.getRandomValues(
                data.subarray(
                    i,
                    Math.min(i + 65536, data.length)
                )
            );

        }

        const start = performance.now();

        const response = await fetch(
            `https://speed.cloudflare.com/__up?bytes=${bytes}&_=${Date.now()}`,
            {
                method: "POST",
                body: data,
                cache: "no-store",
                signal: controller.signal
            }
        );

        if (!response.ok) {
            throw new Error("Upload test failed");
        }

        await response.arrayBuffer();

        const elapsed =
            (performance.now() - start) / 1000;

        if (elapsed <= 0) {
            throw new Error("Invalid upload measurement");
        }

        return (
            (bytes * 8) /
            elapsed /
            1_000_000
        );

    } finally {

        clearTimeout(timeout);

    }

}


// ==========================================
// UPDATE SPEED UI
// ==========================================

function updateInternetSpeedUI() {

    const element = document.getElementById("networkSpeed");

    if (!element) return;

    const download =
        internetSpeedTest.download === null
            ? "--"
            : internetSpeedTest.download.toFixed(2);

    const upload =
        internetSpeedTest.upload === null
            ? "--"
            : internetSpeedTest.upload.toFixed(2);

    element.textContent =
        `↓ ${download} Mbps · ↑ ${upload} Mbps`;

}


// ==========================================
// RUN INTERNET SPEED TEST
// ==========================================

async function runInternetSpeedTest() {

    if (
        internetSpeedTest.running ||
        !navigator.onLine
    ) return;

    internetSpeedTest.running = true;

    try {

        // DOWNLOAD TEST

        internetSpeedTest.download =
            await measureDownloadSpeed();

        updateInternetSpeedUI();


        // Stop if browser detects offline.

        if (!navigator.onLine) {
            throw new Error("Internet connection lost");
        }


        // UPLOAD TEST

        internetSpeedTest.upload =
            await measureUploadSpeed();

        updateInternetSpeedUI();

    } catch (error) {

        console.warn("Internet speed test failed:", error);

        // Preserve previous successful measurement.
        // Do not replace it with fake zero values.

        updateInternetSpeedUI();

    } finally {

        internetSpeedTest.running = false;

    }

}


// ==========================================
// MAIN NETWORK MONITOR
// ==========================================

async function runNetworkMonitor() {

    if (networkMonitor.running) return;

    networkMonitor.running = true;

    try {

        let internetResult;
        let serverResult;


        // QUICK BROWSER OFFLINE CHECK

        if (!navigator.onLine) {

            internetResult = {
                online: false,
                ping: null,
                timestamp: Date.now()
            };

            serverResult = await checkMeetFlowServer();

        } else {

            // CHECK INTERNET AND MEETFLOW SERVER IN PARALLEL

            [internetResult, serverResult] = await Promise.all([
                checkInternetConnection(),
                checkMeetFlowServer()
            ]);

        }


        // SAVE CONNECTIVITY SAMPLE

        networkMonitor.samples.push(internetResult);

        if (
            networkMonitor.samples.length >
            networkMonitor.maxSamples
        ) {

            networkMonitor.samples.shift();

        }


        // UPDATE UI

        renderNetworkStatus(
            internetResult.online,
            serverResult.online
        );

    } catch (error) {

        console.error("Network monitor error:", error);

    } finally {

        networkMonitor.running = false;

    }

}


// ==========================================
// START NETWORK MONITOR
// ==========================================

// Initial connectivity check

runNetworkMonitor();

// Check every 5 seconds

setInterval(
    runNetworkMonitor,
    networkMonitor.interval
);


// ==========================================
// START INTERNET SPEED TEST
// ==========================================

// Initial speed test

runInternetSpeedTest();

// Repeat every 60 seconds

setInterval(
    runInternetSpeedTest,
    internetSpeedTest.interval
);


// ==========================================
// BROWSER NETWORK EVENTS
// ==========================================

window.addEventListener("online", () => {

    runNetworkMonitor();
    runInternetSpeedTest();

});

window.addEventListener("offline", () => {

    runNetworkMonitor();

});


// ==========================================
// ADAPTIVE WEBRTC VIDEO QUALITY
// Only active during meetings
// ==========================================

setInterval(async () => {

    for (const peer of Object.values(peers)) {

        if (
            !peer ||
            peer.connectionState === "closed"
        ) continue;

        try {

            const stats = await peer.getStats();

            let selectedPair = null;

            stats.forEach(report => {

                if (
                    report.type === "candidate-pair" &&
                    report.state === "succeeded"
                ) {

                    if (report.selected === true) {
                        selectedPair = report;
                    } else if (
                        !selectedPair &&
                        report.nominated === true
                    ) {
                        selectedPair = report;
                    }

                }

            });

            if (!selectedPair) continue;

            const sender = peer.getSenders().find(
                s => s.track?.kind === "video"
            );

            if (!sender) continue;

            const params = sender.getParameters();

            if (!params.encodings?.length) continue;

            const targetBitrate =
                selectedPair.currentRoundTripTime > 0.35
                    ? 450000
                    : 800000;

            if (
                params.encodings[0].maxBitrate !== targetBitrate ||
                params.encodings[0].maxFramerate !== 30
            ) {

                params.encodings[0].maxBitrate = targetBitrate;
                params.encodings[0].maxFramerate = 30;

                await sender.setParameters(params);

            }

        } catch (error) {

            console.warn("Adaptive quality error:", error);

        }

    }

}, 3000);


socket.on("offer", async ({ offer, from, firstname }) => {
    let peer = peers[from] || createPeer(from);
    if (!peer) return;

    await peer.setRemoteDescription(offer);
    const answer = await peer.createAnswer();

    if (peer.signalingState !== "stable" && peer.signalingState !== "have-remote-offer") return;

    await peer.setLocalDescription(answer);

    socket.emit("answer", { roomId, to: from, from: myId, answer });
    if (firstname) peerNames[from] = firstname;
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
    return [...document.querySelectorAll("#userList input:checked")].map(x => x.value);
}

async function requestUser(token) {
    const btn = document.getElementById(`req-${token}`);
    btn.disabled = true;
    btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i>`;

    if (!roomId) {
        socket.emit("create-room", { admin: currentUser.firstname, participants: [] });
        pendingRequestTokens.push(token);
        return;
    }
    socket.emit("request-user", { roomId, token });
}

async function deleteUser(token) {
    if (!confirm("Delete this employee?")) return;
    socket.emit("delete-user", { token });
    loadUsers();
}

function callAllUsers() {
    if (callAllLoading) return;
    setCallAllLoading(true);

    if (!roomId) {
        socket.emit("create-room", { admin: currentUser.firstname, participants: [] });
        pendingCallAll = true;
        return;
    }
    socket.emit("request-all-users", { roomId });
}

socket.on("call-all-started", ({ total }) => {
    pendingCallAllResponses = total;
    setCallAllLoading(true);
});

socket.on("call-all-progress", ({ remaining }) => {
    pendingCallAllResponses = remaining;
    if (remaining === 0) setCallAllLoading(false);
});

socket.on("call-all-expired", () => {
    pendingCallAllResponses = 0;
    setCallAllLoading(false);
});

function showToast(type, title, message) {
    const toast = document.getElementById("toast");
    const icon = document.getElementById("toastIcon");

    document.getElementById("toastTitle").innerText = title;
    document.getElementById("toastMessage").innerText = message;
    toast.className = "toast";

    switch (type) {
        case "success":
            toast.style.borderLeftColor = "#22c55e";
            icon.className = "fa-solid fa-circle-check";
            icon.parentElement.style.background = "#ecfdf5";
            icon.parentElement.style.color = "#22c55e";
            break;
        case "error":
            toast.style.borderLeftColor = "#ef4444";
            icon.className = "fa-solid fa-circle-xmark";
            icon.parentElement.style.background = "#fef2f2";
            icon.parentElement.style.color = "#ef4444";
            break;
        case "warning":
            toast.style.borderLeftColor = "#f59e0b";
            icon.className = "fa-solid fa-circle-exclamation";
            icon.parentElement.style.background = "#fffbeb";
            icon.parentElement.style.color = "#f59e0b";
            break;
        default:
            toast.style.borderLeftColor = "#2563eb";
            icon.className = "fa-solid fa-circle-info";
            icon.parentElement.style.background = "#eff6ff";
            icon.parentElement.style.color = "#2563eb";
    }

    clearTimeout(toastTimeout);
    toast.classList.add("show");
    toastTimeout = setTimeout(() => { toast.classList.remove("show"); }, 4000);
}

socket.on("call-all-expired", () => {
    showToast("warning", "Meeting Request Unsuccessful", "No one accepted your meeting request. Please try again.");
});

document.getElementById("toastClose").addEventListener("click", () => {
    document.getElementById("toast").classList.remove("show");
});

socket.on("user-deleted", (token) => {
    if (!table) return;
    table.rows().every(function () {
        const rowData = this.data();
        if (rowData && rowData.token === token) this.remove();
    });
    table.draw(false);
});

let requestedRoom = null;
let requestCountdownTimer = null;

socket.on("meeting-request", (data) => {
    requestedRoom = data.roomId;
    window.parent.postMessage({ type: "INCOMING_CALL", roomId: data.roomId, admin: data.admin }, "*");

    document.getElementById("meetingRequestText").innerText = `${data.admin} wants you to join the meeting.`;
    document.getElementById("meetingRequestModal").style.display = "flex";

    if (!requestSoundPlaying) {
        requestSoundPlaying = true;
        sounds.request.currentTime = 0;
        sounds.request.loop = true;
        sounds.request.play().catch(() => { });
    }

    if (requestCountdownTimer) clearInterval(requestCountdownTimer);

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
            window.parent.postMessage({ type: "CALL_HANDLED" }, "*");
        }
    }, 1000);
});

socket.on("request-accepted", ({ token }) => {
    const reqBtn = document.getElementById(`req-${token}`);
    const deleteBtn = document.getElementById(`delete-${token}`);
    if (reqBtn) {
        reqBtn.disabled = false;
        reqBtn.innerHTML = `<i class="fa-solid fa-video"></i>`;
    }
    if (deleteBtn) deleteBtn.disabled = false;
});

socket.on("request-declined", ({ token }) => {
    const reqBtn = document.getElementById(`req-${token}`);
    const deleteBtn = document.getElementById(`delete-${token}`);
    if (reqBtn) {
        reqBtn.disabled = false;
        reqBtn.innerHTML = `<i class="fa-solid fa-video"></i>`;
    }
    if (deleteBtn) deleteBtn.disabled = false;
});

socket.on("request-expired", async (data = {}) => {
    if (!data.token) {
        addLatestMissedCall();
        document.getElementById("meetingRequestModal").style.display = "none";

        if (requestCountdownTimer) {
            clearInterval(requestCountdownTimer);
            requestCountdownTimer = null;
        }

        sounds.request.pause();
        sounds.request.currentTime = 0;
        requestSoundPlaying = false;

        showToast("warning", "Missed Call", "You missed a meeting request.");
        return;
    }

    const token = data.token;
    const reqBtn = document.getElementById(`req-${token}`);
    const deleteBtn = document.getElementById(`delete-${token}`);

    if (reqBtn) {
        reqBtn.disabled = false;
        reqBtn.innerHTML = `<i class="fa-solid fa-video"></i>`;
    }
    if (deleteBtn) deleteBtn.disabled = false;

    showToast("warning", "Meeting Request Unsuccessful", "The employee did not accept the meeting request.");
});

socket.on("removed-from-meeting", () => {
    roomId = null;

    for (let id in peers) {
        try { peers[id].close(); } catch (e) { }
        const wrapper = document.getElementById("wrap-" + id);
        if (wrapper) wrapper.remove();
    }

    Object.values(remoteAnimationFrames).forEach(id => cancelAnimationFrame(id));
    Object.keys(remoteAnimationFrames).forEach(id => delete remoteAnimationFrames[id]);

    peers = {};
    peerNames = {};
    userMediaStates = {};
    remoteLastUpdates = {};

    document.getElementById("videos").innerHTML = "";
    if (activeSpeakerReturnTimer) clearTimeout(activeSpeakerReturnTimer);
    activeSpeakerReturnTimer = null;
    activeSpeakerId = null;
    setActiveSpeaker(null);

    if (stream) {
        stream.getTracks().forEach(track => track.stop());
        stream = null;
        videoTrack = null;
        audioTrack = null;
    }

    setTimeout(async () => {
        await ensureMediaReady();
        if (audioContext?.state === "suspended") await audioContext.resume();
        // if (videoTrack) videoTrack.enabled = true;
        // if (audioTrack) audioTrack.enabled = true;

        updateMediaStatus();
        socket.emit("media-status", { camera: true, mic: true });
    }, 500);

    if (currentUser?.acc_type !== "admin") {
        showToast("warning", "Removed From Meeting", "You were removed from the meeting by the administrator.");
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

    document.getElementById("meetingRequestModal").style.display = "none";
    roomId = requestedRoom;

    socket.emit("meeting-request-accepted");
    playSound(sounds.join);

    if (!stream) {
        await ensureMediaReady();
        if (audioContext?.state === "suspended") await audioContext.resume();
    }

    socket.emit("join-room", { roomId });
    socket.emit("media-status", { camera: videoTrack.enabled, mic: audioTrack.enabled });
    window.parent.postMessage({ type: "CALL_HANDLED" }, "*");
};

document.getElementById("declineMeetingBtn").onclick = () => {
    if (requestCountdownTimer) {
        clearInterval(requestCountdownTimer);
        requestCountdownTimer = null;
    }

    window.parent.postMessage({ type: "CALL_HANDLED" }, "*");

    sounds.request.pause();
    sounds.request.currentTime = 0;
    requestSoundPlaying = false;

    document.getElementById("meetingRequestModal").style.display = "none";
    socket.emit("meeting-request-declined");
    requestedRoom = null;
};

// Smooth visual transition for the preview swap; no external CSS edit required.
if (!document.getElementById("active-speaker-transition-style")) {
    const style = document.createElement("style");
    style.id = "active-speaker-transition-style";
    style.textContent = `
        #local, #localPreview { transition: opacity 120ms ease, filter 120ms ease; }
        #local.speaker-switching, #localPreview.speaker-switching { opacity: .35; filter: blur(1px); }
    `;
    document.head.appendChild(style);
}

function setActiveSpeaker(userId = null) {
    const mainVideo = document.getElementById("local");
    const smallPreview = document.getElementById("localPreview");
    const nextVideo = userId ? document.getElementById(userId) : null;
    const nextStream = nextVideo?.srcObject || null;

    // Do not switch if the feature is disabled.
    if (userId && !autoSpeakerSwitchEnabled) return;

    // Do not switch if our own mic detects speech.
    if (userId && localIsSpeaking) return;

    // Do not show remote video when our local camera is OFF.
    if (userId && !videoTrack?.enabled) return;

    // Always restore the original local camera stream when userId is null.
    const targetStream = nextStream || stream;
    if (!targetStream) return;

    // The main #local video is the video shown inside #localBox. Keep the small
    [mainVideo, smallPreview].forEach(video => {
        if (!video) return;
        if (video.srcObject !== targetStream) {
            video.classList.add("speaker-switching");
            video.srcObject = targetStream;
            video.muted = true;
            video.autoplay = true;
            video.playsInline = true;
            video.play().catch(() => { });
            window.setTimeout(() => video.classList.remove("speaker-switching"), 120);
        }
    });

    activeSpeakerId = nextStream ? userId : null;

    const localBox = document.getElementById("localBox");
    const tag = localBox?.querySelector(".tag");
    if (tag) {
        if (!tag.dataset.originalLabel) tag.dataset.originalLabel = tag.textContent.trim() || "You";
        tag.textContent = activeSpeakerId
            ? (peerNames[activeSpeakerId] || activeSpeakerId)
            : tag.dataset.originalLabel;
    }

    // Update local video status name
    const statusText = document.getElementById("localStatusText");

    if (statusText) {
        statusText.textContent = activeSpeakerId
            ? (peerNames[activeSpeakerId] || activeSpeakerId)
            : "You";
    }
}

function toggleAutoSpeakerSwitch() {
    autoSpeakerSwitchEnabled = !autoSpeakerSwitchEnabled;

    localStorage.setItem(
        "meetflow_auto_speaker_switch",
        String(autoSpeakerSwitchEnabled)
    );

    updateAutoSpeakerSwitchButton();

    // When disabled, immediately restore the local camera/placeholder.
    if (!autoSpeakerSwitchEnabled) {
        clearTimeout(activeSpeakerReturnTimer);
        activeSpeakerReturnTimer = null;
        setActiveSpeaker(null);
    }
}

function updateAutoSpeakerSwitchButton() {
    const btn = document.getElementById("autoSpeakerSwitchBtn");
    if (!btn) return;

    btn.title = autoSpeakerSwitchEnabled
        ? "Auto Speaker: Enabled"
        : "Auto Speaker: Disabled";

    btn.setAttribute(
        "aria-pressed",
        String(autoSpeakerSwitchEnabled)
    );

    btn.innerHTML = autoSpeakerSwitchEnabled
        ? '<i class="fa-solid fa-users-viewfinder"></i><span>A-S: ON</span>'
        : '<i class="fa-solid fa-user-slash"></i><span>A-S: OFF</span>';
}

function scheduleLocalPreviewRestore() {
    if (activeSpeakerReturnTimer) clearTimeout(activeSpeakerReturnTimer);
    activeSpeakerReturnTimer = setTimeout(() => {
        activeSpeakerReturnTimer = null;
        setActiveSpeaker(null);
    }, ACTIVE_SPEAKER_HOLD_MS);
}

function addRemoteVideo(userId, stream) {
    let wrapper = document.getElementById("wrap-" + userId);

    if (!wrapper) {
        wrapper = document.createElement("div");
        wrapper.className = "video-box";
        wrapper.id = "wrap-" + userId;

        const loading = document.createElement("div");
        loading.className = "video-loading";
        loading.id = "loading-" + userId;
        loading.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> <span>Connecting...</span>`;

        const video = document.createElement("video");

        video.id = userId;
        video.autoplay = true;
        video.playsInline = true;
        video.muted = false;
        video.volume = 0.7;

        video.controls = false;
        video.disablePictureInPicture = true;
        video.controlsList = "nodownload nofullscreen noremoteplayback";

        const tag = document.createElement("span");
        tag.className = "tag";


        const userName = document.createElement("span");
        userName.className = "userName";
        userName.innerText = peerNames[userId] || userId;

        const micLevel = document.createElement("div");
        micLevel.className = "mic-level userlevel";
        micLevel.id = "mic-" + userId;
        micLevel.innerHTML = `<div class="bar"></div> <div class="bar"></div> <div class="bar"></div> <div class="bar"></div> <div class="bar"></div>`;

        const status = document.createElement("div");
        status.className = "remote-status";
        status.id = "status-" + userId;

        wrapper.appendChild(loading);
        wrapper.appendChild(video);
        wrapper.appendChild(tag);
        wrapper.appendChild(userName);
        wrapper.appendChild(status);
        wrapper.appendChild(micLevel);
        document.getElementById("videos").appendChild(wrapper);
    }

    const tag = wrapper.querySelector(".tag");
    const userName = wrapper.querySelector(".userName");
    if (peerNames[userId]) userName.innerText = peerNames[userId];

    const remoteVideo = document.getElementById(userId);
    const remoteLoader = document.getElementById("loading-" + userId);

    if (remoteVideo.srcObject !== stream) {
        remoteVideo.srcObject = stream;

        remoteVideo.addEventListener('playing', () => {
            if (remoteLoader) remoteLoader.style.display = "none";
            if (remoteVideo.dataset.micReady !== "true") {
                setupRemoteMicLevel(userId, stream);
                remoteVideo.dataset.micReady = "true";
            }
        });

        remoteVideo.addEventListener('loadeddata', () => {
            if (remoteLoader) remoteLoader.style.display = "none";
        });

        if (document.body.contains(remoteVideo)) {
            remoteVideo.play().catch(err => {
                if (err.name !== "AbortError") console.error(err);
            });
        }
    }

    // ALWAYS SHOW NAME TAG FOR ALL USERS
    if (userName.parentElement !== tag) {
        tag.appendChild(userName);
    }

    // REMOVE BUTTON: ADMIN ONLY
    if (currentUser.acc_type === "admin" && !wrapper.querySelector(".remove-user-btn")) {

        const removeBtn = document.createElement("button");

        removeBtn.className = "remove-user-btn";
        removeBtn.innerHTML = '<i class="fa-solid fa-xmark"></i>';

        removeBtn.onclick = () => {
            if (confirm("Remove this user?")) {
                socket.emit("remove-user", { roomId, userId });
            }
        };

        tag.appendChild(removeBtn);
    }

    updateRemoteStatus(userId);
}

async function setupRemoteMicLevel(userId, remoteStream) {
    if (remoteAnimationFrames[userId]) {
        cancelAnimationFrame(remoteAnimationFrames[userId]);
        delete remoteAnimationFrames[userId];
    }

    delete remoteLastUpdates[userId];

    if (globalAudioContext.state === "suspended") {
        await globalAudioContext.resume();
    }

    if (remoteAudioNodes[userId]) {
        try {
            remoteAudioNodes[userId].source.disconnect();
            remoteAudioNodes[userId].analyser.disconnect();
        } catch (e) { }
    }

    const source = globalAudioContext.createMediaStreamSource(remoteStream);
    const analyser = globalAudioContext.createAnalyser();
    source.connect(analyser);

    remoteAudioNodes[userId] = { source, analyser };
    const dataArray = new Uint8Array(analyser.frequencyBinCount);
    remoteLastUpdates[userId] = 0;

    async function animate(now) {
        if (now - (remoteLastUpdates[userId] || 0) < 66) {
            remoteAnimationFrames[userId] = requestAnimationFrame(animate);
            return;
        }

        remoteLastUpdates[userId] = now;

        const bars = document.querySelectorAll(`#mic-${userId} .bar`);
        if (globalAudioContext.state !== "running") await globalAudioContext.resume();

        remoteAnimationFrames[userId] = requestAnimationFrame(animate);

        const wrapper = document.getElementById("wrap-" + userId);
        if (!wrapper) return;

        const track = remoteStream.getAudioTracks()[0];
        if (!track) return;

        if (track.muted) {
            bars.forEach(bar => { bar.style.height = "4px"; });
            wrapper.classList.remove("mic-active");
            if (activeSpeakerId === userId) scheduleLocalPreviewRestore();
            return;
        }

        analyser.getByteFrequencyData(dataArray);

        let avg = dataArray.reduce((a, b) => a + b, 0) / dataArray.length;

        const state = userMediaStates[userId];

        const remoteMicOff =
            state?.mic === false ||
            state?.mic === 0 ||
            state?.mic === "0";

        const isSpeaking =
            !remoteMicOff &&
            !track.muted &&
            avg >= 18;

        if (isSpeaking && !localIsSpeaking) {
            wrapper.classList.add("mic-active");

            if (activeSpeakerReturnTimer) {
                clearTimeout(activeSpeakerReturnTimer);
                activeSpeakerReturnTimer = null;
            }

            if (activeSpeakerId !== userId) {
                setActiveSpeaker(userId);
            }
        } else {
            wrapper.classList.remove("mic-active");

            if (activeSpeakerId === userId && !localIsSpeaking) {
                scheduleLocalPreviewRestore();
            }
        }

        if (!state?.mic) {
            bars.forEach(bar => { bar.style.height = "4px"; });
            return;
        }

        const level = Math.min(5, Math.floor(avg / 20));
        bars.forEach((bar, i) => {
            bar.style.height = i < level ? (6 + i * 3) + "px" : "4px";
        });
    }

    animate(0);
}




/* ==========================================
   FLOATING EMPLOYEE PANEL
========================================== */

window.toggleAccountSection = function (force) {
    const panel = document.getElementById("accountSection");
    const button = document.getElementById("viewAccountSectionBtn");
    const accountPanelOverlay = document.getElementById("accountPanelOverlay");

    if (!panel || !button) return;

    const shouldOpen =
        typeof force === "boolean"
            ? force
            : !document.body.classList.contains("account-panel-open");

    document.body.classList.toggle("account-panel-open", shouldOpen);

    button.setAttribute("aria-expanded", String(shouldOpen));
    button.setAttribute("aria-controls", "accountSection");

    button.setAttribute(
        "aria-label",
        shouldOpen ? "Close employees panel" : "View employees panel"
    );

    button.innerHTML = shouldOpen
        ? '<i class="fa-solid fa-xmark"></i>'
        : '<i class="fa-solid fa-users"></i>';

    if (accountPanelOverlay) {
        accountPanelOverlay.setAttribute("aria-hidden", String(!shouldOpen));
    }
}

document.addEventListener("DOMContentLoaded", () => {

    // Close the floating panel using Escape.
    document.addEventListener("keydown", event => {
        if (event.key === "Escape") {
            toggleAccountSection(false);
        }
    });

    // Return to the normal desktop layout when expanded.
    window.addEventListener("resize", () => {
        if (window.innerWidth > 1100) {
            toggleAccountSection(false);
        }
    });

    // Close the employee panel when the overlay is clicked.
    document.getElementById("accountPanelOverlay")
        ?.addEventListener("click", () => {
            toggleAccountSection(false);
        });


    updateAutoSpeakerSwitchButton();
});



function toggleCamera() {
    if (!videoTrack) return;

    playSound(
        videoTrack.enabled
            ? sounds.camOff
            : sounds.camOn
    );

    videoTrack.enabled = !videoTrack.enabled;
    savedMediaStatus.camera = videoTrack.enabled;

    // Restore local preview when the camera is turned OFF.
    if (!videoTrack.enabled) {
        clearTimeout(activeSpeakerReturnTimer);
        activeSpeakerReturnTimer = null;

        setActiveSpeaker(null);
    }

    saveMediaPreferences();

    // Send the latest state to the backend
    socket.emit("media-status", {
        camera: videoTrack.enabled,
        mic: !!audioTrack?.enabled
    });

    updateMediaStatus();
}

function toggleMic() {
    if (!audioTrack) return;

    playSound(
        audioTrack.enabled
            ? sounds.micOff
            : sounds.micOn
    );

    audioTrack.enabled = !audioTrack.enabled;
    savedMediaStatus.mic = audioTrack.enabled;

    saveMediaPreferences();

    // Send the latest state to the backend
    socket.emit("media-status", {
        camera: !!videoTrack?.enabled,
        mic: audioTrack.enabled
    });

    updateMediaStatus();
}

function updateMediaStatus() {
    const camIcon = document.querySelector("#camBtn i");
    const micIcon = document.querySelector("#micBtn i");

    if (camIcon) {
        camIcon.className =
            videoTrack?.enabled
                ? "fa-solid fa-video"
                : "fa-solid fa-video-slash";
    }

    if (micIcon) {
        micIcon.className =
            audioTrack?.enabled
                ? "fa-solid fa-microphone"
                : "fa-solid fa-microphone-slash";
    }
}

function applySavedMediaStatus() {
    if (!videoTrack || !audioTrack) {
        return;
    }

    // Apply saved ON/OFF values to the actual media tracks
    videoTrack.enabled = savedMediaStatus.camera;
    audioTrack.enabled = savedMediaStatus.mic;

    // Update camera and microphone button icons
    updateMediaStatus();

    console.log("[MEDIA] Applied saved status:", {
        camera: videoTrack.enabled ? 1 : 0,
        mic: audioTrack.enabled ? 1 : 0
    });
}

function saveMediaPreferences() {
    if (!socket.connected || !mediaStatusLoaded) return;

    savedMediaStatus = {
        camera: !!videoTrack?.enabled,
        mic: !!audioTrack?.enabled,
        cameraFacingMode: currentFacingMode
    };

    socket.emit("save-media-preferences", savedMediaStatus);

    console.log("[MEDIA] Saving preferences:", savedMediaStatus);
}

function updateRemoteStatus(userId) {
    const status = document.getElementById("status-" + userId);
    if (!status) return;

    const state = userMediaStates[userId];
    if (!state) return;

    if (!state.camera) {
        status.style.display = "flex";
        status.innerHTML = `<i class="fa-solid fa-video-slash"></i> Camera Off`;
    } else {
        status.style.display = "none";
    }
}

function logout() {
    const btn = document.getElementById("logoutBtn");
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> <span>Signing out...</span>`;
    }
    socket.emit("admin-logout");
    window.location.href = "/logout";
}

const addEmpBtn = document.getElementById("addEmp");
const addEmployeeModal = document.getElementById("addEmployeeModal");

if (addEmpBtn) {
    addEmpBtn.addEventListener("click", () => { addEmployeeModal.style.display = "flex"; });
}

document.getElementById("closeEmployeeModal").addEventListener("click", () => {
    addEmployeeModal.style.display = "none";
});

addEmployeeModal.addEventListener("click", (e) => {
    if (e.target === addEmployeeModal) addEmployeeModal.style.display = "none";
});

const empPassword = document.getElementById("empPassword");
const toggleEmpPassword = document.getElementById("toggleEmpPassword");

if (toggleEmpPassword) {
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
}

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
    btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Saving...`;

    try {
        const res = await fetch("/add-employee", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify({ firstname, lastname, username, password })
        });

        const data = await res.json();
        if (!res.ok) throw new Error(data.message);

        showToast("success", "Employee Added", "The employee account has been created successfully.");
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

socket.on("request-error", ({ token, message }) => {
    alert(message);
    const reqBtn = document.getElementById(`req-${token}`);
    const deleteBtn = document.getElementById(`delete-${token}`);

    if (reqBtn) {
        reqBtn.disabled = false;
        reqBtn.innerHTML = `<i class="fa-solid fa-video"></i>`;
    }

    if (deleteBtn) deleteBtn.disabled = false;
});






const meetingNavLink = document.getElementById("meetingNavLink");
const settingsNavLink = document.getElementById("settingsNavLink");
const meetingWorkspace = document.getElementById("meetingWorkspace");
const settingsView = document.getElementById("settingsView");

// const topbar = meetingWorkspace.querySelector(".topbar");
const meetingLeftView = meetingWorkspace.querySelector(".meetingLeftView");
const accountSection = document.getElementById("accountSection");
const topbar = document.querySelector(".topbar");

function showPage(page) {

    const isSettings = page === "settings";
    const isMobile = window.innerWidth <= 600;


    // MEETING CONTENT
    // topbar.style.display = isSettings ? "none" : "";
    meetingLeftView.style.display = isSettings ? "none" : "";
    accountSection.style.display = isSettings ? "none" : "";
    topbar.style.position = isSettings && isMobile ? "fixed" : "";
    topbar.style.top = isSettings && isMobile ? "0" : "";
    topbar.style.right = isSettings && isMobile ? "0" : "";

    // SETTINGS CONTENT
    settingsView.style.display = isSettings ? "flex" : "none";
    settingsView.style.flex = isSettings ? "1 1 auto" : "";
    settingsView.style.overflow = isSettings ? "hidden" : "";
    settingsView.style.gridColumn = isSettings ? "1 / 3" : "";

    // SIDEBAR ACTIVE STATE
    meetingNavLink.classList.toggle("active", !isSettings);
    settingsNavLink.classList.toggle("active", isSettings);
}


// MEETING NAVIGATION
meetingNavLink.addEventListener("click", (e) => {

    e.preventDefault();

    showPage("meeting");

});


// SETTINGS NAVIGATION
settingsNavLink.addEventListener("click", (e) => {

    e.preventDefault();

    showPage("settings");

});