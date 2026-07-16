(async () => {

    try {

        const res = await fetch(
            "https://meetflow-j39a.onrender.com/me",
            {
                credentials: "include"
            }
        );

        console.log("status:", res.status);
        console.log("redirected:", res.redirected);
        console.log("url:", res.url);
        console.log(await res.text());

        if (res.ok) {
            location.replace("dashboard.html");
        } else {
            location.replace("login.html");
        }

    } catch (err) {
        location.replace("login.html");
    }

})();