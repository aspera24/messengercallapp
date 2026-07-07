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