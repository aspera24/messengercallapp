
/*
 * MeetFlow - LiveKit media layer
 * Separate from existing Socket.IO chat and meeting requests.
 */

(() => {
    let liveKitRoom = null;
    let localTile = null;

    const liveKitTiles = new Map();

    function getVideoContainer() {
        let container = document.getElementById("livekitVideos");

        if (!container) {
            container = document.createElement("div");
            container.id = "livekitVideos";

            const existingContainer = document.getElementById("videos");

            if (!existingContainer) {
                throw new Error("MeetFlow #videos container not found.");
            }

            existingContainer.appendChild(container);
        }

        return container;
    }

    function createTile(identity, isLocal = false) {
        const container = getVideoContainer();
        const tile = document.createElement("div");

        tile.className = "livekit-tile";
        tile.dataset.identity = identity;

        const label = document.createElement("div");
        label.className = "livekit-name";
        label.textContent = isLocal ? "You" : identity;

        tile.appendChild(label);
        container.appendChild(tile);

        return tile;
    }

    function getTile(identity, isLocal = false) {
        if (isLocal && localTile) {
            return localTile;
        }

        if (liveKitTiles.has(identity)) {
            return liveKitTiles.get(identity);
        }

        const tile = createTile(identity, isLocal);
        liveKitTiles.set(identity, tile);

        if (isLocal) {
            localTile = tile;
        }

        return tile;
    }

    function attachTrack(track, identity, isLocal = false) {
        const tile = getTile(identity, isLocal);
        const element = track.attach();

        if (track.kind === "video") {
            element.autoplay = true;
            element.playsInline = true;
            element.muted = isLocal;
            element.classList.add("livekit-video");
        } else {
            element.autoplay = true;
            element.classList.add("livekit-audio");
        }

        tile.appendChild(element);
    }

    function removeTile(identity) {
        const tile = liveKitTiles.get(identity);

        if (tile) {
            tile.querySelectorAll("video, audio").forEach(element => {
                element.srcObject = null;
                element.remove();
            });

            tile.remove();
            liveKitTiles.delete(identity);
        }

        if (localTile === tile) {
            localTile = null;
        }
    }

    async function connectLiveKit(roomName) {
        if (liveKitRoom) {
            console.warn("LiveKit room is already connected.");
            return;
        }

        if (!window.LivekitClient) {
            throw new Error("LiveKit SDK is not loaded.");
        }

        /*
         * Backend endpoint to be implemented in the next phase.
         * It must return { url, token } after authenticating the user.
         */
        const response = await fetch(
            `/api/livekit/token?room=${encodeURIComponent(roomName)}`,
            {
                method: "GET",
                credentials: "include"
            }
        );

        if (!response.ok) {
            throw new Error(
                `Could not get LiveKit access token (${response.status}).`
            );
        }

        const data = await response.json();

        if (!data.url || !data.token) {
            throw new Error("LiveKit URL or token is missing.");
        }

        const room = new LivekitClient.Room({
            adaptiveStream: true,
            dynacast: true
        });

        liveKitRoom = room;

        room.on(
            LivekitClient.RoomEvent.TrackSubscribed,
            (track, publication, participant) => {
                attachTrack(track, participant.identity);
            }
        );

        room.on(
            LivekitClient.RoomEvent.TrackUnsubscribed,
            (track, publication, participant) => {
                track.detach().forEach(element => element.remove());

                const tile = liveKitTiles.get(participant.identity);

                if (
                    tile &&
                    !tile.querySelector("video, audio")
                ) {
                    removeTile(participant.identity);
                }
            }
        );

        room.on(
            LivekitClient.RoomEvent.ParticipantDisconnected,
            participant => {
                removeTile(participant.identity);
            }
        );

        room.on(LivekitClient.RoomEvent.Disconnected, () => {
            console.log("Disconnected from LiveKit.");
        });

        try {
            await room.connect(data.url, data.token);

            await room.localParticipant.enableCameraAndMicrophone();

            const identity = room.localParticipant.identity;

            getTile(identity, true);

            room.localParticipant.trackPublications.forEach(publication => {
                if (publication.track) {
                    attachTrack(publication.track, identity, true);
                }
            });

            console.log("Connected to LiveKit room:", room.name);
        } catch (error) {
            await room.disconnect();
            liveKitRoom = null;
            throw error;
        }
    }

    async function disconnectLiveKit() {
        if (liveKitRoom) {
            await liveKitRoom.disconnect();
            liveKitRoom = null;
        }

        for (const identity of [...liveKitTiles.keys()]) {
            removeTile(identity);
        }

        removeTile(localTile?.dataset.identity);
        console.log("LiveKit media disconnected.");
    }

    window.MeetFlowLiveKit = {
        connect: connectLiveKit,
        disconnect: disconnectLiveKit,
        getRoom: () => liveKitRoom
    };
})();
