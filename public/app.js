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

// For profile
document.getElementById("profile").addEventListener("click", function () {
    window.location.href = "/profile-info";
});




socket.on("connect", async () => {

    console.log("Socket connected:", socket.id);

    await loadCurrentUser();
    loadMissedCalls();

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

let missedCallCursor = null;
let missedCallHasMore = true;
let missedCallLoading = false;
let missedCallsInitialized = false;


async function loadMissedCalls(reset = false) {

    if (missedCallLoading) return;

    if (!reset && !missedCallHasMore) return;


    const list =
        document.getElementById("missedCallList");

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

            params.set(
                "cursor",
                missedCallCursor
            );

        }


        const res = await fetch(
            `/missed-calls?${params.toString()}`,
            {
                credentials: "include"
            }
        );


        if (!res.ok) {
            throw new Error(
                `HTTP ${res.status}`
            );
        }


        const data = await res.json();


        const calls =
            data.calls || [];


        missedCallHasMore =
            data.hasMore;


        missedCallCursor =
            data.nextCursor || null;


        /*
         * EMPTY STATE
         */

        if (
            !calls.length &&
            !missedCallsInitialized
        ) {

            list.innerHTML = `
                <div class="empty">
                    No missed calls.
                </div>
            `;

            missedCallsInitialized = true;

            return;

        }


        /*
         * REMOVE EMPTY MESSAGE
         */

        const emptyMsg =
            list.querySelector(".empty");


        if (
            emptyMsg &&
            calls.length
        ) {

            emptyMsg.remove();

        }


        /*
         * IMPORTANT
         *
         * Server returns:
         *
         * newest → oldest
         *
         * For initial loading we want
         * oldest → newest before
         * inserting at firstChild.
         */

        calls.reverse().forEach((call) => {

            const callId = call.id;


            if (!callId) return;


            const exists =
                list.querySelector(
                    `[data-id="${callId}"]`
                );


            if (exists) return;


            const wrapper =
                document.createElement("div");


            wrapper.className =
                "missed-item-wrapper";


            wrapper.setAttribute(
                "data-id",
                callId
            );


            const innerDiv =
                document.createElement("div");


            innerDiv.className =
                "missed-item";


            innerDiv.innerHTML = `
                <div class="left">
                    <i class="fa-solid fa-phone-volume"></i>
                </div>

                <div class="right">

                    <div>
                        You missed a call from
                        <span class="name">
                            ${call.firstname}
                        </span>
                    </div>

                    <div class="time">
                        ${new Date(
                call.created_at
            ).toLocaleString()}
                    </div>

                </div>
            `;


            wrapper.appendChild(
                innerDiv
            );


            list.insertBefore(
                wrapper,
                list.firstChild
            );


            requestAnimationFrame(() => {

                requestAnimationFrame(() => {

                    wrapper.classList.add(
                        "show"
                    );

                });

            });

        });


        missedCallsInitialized = true;


    } catch (error) {

        console.error(
            "Error fetching missed calls:",
            error
        );

    } finally {

        missedCallLoading = false;

    }

}


async function addLatestMissedCall() {

    try {

        const res = await fetch(
            "/missed-calls?limit=1",
            {
                credentials: "include"
            }
        );

        if (!res.ok) {
            throw new Error(`HTTP ${res.status}`);
        }

        const data = await res.json();

        const calls = data.calls || [];

        if (!calls.length) return;

        const call = calls[0];

        const list =
            document.getElementById("missedCallList");

        if (!list) return;


        /*
         * Check if already displayed
         */

        const exists =
            list.querySelector(
                `[data-id="${call.id}"]`
            );

        if (exists) return;


        /*
         * Remove empty message
         */

        const emptyMsg =
            list.querySelector(".empty");

        if (emptyMsg) {
            emptyMsg.remove();
        }


        /*
         * Create new missed call
         */

        const wrapper =
            document.createElement("div");

        wrapper.className =
            "missed-item-wrapper";

        wrapper.setAttribute(
            "data-id",
            call.id
        );


        const innerDiv =
            document.createElement("div");

        innerDiv.className =
            "missed-item";

        innerDiv.innerHTML = `
            <div class="left">
                <i class="fa-solid fa-phone-volume"></i>
            </div>

            <div class="right">

                <div>
                    You missed a call from
                    <span class="name">
                        ${call.firstname}
                    </span>
                </div>

                <div class="time">
                    ${new Date(
            call.created_at
        ).toLocaleString()}
                </div>

            </div>
        `;


        wrapper.appendChild(innerDiv);


        /*
         * Put NEW call at the top
         */

        list.insertBefore(
            wrapper,
            list.firstChild
        );


        /*
         * Trigger existing animation
         */

        requestAnimationFrame(() => {

            requestAnimationFrame(() => {

                wrapper.classList.add("show");

            });

        });


    } catch (error) {

        console.error(
            "Error loading new missed call:",
            error
        );

    }

}




