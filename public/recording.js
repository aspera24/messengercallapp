(() => {
    let mediaRecorder = null;
    let recordedChunks = [];
    let recordingStartedAt = null;

    let recordingCanvas = null;
    let recordingContext = null;
    let canvasStream = null;
    let audioContext = null;
    let animationFrame = null;

    const startBtn = document.getElementById("startRecordingBtn");
    const stopBtn = document.getElementById("stopRecordingBtn");
    let recordingToastTimer = null;

    function showRecordingToast(title, message, icon = "fa-circle-info") {
        const toast = document.getElementById("toast");
        const toastTitle = document.getElementById("toastTitle");
        const toastMessage = document.getElementById("toastMessage");
        const toastIcon = document.getElementById("toastIcon");

        if (!toast || !toastTitle || !toastMessage || !toastIcon) {
            console.log(`[${title}] ${message}`);
            return;
        }

        toastTitle.textContent = title;
        toastMessage.textContent = message;

        toastIcon.className = `fa-solid ${icon}`;

        toast.classList.add("show");

        clearTimeout(recordingToastTimer);

        recordingToastTimer = setTimeout(() => {
            toast.classList.remove("show");
        }, 3500);
    }

    // GET ALL MEETING VIDEO ELEMENTS
    function getMeetingVideos() {

        return [
            ...new Set(
                document.querySelectorAll(
                    "#videoGrid video, #videos video, #localBox video, .video-box video"
                )
            )
        ];

    }

    // GET ALL PARTICIPANT STREAMS
    function getMeetingStreams() {

        const streams = [];

        // GET STREAMS FROM ALL VIDEO ELEMENTS
        getMeetingVideos().forEach(video => {

            const stream = video.srcObject;

            if (stream instanceof MediaStream) {
                streams.push(stream);
            }

        });

        // REMOVE DUPLICATES
        return [
            ...new Map(
                streams.map(stream => [stream.id, stream])
            ).values()
        ];

    }

    // CREATE VIDEO COMPOSITION
    function createRecordingCanvas() {

        recordingCanvas = document.createElement("canvas");

        recordingCanvas.width = 1280;
        recordingCanvas.height = 720;

        recordingContext = recordingCanvas.getContext("2d");

        function drawFrame() {

            const ctx = recordingContext;
            const width = recordingCanvas.width;
            const height = recordingCanvas.height;

            ctx.fillStyle = "#111";
            ctx.fillRect(0, 0, width, height);

            const videos = getMeetingVideos().filter(video => {
                return video.readyState >= 2 &&
                    video.videoWidth > 0 &&
                    video.videoHeight > 0;
            });

            if (videos.length > 0) {

                const columns = Math.ceil(Math.sqrt(videos.length));
                const rows = Math.ceil(videos.length / columns);

                const tileWidth = width / columns;
                const tileHeight = height / rows;

                videos.forEach((video, index) => {

                    const col = index % columns;
                    const row = Math.floor(index / columns);

                    const x = col * tileWidth;
                    const y = row * tileHeight;

                    const videoRatio = video.videoWidth / video.videoHeight;
                    const tileRatio = tileWidth / tileHeight;

                    let sx = 0;
                    let sy = 0;
                    let sw = video.videoWidth;
                    let sh = video.videoHeight;

                    if (videoRatio > tileRatio) {
                        sw = video.videoHeight * tileRatio;
                        sx = (video.videoWidth - sw) / 2;
                    } else {
                        sh = video.videoWidth / tileRatio;
                        sy = (video.videoHeight - sh) / 2;
                    }

                    ctx.drawImage(
                        video,
                        sx, sy, sw, sh,
                        x, y, tileWidth, tileHeight
                    );

                });

            }

            animationFrame = requestAnimationFrame(drawFrame);
        }

        drawFrame();

        return recordingCanvas.captureStream(30);

    }

    // MIX ALL PARTICIPANT AUDIO

    async function createMeetingAudio() {

        audioContext = new AudioContext();

        if (audioContext.state === "suspended") {
            await audioContext.resume();
        }

        const streams = getMeetingStreams();

        const destination = audioContext.createMediaStreamDestination();

        const connectedTrackIds = new Set();

        let connectedCount = 0;

        streams.forEach(stream => {

            stream.getAudioTracks().forEach(track => {

                if (
                    track.readyState !== "live" ||
                    connectedTrackIds.has(track.id)
                ) {
                    return;
                }

                connectedTrackIds.add(track.id);

                // ONE SOURCE PER AUDIO TRACK
                const audioStream = new MediaStream([track]);

                const source = audioContext.createMediaStreamSource(audioStream);

                const gain = audioContext.createGain();

                gain.gain.value = 1;

                source.connect(gain);
                gain.connect(destination);

                connectedCount++;

                console.log(
                    "[RECORDING AUDIO] Connected:",
                    track.label,
                    track.id
                );

            });

        });

        console.log("[RECORDING AUDIO] Total connected:", connectedCount);

        if (connectedCount === 0) {
            console.warn("[RECORDING AUDIO] No audio tracks found.");
        }

        return destination.stream.getAudioTracks();

    }


    // START RECORDING
    startBtn.addEventListener("click", async () => {

        try {

            // SELECT RECORDING FOLDER
            let folder = await getRecordingFolder();

            if (!folder) {
                await chooseRecordingFolder();
                folder = await getRecordingFolder();
            }

            if (!folder) {
                throw new Error("Please select a recording folder first.");
            }

            // CHECK MEETING VIDEOS
            const videos = getMeetingVideos();

            if (videos.length === 0) {
                throw new Error("No meeting videos found.");
            }

            recordedChunks = [];

            // CREATE COMBINED VIDEO
            canvasStream = createRecordingCanvas();

            // MIX PARTICIPANT AUDIO
            const audioTracks = await createMeetingAudio();

            console.log(
                "[RECORDING] Audio tracks:",
                audioTracks.length
            );

            const combinedStream = new MediaStream([
                ...canvasStream.getVideoTracks(),
                ...audioTracks
            ]);

            // CHECK SUPPORTED FORMAT
            const mimeTypes = [
                "video/webm;codecs=vp9,opus",
                "video/webm;codecs=vp8,opus",
                "video/webm"
            ];

            const supportedMimeType = mimeTypes.find(type =>
                MediaRecorder.isTypeSupported(type)
            );

            if (!supportedMimeType) {
                throw new Error("Your browser does not support WebM recording.");
            }

            mediaRecorder = new MediaRecorder(combinedStream, {
                mimeType: supportedMimeType
            });

            mediaRecorder.ondataavailable = event => {

                if (event.data.size > 0) {
                    recordedChunks.push(event.data);
                }

            };

            mediaRecorder.onstop = async () => {

                showRecordingToast(
                    "Saving Recording",
                    "Please wait while your recording is being saved...",
                    "fa-spinner fa-spin"
                );

                const blob = new Blob(recordedChunks, {
                    type: mediaRecorder.mimeType
                });

                const filename = `MF-${Date.now()}.webm`;

                try {

                    await saveRecordingFile(blob, {
                        id: crypto.randomUUID(),
                        filename,
                        meetingId: "MEETFLOW-" + Date.now()
                    });

                    console.log("Recording saved:", filename);

                    showRecordingToast(
                        "Recording Saved",
                        "Your meeting recording has been saved successfully.",
                        "fa-circle-check"
                    );

                } catch (error) {

                    console.error("Recording save failed:", error);

                    showRecordingToast(
                        "Recording Failed",
                        error.message,
                        "fa-circle-exclamation"
                    );

                } finally {

                    if (animationFrame) {
                        cancelAnimationFrame(animationFrame);
                        animationFrame = null;
                    }

                    canvasStream?.getTracks().forEach(track => track.stop());

                    if (audioContext && audioContext.state !== "closed") {
                        await audioContext.close();
                    }

                    canvasStream = null;
                    audioContext = null;

                    startBtn.classList.remove("recording");
                    startBtn.disabled = false;

                    stopBtn.disabled = true;
                    stopBtn.style.display = "none";
                    stopBtn.innerHTML = '<i class="fa-solid fa-stop"></i>';

                    mediaRecorder = null;
                    recordedChunks = [];
                }
            };

            mediaRecorder.start(1000);

            recordingStartedAt = Date.now();

            startBtn.classList.add("recording");
            startBtn.disabled = true;

            stopBtn.style.display = "inline-flex";
            stopBtn.disabled = false;

            showRecordingToast(
                "Recording Started",
                "Your meeting is now being recorded.",
                "fa-circle-dot"
            );

            console.log("Meeting recording started.");

        } catch (error) {

            console.error("Recording error:", error);

            showRecordingToast(
                "Recording Error",
                error.message,
                "fa-circle-exclamation"
            );

            if (animationFrame) {
                cancelAnimationFrame(animationFrame);
                animationFrame = null;
            }

            canvasStream?.getTracks().forEach(track => track.stop());

            if (audioContext && audioContext.state !== "closed") {
                await audioContext.close();
            }

            canvasStream = null;
            audioContext = null;

            startBtn.classList.remove("recording");
            startBtn.disabled = false;
            stopBtn.disabled = true;
            stopBtn.style.display = "none";
            stopBtn.innerHTML = '<i class="fa-solid fa-stop"></i>';

        }

    });

    // STOP RECORDING
    stopBtn.addEventListener("click", () => {

        if (!mediaRecorder || mediaRecorder.state === "inactive") {
            return;
        }

        // Prevent multiple clicks
        stopBtn.disabled = true;

        // Change STOP icon to loading spinner
        stopBtn.innerHTML = `
        <i class="fa-solid fa-spinner fa-spin"></i>
    `;

        showRecordingToast(
            "Stopping Recording",
            "Finalizing your meeting recording. Please wait...",
            "fa-spinner fa-spin"
        );

        mediaRecorder.stop();

    });
})();