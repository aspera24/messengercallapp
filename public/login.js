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
            headers: {
                "Content-Type": "application/json"
            },
            credentials: "include",
            body: JSON.stringify({
                username,
                password
            })
        });

        const data = await res.json();

        if (data.success) {

            await chrome.storage.local.set({
                token: data.token
            });

            const session = await fetch("/session", {
                headers: {
                    Authorization: `Bearer ${data.token}`
                }
            });

            location.href = "/dashboard";

        } else {

            alert("Invalid username or password.");

            loginBtn.disabled = false;
            loginBtn.innerHTML = originalHTML;
        }

    } catch (err) {

        alert("Unable to connect to the server.");
        console.log(`login logs : ${err}`)
        // Restore button
        loginBtn.disabled = false;
        loginBtn.innerHTML = originalHTML;
    }
}


document.getElementById("loginForm").addEventListener("submit", function (e) {
    e.preventDefault();
    login();
});