(async () => {

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

})();