const missedCallContainer =
    document.querySelector(
        ".missedCallContainer"
    );


if (missedCallContainer) {

    missedCallContainer.addEventListener(
        "scroll",
        () => {

            const distanceFromBottom =
                missedCallContainer.scrollHeight -
                missedCallContainer.scrollTop -
                missedCallContainer.clientHeight;


            if (
                distanceFromBottom <= 100 &&
                missedCallHasMore &&
                !missedCallLoading
            ) {

                loadMissedCalls();

            }

        }
    );

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

        // document.querySelector(".userListCont").style.display = "none";
        callAllBtn?.remove();
        loadUsers();

    } else {

        loadUsers();
        document.getElementById("missedCallContainer").style.display = "none";

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


let currentFacingMode = "user";
let cameraStream = null;

async function ensureMediaReady(attempt = 0) {
    const loader = document.getElementById("localLoading");

    if (!navigator.onLine) {
        console.log("[MEDIA] Offline. Camera and microphone blocked.");
        if (loader) {
            loader.style.display = "flex";
            loader.innerHTML = `
                <i class="fa-solid fa-wifi"></i>
                <span>Waiting for internet connection...</span>
            `;
        }
        return false;
    }

    if (stream) {
        if (loader) {
            loader.style.display = "none";
        }
        return true;
    }

    if (loader) {
        loader.style.display = "flex";
        loader.innerHTML = `
            <i class="fa-solid fa-spinner fa-spin"></i>
            <span>Starting camera...</span>
        `;
    }

    try {
        console.log("[MEDIA] Internet available. Requesting camera/mic...");

        const videoConstraints = {
            facingMode: {
                ideal: currentFacingMode
            },
            width: { ideal: 640 },
            height: { ideal: 480 },
            frameRate: { ideal: 30 }
        };

        if (currentFacingMode === "user") {
            videoConstraints.width = { ideal: 640 };
            videoConstraints.height = { ideal: 480 };
            videoConstraints.frameRate = { ideal: 30 };
        }

        const rawStream = await navigator.mediaDevices.getUserMedia({
            video: videoConstraints,
            audio: {
                echoCancellation: false,
                noiseSuppression: false,
                autoGainControl: true,
                voiceIsolation: false,
                sampleRate: 48000,
                channelCount: 1
            }
        });

        cameraStream = rawStream;

        if (!navigator.onLine) {
            console.log("[MEDIA] Internet disappeared during initialization.");
            rawStream.getTracks().forEach(track => track.stop());
            if (loader) {
                loader.style.display = "flex";
                loader.innerHTML = `
                    <i class="fa-solid fa-wifi"></i>
                    <span>Waiting for internet connection...</span>
                `;
            }
            return false;
        }

        let filteredVideo;
        try {
            filteredVideo = await createFilteredStream(rawStream);
        } catch (filterErr) {
            console.warn("[MEDIA] Filter failed, using raw stream:", filterErr);
            filteredVideo = rawStream;
        }

        const finalStream = new MediaStream();

        filteredVideo.getVideoTracks().forEach(track => {
            finalStream.addTrack(track);
        });

        rawStream.getAudioTracks().forEach(track => {
            finalStream.addTrack(track);
        });

        stream = finalStream;
        localVideo.srcObject = stream;

        const localPreview = document.getElementById("localPreview");

        if (localPreview) {
            localPreview.srcObject = stream;
        }

        // videoTrack = stream.getVideoTracks();
        // audioTrack = stream.getAudioTracks();

        videoTrack = stream.getVideoTracks()[0];
        audioTrack = stream.getAudioTracks()[0];

        setupMicLevel();

        if (loader) {
            loader.style.display = "none";
        }

        console.log("[MEDIA] Camera and microphone initialized.");
        return true;

    } catch (err) {
        console.error("[MEDIA ERROR]", err);

        if (!navigator.onLine) {
            console.log("[MEDIA] Offline. Waiting for connection...");
            if (loader) {
                loader.style.display = "flex";
                loader.innerHTML = `
                    <i class="fa-solid fa-wifi"></i>
                    <span>Waiting for internet connection...</span>
                `;
            }
            return false;
        }

        if (attempt < 10) {
            console.log(`[MEDIA] Retry ${attempt + 1}/10`);
            setTimeout(() => {
                ensureMediaReady(attempt + 1);
            }, 1000);
        } else {
            if (loader) {
                loader.innerHTML = `
                    <i class="fa-solid fa-triangle-exclamation"></i>
                    <span>Camera Permission Denied</span>
                `;
            }
        }
        return false;
    }
}

async function switchCamera() {

    if (!navigator.onLine) {
        console.log("[CAMERA] Offline. Cannot switch camera.");
        return false;
    }

    if (!cameraStream) {
        console.warn("[CAMERA] No active camera stream.");
        return false;
    }

    console.log("[CAMERA] =============================");
    console.log("[CAMERA] SWITCHING CAMERA");
    console.log("[CAMERA] Current:", currentFacingMode);

    const oldCameraStream = cameraStream;
    const oldFilteredStream = stream;

    const oldVideoTrack =
        stream?.getVideoTracks()?.[0];

    const oldAudioTrack =
        stream?.getAudioTracks()?.[0];

    const newFacingMode =
        currentFacingMode === "user"
            ? "environment"
            : "user";

    console.log(
        "[CAMERA] Target:",
        newFacingMode
    );

    let newCameraStream = null;
    let newFilteredStream = null;

    try {

        // =====================================================
        // 1. GET THE OTHER CAMERA
        // =====================================================

        try {

            newCameraStream =
                await navigator.mediaDevices.getUserMedia({
                    video: {
                        facingMode: {
                            exact: newFacingMode
                        },
                        width: {
                            ideal: 640
                        },
                        height: {
                            ideal: 480
                        },
                        frameRate: {
                            ideal: 30
                        }
                    }
                });

        } catch (exactError) {

            console.warn(
                "[CAMERA] exact facingMode failed:",
                exactError
            );

            console.log(
                "[CAMERA] Retrying with ideal facingMode..."
            );

            newCameraStream =
                await navigator.mediaDevices.getUserMedia({
                    video: {
                        facingMode: {
                            ideal: newFacingMode
                        },
                        width: {
                            ideal: 640
                        },
                        height: {
                            ideal: 480
                        },
                        frameRate: {
                            ideal: 30
                        }
                    }
                });
        }


        const newRawVideoTrack =
            newCameraStream.getVideoTracks()[0];


        if (!newRawVideoTrack) {
            throw new Error(
                "New camera did not provide a video track."
            );
        }


        console.log(
            "[CAMERA] New camera settings:",
            newRawVideoTrack.getSettings()
        );


        // =====================================================
        // 2. CREATE NEW FILTERED STREAM
        // =====================================================

        try {

            newFilteredStream =
                await createFilteredStream(
                    newCameraStream
                );

        } catch (filterError) {

            console.warn(
                "[CAMERA] Filter failed:",
                filterError
            );

            console.warn(
                "[CAMERA] Falling back to raw camera."
            );

            newFilteredStream =
                new MediaStream();

            newFilteredStream.addTrack(
                newRawVideoTrack
            );
        }


        const newVideoTrack =
            newFilteredStream.getVideoTracks()[0];


        if (!newVideoTrack) {
            throw new Error(
                "New filtered stream has no video track."
            );
        }


        console.log(
            "[CAMERA] New filtered video track:",
            newVideoTrack
        );


        // =====================================================
        // 3. REPLACE VIDEO TRACK IN EVERY ACTIVE PEER
        // =====================================================

        for (const peerId in peers) {

            const peer = peers[peerId];

            if (!peer) {
                continue;
            }


            const sender =
                peer
                    .getSenders()
                    .find(
                        sender =>
                            sender.track &&
                            sender.track.kind === "video"
                    );


            if (!sender) {

                console.warn(
                    "[CAMERA] No video sender found for:",
                    peerId
                );

                continue;
            }


            console.log(
                "[CAMERA] Replacing video track for:",
                peerId
            );


            await sender.replaceTrack(
                newVideoTrack
            );


            console.log(
                "[CAMERA] Video replaced successfully for:",
                peerId
            );
        }


        // =====================================================
        // 4. CREATE NEW LOCAL STREAM
        // =====================================================

        const newLocalStream =
            new MediaStream();


        newLocalStream.addTrack(
            newVideoTrack
        );


        // IMPORTANT:
        // Keep the EXISTING audio track.
        // We are NOT requesting a new microphone.
        if (oldAudioTrack) {

            newLocalStream.addTrack(
                oldAudioTrack
            );

        }


        // =====================================================
        // 5. UPDATE GLOBAL STATE
        // =====================================================

        currentFacingMode =
            newFacingMode;

        cameraStream =
            newCameraStream;

        stream =
            newLocalStream;


        videoTrack =
            newVideoTrack;

        audioTrack =
            oldAudioTrack;


        // =====================================================
        // 6. UPDATE LOCAL VIDEO
        // =====================================================

        if (localVideo) {

            localVideo.srcObject =
                stream;

            localVideo.play().catch(() => { });

        }


        const localPreview =
            document.getElementById(
                "localPreview"
            );


        if (localPreview) {

            localPreview.srcObject =
                stream;

            localPreview.play().catch(() => { });

        }


        // =====================================================
        // 7. STOP OLD CAMERA
        // =====================================================

        // IMPORTANT:
        // STOP OLD CAMERA, NOT NEW CAMERA.
        if (oldCameraStream) {

            oldCameraStream
                .getTracks()
                .forEach(track => {

                    try {
                        track.stop();
                    } catch (e) {
                        console.warn(
                            "[CAMERA] Failed to stop old track:",
                            e
                        );
                    }

                });

        }


        // =====================================================
        // 8. STOP OLD FILTERED/CANVAS VIDEO
        // =====================================================

        if (
            oldVideoTrack &&
            oldVideoTrack !== newVideoTrack
        ) {

            try {
                oldVideoTrack.stop();
            } catch (e) {
                console.warn(
                    "[CAMERA] Failed to stop old filtered track:",
                    e
                );
            }

        }


        // =====================================================
        // 9. UPDATE SERVER MEDIA STATUS
        // =====================================================

        if (socket.connected) {

            socket.emit(
                "media-status",
                {
                    camera:
                        videoTrack?.enabled ?? true,

                    mic:
                        audioTrack?.enabled ?? true
                }
            );

        }


        console.log(
            "[CAMERA] ============================="
        );

        console.log(
            "[CAMERA] SWITCH SUCCESS:",
            currentFacingMode
        );

        console.log(
            "[CAMERA] ============================="
        );


        return true;


    } catch (err) {

        console.error(
            "[CAMERA] ============================="
        );

        console.error(
            "[CAMERA] SWITCH FAILED:",
            err
        );

        console.error(
            "[CAMERA] ============================="
        );


        // =====================================================
        // CLEAN UP NEW CAMERA
        // =====================================================

        if (newCameraStream) {

            newCameraStream
                .getTracks()
                .forEach(track => {

                    try {
                        track.stop();
                    } catch (e) { }

                });

        }


        return false;
    }
}







// INTERNET / MEDIA CONNECTION CONTROL
let mediaStoppedBecauseOffline = false;
let restoringMedia = false;

// STOP CAMERA + MICROPHONE
function stopLocalMediaBecauseOffline() {

    console.log(
        "[MEDIA] Internet disconnected. Stopping camera and microphone."
    );


    mediaStoppedBecauseOffline = true;


    // Stop all tracks
    if (stream) {

        stream
            .getTracks()
            .forEach(track => {

                try {
                    track.stop();
                } catch (e) {
                    console.warn(
                        "[MEDIA] Failed to stop track:",
                        e
                    );
                }

            });

    }


    // Clear video track
    videoTrack = null;
    audioTrack = null;


    // Clear stream
    stream = null;


    // Clear local video
    if (localVideo) {
        localVideo.srcObject = null;
    }


    const localPreview =
        document.getElementById("localPreview");

    if (localPreview) {
        localPreview.srcObject = null;
    }


    // Update UI
    const loader =
        document.getElementById("localLoading");

    if (loader) {

        loader.style.display = "flex";

        loader.innerHTML = `
            <i class="fa-solid fa-wifi"></i>
            <span>No internet connection</span>
        `;

    }


    // Update media buttons if available
    const camIcon =
        document.querySelector("#camBtn i");

    const micIcon =
        document.querySelector("#micBtn i");


    if (camIcon) {
        camIcon.className =
            "fa-solid fa-video-slash";
    }


    if (micIcon) {
        micIcon.className =
            "fa-solid fa-microphone-slash";
    }


    // Tell other users that our media is OFF
    if (socket.connected) {

        socket.emit("media-status", {
            camera: false,
            mic: false
        });

    }

}

// INTERNET RESTORED
async function restoreLocalMediaAfterOnline() {

    if (!navigator.onLine) return;

    if (!mediaStoppedBecauseOffline) return;

    if (restoringMedia) return;


    restoringMedia = true;


    console.log(
        "[MEDIA] Internet restored. Reinitializing camera/microphone..."
    );


    try {

        const ready =
            await ensureMediaReady();


        if (!ready) {

            console.log(
                "[MEDIA] Media restoration failed."
            );

            return;
        }


        // Enable tracks
        if (videoTrack) {
            videoTrack.enabled = true;
        }

        if (audioTrack) {
            audioTrack.enabled = true;
        }


        mediaStoppedBecauseOffline = false;


        updateMediaStatus();


        // Notify server
        if (socket.connected) {

            socket.emit("media-status", {
                camera: videoTrack?.enabled ?? false,
                mic: audioTrack?.enabled ?? false
            });

        }


        console.log(
            "[MEDIA] Camera and microphone restored."
        );


    } catch (err) {

        console.error(
            "[MEDIA] Failed to restore media:",
            err
        );

    } finally {

        restoringMedia = false;

    }

}

// INTERNET LOST
window.addEventListener("offline", () => {

    console.warn(
        "[NETWORK] Internet connection lost."
    );

    stopLocalMediaBecauseOffline();

});

// INTERNET RESTORED
window.addEventListener("online", () => {

    console.log(
        "[NETWORK] Internet connection restored."
    );

    restoreLocalMediaAfterOnline();

});



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
                <i class="fa-solid fa-mobile-screen"></i>
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
                <i class="fa-solid fa-mobile-screen"></i>
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

        // iceServers: [
        //     {
        //         urls: "stun:stun.relay.metered.ca:80",
        //     },
        //     {
        //         urls: "turn:standard.relay.metered.ca:80",
        //         username: "5c2d25d7fdd1c3ac7562312b",
        //         credential: "hLT2NB9ClBIEMeOY",
        //     },
        //     {
        //         urls: "turn:standard.relay.metered.ca:80?transport=tcp",
        //         username: "5c2d25d7fdd1c3ac7562312b",
        //         credential: "hLT2NB9ClBIEMeOY",
        //     },
        //     {
        //         urls: "turn:standard.relay.metered.ca:443",
        //         username: "5c2d25d7fdd1c3ac7562312b",
        //         credential: "hLT2NB9ClBIEMeOY",
        //     },
        //     {
        //         urls: "turns:standard.relay.metered.ca:443?transport=tcp",
        //         username: "5c2d25d7fdd1c3ac7562312b",
        //         credential: "hLT2NB9ClBIEMeOY",
        //     },
        // ],
    });




    stream.getTracks().forEach(track => {
        peer.addTrack(track, stream);
    });

    const sender = peer.getSenders()
        .find(s => s.track?.kind === "video");

    if (sender) {
        const params = sender.getParameters();

        params.encodings = [{
            maxBitrate: 2000000,
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
    loadUsers();
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

socket.on("call-all-expired", () => {
    pendingCallAllResponses = 0;
    setCallAllLoading(false);
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

    if (!table) return;

    table.rows().every(function () {

        const rowData = this.data();

        if (rowData && rowData.token === token) {
            this.remove();
        }

    });

    table.draw(false);

});



let requestedRoom = null;
let requestCountdownTimer = null;

socket.on("meeting-request", (data) => {

    requestedRoom = data.roomId;

    console.log("[DASHBOARD] meeting-request", data);

    window.parent.postMessage({
        type: "INCOMING_CALL",
        roomId: data.roomId,
        admin: data.admin
    }, "*");

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

            window.parent.postMessage({
                type: "CALL_HANDLED"
            }, "*");

        }

    }, 1000);

});

