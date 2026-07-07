window.addEventListener("message", (event) => {

    if (event.origin !== "https://meetflow-j39a.onrender.com")
        return;

    if (event.data.type === "OPEN_CALL_WINDOW") {

        chrome.runtime.sendMessage({

            action: "OPEN_CALL_WINDOW",

            callId: event.data.callId

        });

    }

});