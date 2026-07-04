chrome.runtime.onInstalled.addListener(() => {

    console.log("MeetFlow Extension Installed");

});

chrome.runtime.onStartup.addListener(() => {

    console.log("Chrome Started");

});