importScripts("socket.io.min.js");

const socket = io("https://meetflow-j39a.onrender.com", {
    withCredentials: true
});

socket.on("meeting-request", (data) => {

    chrome.runtime.sendMessage({
        type: "incoming-call",
        roomId: data.roomId,
        admin: data.admin
    });

});

let meetflowWindowId = null;

chrome.runtime.onInstalled.addListener(() => {
    console.log("MeetFlow Extension Installed");
});

chrome.runtime.onStartup.addListener(() => {
    console.log("Chrome Started");
});

chrome.runtime.onMessage.addListener((message, sender) => {

    if (message.action !== "OPEN_MEETFLOW")
        return;

    chrome.sidePanel.open({
        windowId: sender.tab.windowId
    });

});

chrome.tabs.query({}, (tabs) => {

    for (const tab of tabs) {

        chrome.tabs.sendMessage(tab.id, {
            type: "INCOMING_CALL"
        });

    }

});

chrome.tabs.query({}, (tabs) => {

    for (const tab of tabs) {

        chrome.tabs.sendMessage(tab.id, {
            type: "CALL_ENDED"
        });

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