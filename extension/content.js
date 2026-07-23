(function () {

    console.log("MeetFlow Content Script Loaded");

    if (
        location.hostname === "meetflow-j39a.onrender.com" ||
        location.hostname === "localhost"
    ) {
        return;
    }

    if (document.getElementById("meetflow-launcher"))
        return;

    const launcher = document.createElement("div");

    launcher.id = "meetflow-launcher";
    launcher.innerHTML = `
    <div style="
    font-size:19px;
    font-weight:900;
    font-family:Arial;
    letter-spacing:.5px;
    color:white;
    text-shadow:0 2px 6px rgba(0,0,0,.25);
    ">
    MF
    </div>
    `;

    launcher.style.position = "fixed";
    launcher.style.right = "30px";
    launcher.style.bottom = "30px";

    // launcher.style.width = "45px";
    // launcher.style.height = "45px";

    // launcher.style.borderRadius = "50%";
    // launcher.style.background = "#2563eb";

    launcher.style.width = "58px";
    launcher.style.height = "58px";

    launcher.style.background = `
    linear-gradient(
    135deg,
    #3b82f6 0%,
    #2563eb 45%,
    #1d4ed8 100%
    )
    `;

    launcher.style.borderRadius =
        "42% 58% 61% 39% / 39% 40% 60% 61%";

    launcher.style.boxShadow = `
    0 15px 35px rgba(37,99,235,.45),
    inset 0 2px 8px rgba(255,255,255,.35),
    inset 0 -8px 12px rgba(0,0,0,.18)
    `;

    launcher.style.backdropFilter = "blur(8px)";

    launcher.style.color = "#fff";

    launcher.style.display = "flex";
    launcher.style.alignItems = "center";
    launcher.style.justifyContent = "center";

    launcher.style.cursor = "pointer";
    launcher.style.fontWeight = "bold";
    launcher.style.fontFamily = "Arial";
    launcher.style.zIndex = "2147483647";

    launcher.style.transition = ".25s";

    launcher.style.position = "fixed";

    const drip = document.createElement("div");

    // drip.style.position = "absolute";
    // drip.style.left = "22px";
    // drip.style.bottom = "-14px";

    // drip.style.width = "14px";
    // drip.style.height = "18px";

    // drip.style.background =
    //     "linear-gradient(#2563eb,#1d4ed8)";

    // drip.style.borderRadius =
    //     "50% 50% 60% 60% / 35% 35% 100% 100%";

    // drip.style.boxShadow =
    //     "0 5px 8px rgba(0,0,0,.2)";

    // launcher.appendChild(drip);


    const bubble = document.createElement("div");

    bubble.style.position = "absolute";

    bubble.style.top = "10px";
    bubble.style.left = "10px";

    bubble.style.width = "12px";
    bubble.style.height = "12px";

    bubble.style.borderRadius = "50%";

    bubble.style.background =
        "rgba(255,255,255,.35)";

    bubble.style.filter = "blur(.5px)";

    launcher.appendChild(bubble);

    // Badge
    const badge = document.createElement("span");

    badge.id = "meetflow-badge";

    badge.style.position = "absolute";
    badge.style.top = "3px";
    badge.style.right = "3px";

    badge.style.width = "10px";
    badge.style.height = "10px";

    badge.style.borderRadius = "50%";
    badge.style.background = "#ff3b30";

    badge.style.display = "none";

    launcher.appendChild(badge);

    launcher.onmouseenter = () => {

        launcher.getAnimations().forEach(a => a.cancel());

        launcher.animate([
            {
                transform: "translateY(0) scale(1)"
            },
            {
                transform: "translateY(-6px) scale(1.08)"
            }
        ], {
            duration: 180,
            fill: "forwards"
        });

    };

    launcher.onmouseleave = () => {

        launcher.getAnimations().forEach(a => a.cancel());

        launcher.animate([
            {
                transform: "translateY(-6px) scale(1.08)"
            },
            {
                transform: "translateY(0) scale(1)"
            }
        ], {
            duration: 180,
            fill: "forwards"
        });

    };

    launcher.onclick = () => {

        chrome.runtime.sendMessage({
            action: "OPEN_MEETFLOW"
        });

    };

    document.body.appendChild(launcher);

    window.addEventListener("message", (event) => {

        console.log("CONTENT RECEIVED:", event.data);

        if (event.data.type === "CALL_HANDLED") {

            console.log("STOPPING ANIMATION");

            badge.style.display = "none";
            launcher.getAnimations().forEach(a => a.cancel());

        }

    });

    // LISTEN FROM BACKGROUND
    chrome.runtime.onMessage.addListener((message) => {

        if (message.type === "INCOMING_CALL") {

            badge.style.display = "block";

            launcher.animate([
                {
                    transform: "scale(1)"
                },
                {
                    transform: "scale(1.12,.92)"
                },
                {
                    transform: "scale(.92,1.12)"
                },
                {
                    transform: "scale(1.08,.95)"
                },
                {
                    transform: "scale(1)"
                }
            ], {
                duration: 550,
                iterations: Infinity
            });

        }

        if (message.type === "CALL_HANDLED") {

            badge.style.display = "none";

            launcher.getAnimations().forEach(a => a.cancel());

        }

        if (message.type === "CALL_ENDED") {

            badge.style.display = "none";

            launcher.getAnimations().forEach(a => a.cancel());

        }

    });

})();