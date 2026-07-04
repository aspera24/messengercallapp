(function () {

    // Ayaw i-run sa MeetFlow website mismo
    if (location.hostname === "meetflow-j39a.onrender.com" ||
        location.hostname === "localhost") {
        return;
    }

    const script = document.createElement("script");
    script.src = chrome.runtime.getURL("widget.min.js");
    document.documentElement.appendChild(script);

})();