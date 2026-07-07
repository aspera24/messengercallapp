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

        url: chrome.runtime.getURL("dashboard.html"),

        type: "popup",

        width: 420,
        height: 720

    });

}

chrome.windows.onRemoved.addListener((windowId) => {

    if (windowId === meetflowWindowId) {

        meetflowWindowId = null;

    }

});