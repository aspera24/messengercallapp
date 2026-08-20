async function login() {

    const usernameInput = document.getElementById("username");
    const passwordInput = document.getElementById("password");
    const loginBtn = document.getElementById("loginBtn");

    const username = usernameInput.value.trim();
    const password = passwordInput.value;

    if (!username || !password) {
        alert("Please enter username and password.");
        return;
    }

    // Save original button
    const originalHTML = loginBtn.innerHTML;

    // Disable inputs + button
    usernameInput.disabled = true;
    passwordInput.disabled = true;
    loginBtn.disabled = true;

    // Loading state
    loginBtn.innerHTML = `
        <i class="fa-solid fa-spinner fa-spin"></i>
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

            // Enable again
            usernameInput.disabled = false;
            passwordInput.disabled = false;
            loginBtn.disabled = false;
            loginBtn.innerHTML = originalHTML;
        }

    } catch (err) {

        console.error("LOGIN ERROR:", err);

        alert(err.message);

        // Enable again
        usernameInput.disabled = false;
        passwordInput.disabled = false;
        loginBtn.disabled = false;
        loginBtn.innerHTML = originalHTML;
    }
}


document.getElementById("loginForm").addEventListener("submit", function (e) {
    e.preventDefault();
    login();
});
