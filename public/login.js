async function login() {

    const username = document.getElementById("username").value.trim();
    const password = document.getElementById("password").value;
    const loginBtn = document.getElementById("loginBtn");

    if (!username || !password) {
        alert("Please enter username and password.");
        return;
    }

    // Save original button
    const originalHTML = loginBtn.innerHTML;

    // Loading state
    loginBtn.disabled = true;
    loginBtn.innerHTML = `
        <i class="fa-solid fa-spinner"></i>
        <span>Signing in...</span>
    `;

    try {

        const res = await fetch("/login", {
            method: "POST",
            credentials: "include",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                username,
                password
            })
        });

        const data = await res.json();

        if (data.success) {

            // If inside extension iframe
            if (window.parent !== window) {

                window.parent.postMessage({
                    type: "LOGIN_SUCCESS",
                    sessionToken: data.sessionToken
                }, "*");

            }

            location.href = "/dashboard";

        } else {
            alert("Invalid username or password.");

            loginBtn.disabled = false;
            loginBtn.innerHTML = originalHTML;
        }

    } catch (err) {
        console.error("LOGIN ERROR:", err);

        alert(err.message);

        loginBtn.disabled = false;
        loginBtn.innerHTML = originalHTML;
    }
}


document.getElementById("loginForm").addEventListener("submit", function (e) {
    e.preventDefault();
    login();
});