socket.on("request-accepted", ({ token }) => {

    const reqBtn = document.getElementById(`req-${token}`);
    const deleteBtn = document.getElementById(`delete-${token}`);

    if (reqBtn) {
        reqBtn.disabled = false;
        reqBtn.innerHTML = `
        <i class="fa-solid fa-mobile-screen"></i>
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
            <i class="fa-solid fa-mobile-screen"></i>
        `;
    }

    if (deleteBtn) {
        deleteBtn.disabled = false;
    }

});

socket.on("request-expired", async (data = {}) => {

    // EMPLOYEE
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

        showToast(
            "warning",
            "Missed Call",
            "You missed a meeting request."
        );

        return;
    }

    // ADMIN
    const token = data.token;

    const reqBtn = document.getElementById(`req-${token}`);
    const deleteBtn = document.getElementById(`delete-${token}`);

    if (reqBtn) {
        reqBtn.disabled = false;
        reqBtn.innerHTML = `
            <i class="fa-solid fa-mobile-screen"></i>
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

    window.parent.postMessage({
        type: "CALL_HANDLED"
    }, "*");
};

document.getElementById("declineMeetingBtn").onclick = () => {

    if (requestCountdownTimer) {
        clearInterval(requestCountdownTimer);
        requestCountdownTimer = null;
    }

    window.parent.postMessage({
        type: "CALL_HANDLED"
    }, "*");

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
        <i class="fa-solid fa-mobile-screen"></i>
    `;
});