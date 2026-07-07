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
    launcher.innerHTML = "MF";

    launcher.style.position = "fixed";
    launcher.style.right = "30px";
    launcher.style.bottom = "30px";

    launcher.style.width = "45px";
    launcher.style.height = "45px";

    launcher.style.borderRadius = "50%";
    launcher.style.background = "#2563eb";
    launcher.style.color = "#fff";

    launcher.style.display = "flex";
    launcher.style.alignItems = "center";
    launcher.style.justifyContent = "center";

    launcher.style.cursor = "pointer";
    launcher.style.fontWeight = "bold";
    launcher.style.fontFamily = "Arial";

    launcher.style.boxShadow = "0 10px 25px rgba(0,0,0,.25)";
    launcher.style.zIndex = "2147483647";

    launcher.style.transition = ".25s";

    launcher.onmouseenter = () => {
        launcher.style.transform = "scale(1.08)";
    };

    launcher.onmouseleave = () => {
        launcher.style.transform = "scale(1)";
    };

    launcher.onclick = () => {

        chrome.runtime.sendMessage({
            action: "OPEN_MEETFLOW"
        });

    };

    document.body.appendChild(launcher);

})();