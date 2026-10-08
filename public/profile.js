


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


/* =========================================
   PROFILE PICTURE
========================================= */

const profilePictureInput =
    document.getElementById("profilePictureInput");

const profilePicturePreview =
    document.getElementById("profilePicturePreview");

const removeProfilePictureBtn =
    document.getElementById("removeProfilePictureBtn");


/*
 * Preview selected image
 */
profilePictureInput.addEventListener("change", function () {

    const file = this.files[0];

    if (!file) return;


    const allowedTypes = [
        "image/jpeg",
        "image/png",
        "image/webp"
    ];


    if (!allowedTypes.includes(file.type)) {

        showMessage(
            "Please select a JPG, PNG, or WEBP image.",
            "error"
        );

        this.value = "";
        return;

    }


    /*
     * 2 MB maximum
     */
    if (file.size > 2 * 1024 * 1024) {

        showMessage(
            "Profile picture must be 2 MB or smaller.",
            "error"
        );

        this.value = "";
        return;

    }


    const reader = new FileReader();


    reader.onload = function (event) {

        profilePicturePreview.src =
            event.target.result;

    };


    reader.readAsDataURL(file);

});


/*
 * Upload profile picture
 */
async function uploadProfilePicture() {

    const file =
        profilePictureInput.files[0];

    if (!file) {

        showMessage(
            "Please choose a profile picture first.",
            "error"
        );

        return;

    }


    const formData = new FormData();

    formData.append(
        "profilePicture",
        file
    );


    try {

        showMessage(
            "Uploading profile picture...",
            "success"
        );


        const response = await fetch(
            "/profile/picture",
            {

                method: "PUT",

                credentials: "include",

                body: formData

            }
        );


        const data =
            await response.json();


        if (!response.ok) {

            throw new Error(
                data.message ||
                "Failed to update profile picture."
            );

        }


        /*
         * Use returned picture URL if backend provides it
         */
        if (data.profile_picture) {

            profilePicturePreview.src =
                data.profile_picture;

        }


        profilePictureInput.value = "";


        showMessage(
            "Profile picture updated successfully.",
            "success"
        );


    } catch (error) {

        console.error(error);

        showMessage(
            error.message ||
            "Failed to update profile picture.",
            "error"
        );

    }

}


/*
 * Automatically upload after selecting
 */
profilePictureInput.addEventListener(
    "change",
    uploadProfilePicture
);


/*
 * Remove profile picture
 */
removeProfilePictureBtn.addEventListener(
    "click",
    async function () {

        try {

            const response = await fetch(
                "/profile/picture",
                {

                    method: "DELETE",

                    credentials: "include"

                }
            );


            const data =
                await response.json();


            if (!response.ok) {

                throw new Error(
                    data.message ||
                    "Failed to remove profile picture."
                );

            }


            profilePicturePreview.src =
                "/default-profile.png";


            profilePictureInput.value = "";


            showMessage(
                "Profile picture removed successfully.",
                "success"
            );


        } catch (error) {

            console.error(error);

            showMessage(
                error.message ||
                "Failed to remove profile picture.",
                "error"
            );

        }

    }
);



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

        const profilePicturePreview =
            document.getElementById("profilePicturePreview");


        if (profilePicturePreview) {

            try {

                const response =
                    await fetch(
                        "/profile/picture",
                        {
                            credentials: "include"
                        }
                    );


                if (response.ok) {

                    const blob =
                        await response.blob();


                    profilePicturePreview.src =
                        URL.createObjectURL(blob);

                } else {

                    profilePicturePreview.src =
                        "/default-profile.png";

                }

            } catch (error) {

                console.error(
                    "LOAD PROFILE PICTURE ERROR:",
                    error
                );

                profilePicturePreview.src =
                    "/default-profile.png";

            }

        }


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

