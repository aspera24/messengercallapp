importScripts("socket.io.min.js");

let socket = null;
let meetflowWindowId = null;

function broadcastToTabs(message) {

    chrome.tabs.query({}, (tabs) => {

        tabs.forEach((tab) => {

            chrome.tabs.sendMessage(tab.id, message, () => {
                if (chrome.runtime.lastError) return;
            });

        });

    });

}

function connectSocket() {

    chrome.storage.local.get("meetflowToken", ({ meetflowToken }) => {

        if (socket && socket.connected) {
            return;
        }

        if (!meetflowToken) {
            console.log("No MeetFlow token found.");
            return;
        }

        socket = io("https://meetflow-j39a.onrender.com", {
            auth: {
                token: meetflowToken
            }
        });

        socket.on("connect", () => {
            console.log("Socket Connected:", socket.id);
        });

        socket.on("disconnect", () => {
            console.log("Socket Disconnected");
        });

        socket.on("connect_error", (err) => {
            console.error("Socket Auth Error:", err.message);
        });

        socket.on("meeting-request", (data) => {

            console.log("[BACKGROUND] Incoming Call", data);

            broadcastToTabs({
                type: "INCOMING_CALL",
                roomId: data.roomId,
                admin: data.admin
            });

        });

        socket.on("meeting-ended", () => {

            console.log("[BACKGROUND] Meeting Ended");

            broadcastToTabs({
                type: "CALL_ENDED"
            });

        });

    });

}

connectSocket();

chrome.runtime.onInstalled.addListener(() => {
    console.log("MeetFlow Extension Installed");
});

chrome.runtime.onStartup.addListener(() => {
    console.log("Chrome Started");
});

chrome.runtime.onMessage.addListener((message, sender) => {

    console.log("[BACKGROUND]", message);

    switch (message.action) {

        case "OPEN_MEETFLOW":

            if (sender.tab) {

                chrome.sidePanel.open({
                    windowId: sender.tab.windowId
                });

            }

            break;

        case "CONNECT_SOCKET":

            connectSocket();

            break;

        case "INCOMING_CALL":

            broadcastToTabs({
                type: "INCOMING_CALL",
                roomId: message.roomId,
                admin: message.admin
            });

            break;

        case "CALL_ENDED":

            broadcastToTabs({
                type: "CALL_ENDED"
            });

            break;

    }

});

function openMeetFlow() {

    chrome.windows.create({
        url: "https://meetflow-j39a.onrender.com",
        type: "popup",
        width: 420,
        height: 720
    }, (window) => {

        meetflowWindowId = window.id;

    });

}

chrome.windows.onRemoved.addListener((windowId) => {

    if (windowId === meetflowWindowId) {
        meetflowWindowId = null;
    }

});