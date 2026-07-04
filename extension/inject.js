(function () {

    console.log("Inject Script Running");

    if (document.getElementById("meetflow-test"))
        return;

    const div = document.createElement("div");

    div.id = "meetflow-test";

    div.innerHTML = "MeetFlow";

    div.style.position = "fixed";
    div.style.right = "20px";
    div.style.bottom = "20px";

    div.style.width = "180px";
    div.style.height = "50px";

    div.style.background = "#2563eb";
    div.style.color = "#fff";

    div.style.display = "flex";
    div.style.alignItems = "center";
    div.style.justifyContent = "center";

    div.style.borderRadius = "10px";

    div.style.zIndex = "2147483647";

    div.style.cursor = "pointer";

    document.body.appendChild(div);

})();