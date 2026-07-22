(async () => {
    console.log("PANEL.JS LOADED");

    const res = await fetch(
        "https://meetflow-j39a.onrender.com/me",
        {
            credentials: "include",
            redirect: "manual"
        }
    );

    console.log("status:", res.status);
    console.log("redirected:", res.redirected);
    console.log("type:", res.type);
    console.log("url:", res.url);

    window.addEventListener("message", (event) => {

        console.log("[PANEL] Message received", event);

        if (event.origin !== "https://meetflow-j39a.onrender.com")
            return;

        chrome.runtime.sendMessage({
            action: event.data.type,
            roomId: event.data.roomId,
            admin: event.data.admin
        });

    });

})();