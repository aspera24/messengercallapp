(function () {

    console.log("Content Script Loaded");

    if (
        location.hostname === "meetflow-j39a.onrender.com" ||
        location.hostname === "localhost"
    ) {
        return;
    }

})();