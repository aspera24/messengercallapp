fetch("http://localhost:3000/me", {
    credentials: "include"
})
    .then(r => r.json())
    .then(data => {

        document.getElementById("app").innerHTML =
            "Hello " + data.user.firstname;

    })
    .catch(() => {

        document.getElementById("app").innerHTML =
            "Not Logged In";

    });