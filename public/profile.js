


const message = document.getElementById("message");

function showMessage(text, type) {
    message.textContent = text;
    message.className = `message ${type}`;
}


function clearMessage() {
    message.textContent = "";
    message.className = "message";
}


function formatDate(date) {
    if (!date) return "N/A";

    const parsedDate = new Date(date);

    if (isNaN(parsedDate.getTime())) {
        return date;
    }

    return parsedDate.toLocaleString("en-US", {
        year: "numeric",
        month: "long",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit"
    });

}


async function loadProfile() {

    try {

        const response = await fetch("/profile", {
            method: "GET",
            credentials: "include"
        });

        const data = await response.json();

        if (!response.ok) {

            throw new Error(
                data.message || "Failed to load profile."
            );

        }


        document.getElementById("displayFirstName").textContent =
            data.first_name || "N/A";

        document.getElementById("displayLastName").textContent =
            data.last_name || "N/A";

        document.getElementById("displayUsername").textContent =
            data.username || "N/A";

        document.getElementById("displayCreatedAt").textContent =
            formatDate(data.created_at);


        document.getElementById("firstName").value =
            data.first_name || "";

        document.getElementById("lastName").value =
            data.last_name || "";

        document.getElementById("username").value =
            data.username || "";


    } catch (error) {

        console.error(error);

        showMessage(
            error.message || "Failed to load profile.",
            "error"
        );

    }

}


document
    .getElementById("profileForm")
    .addEventListener("submit", async function (event) {

        event.preventDefault();

        clearMessage();

        const button =
            document.getElementById("saveProfileBtn");

        const originalText = button.textContent;

        button.disabled = true;
        button.textContent = "Saving...";


        try {

            const response = await fetch("/profile", {

                method: "PUT",

                headers: {
                    "Content-Type": "application/json"
                },

                credentials: "include",

                body: JSON.stringify({

                    first_name:
                        document.getElementById("firstName").value.trim(),

                    last_name:
                        document.getElementById("lastName").value.trim(),

                    username:
                        document.getElementById("username").value.trim()

                })

            });


            const data = await response.json();


            if (!response.ok) {

                throw new Error(
                    data.message || "Failed to update profile."
                );

            }


            showMessage(
                "Profile updated successfully.",
                "success"
            );

            await loadProfile();


        } catch (error) {

            console.error(error);

            showMessage(
                error.message || "Failed to update profile.",
                "error"
            );

        } finally {

            button.disabled = false;
            button.textContent = originalText;

        }

    });


document
    .getElementById("passwordForm")
    .addEventListener("submit", async function (event) {

        event.preventDefault();

        clearMessage();


        const currentPassword =
            document.getElementById("currentPassword").value;

        const newPassword =
            document.getElementById("newPassword").value;

        const confirmPassword =
            document.getElementById("confirmPassword").value;


        if (newPassword !== confirmPassword) {

            showMessage(
                "New password and confirmation do not match.",
                "error"
            );

            return;

        }


        if (newPassword.length < 8) {

            showMessage(
                "New password must be at least 8 characters.",
                "error"
            );

            return;

        }


        const button =
            document.getElementById("changePasswordBtn");

        const originalText = button.textContent;

        button.disabled = true;
        button.textContent = "Changing...";


        try {

            const response = await fetch(
                "/profile/password",
                {

                    method: "PUT",

                    headers: {
                        "Content-Type": "application/json"
                    },

                    credentials: "include",

                    body: JSON.stringify({

                        current_password: currentPassword,

                        new_password: newPassword

                    })

                }
            );


            const data = await response.json();


            if (!response.ok) {

                throw new Error(
                    data.message || "Failed to change password."
                );

            }


            document
                .getElementById("passwordForm")
                .reset();


            showMessage(
                "Password changed successfully.",
                "success"
            );


        } catch (error) {

            console.error(error);

            showMessage(
                error.message || "Failed to change password.",
                "error"
            );

        } finally {

            button.disabled = false;
            button.textContent = originalText;

        }

    });


document
    .querySelectorAll(".togglePassword")
    .forEach(button => {

        button.addEventListener("click", function () {

            const target =
                document.getElementById(
                    this.dataset.target
                );

            if (!target) return;


            const icon = this.querySelector("i");

            if (target.type === "password") {

                target.type = "text";

                icon.classList.remove("fa-eye");
                icon.classList.add("fa-eye-slash");

                this.setAttribute("aria-label", "Hide password");

            } else {

                target.type = "password";

                icon.classList.remove("fa-eye-slash");
                icon.classList.add("fa-eye");

                this.setAttribute("aria-label", "Show password");

            }

        });

    });


loadProfile();

