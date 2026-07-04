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

            location.href = "/dashboard";

        } else {

            alert("Invalid username or password.");

            // Restore button
            loginBtn.disabled = false;
            loginBtn.innerHTML = originalHTML;
        }

    } catch (err) {

        alert("Unable to connect to the server.");

        // Restore button
        loginBtn.disabled = false;
        loginBtn.innerHTML = originalHTML;
    }
}


document.getElementById("loginForm").addEventListener("submit", function (e) {
    e.preventDefault(); 
    login();
});