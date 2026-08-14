// const socket = io();
let table;
let activeChatUser = null;

let chatCursor = null;
let chatHasMore = false;
let chatLoading = false;

const loadedMessageIds = new Set();
const pendingReadMessageIds = new Set();


async function loadUsers() {

    const res = await fetch("/users", {
        credentials: "include"
    });

    const users = await res.json();

    if (table) {
        table.destroy();
        $("#userTable tbody").empty();
    }

    table = new DataTable("#userTable", {

        data: users,

        columns: [

            {
                data: null,
                render: function (data) {

                    return `
                        <div
                            class="employeeName"
                            onclick="openChat(
                                '${data.token}',
                                '${data.firstname}',
                                '${data.lastname}'
                            )"
                        >
                            ${data.firstname}
                        </div>
                    `;
                }
            },

            {
                data: null,
                orderable: false,
                render: function (data) {

                    return `

                        <button
                            title="Request a call"
                            class="reqBtn"
                            id="req-${data.token}"
                            onclick="requestUser('${data.token}')"
                            ${data.joined ? "disabled" : ""}
                        >

                        ${data.joined
                            ? '<i class="fa-solid fa-circle-check"></i>'
                            : '<i class="fa-solid fa-paper-plane"></i>'
                        }

                        </button>

                        <button
                            title="Remove user"
                            class="deleteBtn"
                            id="delete-${data.token}"
                            onclick="deleteUser('${data.token}')"
                            ${data.joined ? "disabled" : ""}
                        >
                            <i class="fa-solid fa-trash-can"></i>
                        </button>

                    `;
                }
            }

        ],

        pageLength: 10,
        lengthMenu: [
            [10, 15, 25, 50, -1],
            [10, 15, 25, 50, "All"]
        ],
        responsive: true,
        searching: true,
        ordering: true,
        info: true,
        lengthChange: true,
        pagingType: "simple",
        columnDefs: [
            {
                targets: 0,
                width: "250px"
            },
            {
                targets: 1,
                width: "10px"
            }
        ],
        language: {
            paginate: {
                previous: "Prev",
                next: "Next"
            }
        }

    });

}

async function openChat(token, firstname, lastname) {

    activeChatUser = {
        token: token,
        firstname: firstname
    };


    // Reset pagination
    chatCursor = null;
    chatHasMore = false;
    chatLoading = false;

    loadedMessageIds.clear();


    const container = document.getElementById("messageContainer");
    const userName = document.getElementById("messageUserName");
    const messageBody = document.getElementById("messageBody");
    const messageText = document.getElementById("messageText");

    userName.textContent = firstname + " " + lastname;
    container.style.display = "flex";


    // Loading state
    messageBody.innerHTML = `
        <div class="messageEmpty">
            <i class="fa-solid fa-spinner fa-spin"></i>
            <span>Loading messages...</span>
        </div>
    `;


    try {

        const response = await fetch(
            `/messages/${encodeURIComponent(token)}?limit=10`,
            {
                credentials: "include"
            }
        );


        if (!response.ok) {

            throw new Error(
                `HTTP ${response.status}`
            );

        }


        const data = await response.json();

        socket.emit("mark-chat-read", {
            from: token
        });

        // Make sure this is still the selected user
        if (
            !activeChatUser ||
            activeChatUser.token !== token
        ) {
            return;
        }


        messageBody.innerHTML = "";

        chatCursor = data.nextCursor;
        chatHasMore = data.hasMore;

        if (!data.messages.length) {
            messageBody.innerHTML = `
                <div class="messageEmpty">
                    <i class="fa-regular fa-comments"></i>
                    <span>
                        Start a conversation with ${firstname}
                    </span>
                </div>
            `;
        } else {
            data.messages.forEach(message => {

                addChatMessage(
                    message.message,
                    message.isMine ? "sent" : "received",
                    message.id,
                    message.created_at,
                    false,
                    Number(message.is_deleted) === 1,
                    Number(message.is_read) === 1
                );

            });
        }


        // Scroll to bottom
        messageBody.scrollTop = messageBody.scrollHeight;
        messageText.focus();

    } catch (error) {

        console.error(
            "Failed to load chat:",
            error
        );


        messageBody.innerHTML = `
            <div class="messageEmpty">
                <i class="fa-solid fa-triangle-exclamation"></i>
                <span>
                    Failed to load messages.
                </span>
            </div>
        `;

    }

}

document.getElementById("closeMessageBtn")
    .addEventListener("click", function () {
        document.getElementById("messageContainer").style.display = "none";
        activeChatUser = null;
    });

document.getElementById("sendMessageBtn")
    .addEventListener("click", sendChatMessage);

document.getElementById("messageText")
    .addEventListener("keydown", function (e) {

        if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            sendChatMessage();
        }

    });

socket.on("chat-message-sent", function (data) {

    if (
        !activeChatUser ||
        activeChatUser.token !== data.to
    ) {
        return;
    }


    addChatMessage(
        data.message,
        "sent",
        data.id,
        data.createdAt,
        true,
        false,
        false
    );


    const input = document.getElementById("messageText");
    input.value = "";
    input.style.height = "auto";
    input.focus();

}
);

function sendChatMessage() {

    const input = document.getElementById("messageText");

    const message = input.value.trim();

    if (!message) return;

    if (!activeChatUser) return;


    socket.emit("chat-message", {

        to: activeChatUser.token,

        message: message

    });

}

function addChatMessage(
    message,
    type,
    id = null,
    createdAt = null,
    scroll = true,
    isDeleted = false,
    isRead = false
) {

    const body = document.getElementById("messageBody");
    const empty = body.querySelector(".messageEmpty");

    if (empty) {
        empty.remove();
    }

    // PREVENT DUPLICATES
    if (
        id !== null &&
        loadedMessageIds.has(Number(id))
    ) {
        return;
    }

    if (id !== null) {
        loadedMessageIds.add(Number(id));
    }

    // MESSAGE WRAPPER
    const wrapper = document.createElement("div");
    wrapper.className = `chatMessageWrapper ${type}`;

    if (id !== null) {
        wrapper.dataset.messageId = id;
    }

    // AVATAR
    const avatar = document.createElement("div");
    avatar.className = "chatMessageAvatar";
    avatar.innerHTML = `<i class="fa-solid fa-user"></i>`;

    // CONTENT
    const content = document.createElement("div");
    content.className = "chatMessageContent";

    // MESSAGE BUBBLE
    const bubble = document.createElement("div");
    bubble.className = "chatMessage";

    if (isDeleted) {
        bubble.classList.add("deleted");
    }

    bubble.textContent = isDeleted
        ? "This message was deleted."
        : message;

    content.appendChild(bubble);

    // TIMESTAMP
    // if (createdAt) {

    //     const timestamp = document.createElement("div");

    //     timestamp.className = "messageTimestamp";

    //     const date = new Date(createdAt);

    //     timestamp.textContent = date.toLocaleString("en-US", {
    //         month: "short",
    //         day: "numeric",
    //         year: "numeric",
    //         hour: "numeric",
    //         minute: "2-digit"
    //     });

    //     content.appendChild(timestamp);

    //     bubble.addEventListener(
    //         "click",
    //         function (e) {
    //             e.stopPropagation();
    //             timestamp.classList.toggle("show");
    //         }
    //     );
    // }

    if (createdAt) {

        const timestamp = document.createElement("div");

        timestamp.className = "messageTimestamp";

        const date = new Date(createdAt);

        timestamp.textContent = date.toLocaleString("en-US", {
            month: "short",
            day: "numeric",
            year: "numeric",
            hour: "numeric",
            minute: "2-digit"
        });

        content.appendChild(timestamp);
    }

    // READ STATUS
    if (
        type === "sent" &&
        id !== null &&
        !isDeleted
    ) {

        const readStatus = document.createElement("div");
        readStatus.className = "messageReadStatus";
        readStatus.dataset.messageId = id;
        const messageId = Number(id);

        const alreadyRead =
            Number(isRead) === 1 ||
            pendingReadMessageIds.has(messageId);

        readStatus.textContent =
            alreadyRead
                ? "Seen"
                : "Sent";

        if (alreadyRead) {
            pendingReadMessageIds.delete(messageId);
        }

        content.appendChild(
            readStatus
        );
    }

    // 3 DOT MENU
    if (
        type === "sent" &&
        !isDeleted
    ) {

        const menuBtn = document.createElement("button");
        menuBtn.className = "messageMenuBtn";
        menuBtn.title = "Message options";
        menuBtn.innerHTML = `<i class="fa-solid fa-ellipsis-vertical"></i>`;

        const menu = document.createElement("div");
        menu.className = "messageMenu";
        menu.innerHTML = `
            <button
                class="messageMenuItem deleteMessageBtn"
                data-message-id="${id}"
            >
                <i class="fa-solid fa-trash"></i>
                Delete
            </button>

            <button
                class="messageMenuItem editMessageBtn"
                data-message-id="${id}"
                disabled
            >
                <i class="fa-solid fa-pen"></i>
                Edit
            </button>
        `;

        menuBtn.addEventListener(
            "click",
            function (e) {

                e.stopPropagation();

                document
                    .querySelectorAll(
                        ".messageMenu.open"
                    )
                    .forEach(otherMenu => {

                        if (
                            otherMenu !== menu
                        ) {
                            otherMenu.classList
                                .remove("open");
                        }

                    });

                menu.classList.toggle(
                    "open"
                );

            }
        );

        wrapper.appendChild(menuBtn);
        wrapper.appendChild(menu);
    }

    // MESSAGE POSITION
    if (type === "received") {

        // LEFT
        wrapper.appendChild(avatar);
        wrapper.appendChild(content);

    } else {

        // RIGHT
        wrapper.appendChild(content);
    }

    body.appendChild(wrapper);

    // AUTO SCROLL
    if (scroll) {

        body.scrollTop =
            body.scrollHeight;

    }
}

const messageText = document.getElementById("messageText");

messageText.addEventListener("input", function () {

    this.style.height = "auto";

    this.style.height = Math.min(
        this.scrollHeight,
        120
    ) + "px";

});

const messageBody = document.getElementById("messageBody");

messageBody.addEventListener(
    "scroll",
    function () {

        if (
            this.scrollTop <= 20 &&
            !chatLoading &&
            chatHasMore
        ) {
            loadOlderMessages();
        }

    }
);

document.addEventListener("click", function (e) {

    if (
        e.target.closest(".messageMenuBtn") ||
        e.target.closest(".messageMenu")
    ) {
        return;
    }

    // Close all open menus
    document.querySelectorAll(".messageMenu.open")
        .forEach(menu => {
            menu.classList.remove("open");
        });

});



async function loadOlderMessages() {

    if (chatLoading) return;
    if (!chatHasMore) return;
    if (!activeChatUser) return;
    if (!chatCursor) return;


    chatLoading = true;


    const body =
        document.getElementById("messageBody");


    // SAVE SCROLL POSITION
    const oldScrollHeight = body.scrollHeight;
    const oldScrollTop = body.scrollTop;
    const currentToken = activeChatUser.token;


    try {

        const response = await fetch(
            `/messages/${encodeURIComponent(
                currentToken
            )}?limit=10&cursor=${chatCursor}`,
            {
                credentials: "include"
            }
        );


        if (!response.ok) {

            throw new Error(
                `HTTP ${response.status}`
            );

        }


        const data = await response.json();


        // User changed chat while loading
        if (
            !activeChatUser ||
            activeChatUser.token !== currentToken
        ) {

            return;

        }


        // UPDATE PAGINATION
        chatCursor = data.nextCursor;
        chatHasMore = data.hasMore;


        if (!data.messages.length) {

            chatHasMore = false;

            return;

        }

        // CREATE FRAGMENT
        const fragment = document.createDocumentFragment();

        data.messages.forEach(message => {

            const messageId = Number(message.id);


            // Prevent duplicates
            if (
                loadedMessageIds.has(
                    messageId
                )
            ) {

                return;

            }


            loadedMessageIds.add(
                messageId
            );


            const div = document.createElement("div");

            div.className =
                `chatMessageWrapper ${message.isMine
                    ? "sent"
                    : "received"
                }`;

            div.dataset.messageId = message.id;


            // =========================
            // AVATAR
            // =========================

            if (!message.isMine) {

                const avatar = document.createElement("div");

                avatar.className = "chatMessageAvatar";

                avatar.innerHTML =
                    `<i class="fa-solid fa-user"></i>`;

                div.appendChild(avatar);
            }


            // =========================
            // CONTENT
            // =========================

            const content = document.createElement("div");

            content.className =
                "chatMessageContent";


            // =========================
            // MESSAGE BUBBLE
            // =========================

            const bubble = document.createElement("div");

            bubble.className =
                "chatMessage";

            const isDeleted =
                Number(message.is_deleted) === 1;

            if (isDeleted) {

                bubble.classList.add("deleted");

            }

            bubble.textContent =
                isDeleted
                    ? "This message was deleted."
                    : message.message;

            content.appendChild(bubble);


            // =========================
            // TIMESTAMP
            // =========================

            if (message.created_at) {

                const timestamp =
                    document.createElement("div");

                timestamp.className =
                    "messageTimestamp";

                const date =
                    new Date(message.created_at);

                timestamp.textContent =
                    date.toLocaleString("en-US", {
                        month: "short",
                        day: "numeric",
                        year: "numeric",
                        hour: "numeric",
                        minute: "2-digit"
                    });

                content.appendChild(timestamp);
            }


            // =========================
            // READ STATUS
            // =========================

            if (
                message.isMine &&
                !isDeleted
            ) {

                const readStatus =
                    document.createElement("div");

                readStatus.className =
                    "messageReadStatus";

                readStatus.dataset.messageId =
                    message.id;

                const messageId =
                    Number(message.id);

                const alreadyRead =
                    Number(message.is_read) === 1 ||
                    pendingReadMessageIds.has(messageId);

                readStatus.textContent =
                    alreadyRead
                        ? "Seen"
                        : "Sent";

                if (alreadyRead) {

                    pendingReadMessageIds.delete(
                        messageId
                    );

                }

                content.appendChild(
                    readStatus
                );
            }


            // =========================
            // 3 DOT MENU
            // =========================

            if (
                message.isMine &&
                !isDeleted
            ) {

                const menuBtn =
                    document.createElement("button");

                menuBtn.className =
                    "messageMenuBtn";

                menuBtn.title =
                    "Message options";

                menuBtn.innerHTML =
                    `<i class="fa-solid fa-ellipsis-vertical"></i>`;


                const menu =
                    document.createElement("div");

                menu.className =
                    "messageMenu";

                menu.innerHTML = `
        <button
            class="messageMenuItem deleteMessageBtn"
            data-message-id="${message.id}"
        >
            <i class="fa-solid fa-trash"></i>
            Delete
        </button>

        <button
            class="messageMenuItem editMessageBtn"
            data-message-id="${message.id}"
            disabled
        >
            <i class="fa-solid fa-pen"></i>
            Edit
        </button>
    `;


                menuBtn.addEventListener(
                    "click",
                    function (e) {

                        e.stopPropagation();

                        document
                            .querySelectorAll(
                                ".messageMenu.open"
                            )
                            .forEach(otherMenu => {

                                if (otherMenu !== menu) {

                                    otherMenu.classList
                                        .remove("open");

                                }

                            });

                        menu.classList.toggle("open");

                    }
                );


                div.appendChild(menuBtn);
                div.appendChild(menu);
            }


            // =========================
            // APPEND CONTENT
            // =========================

            div.appendChild(content);

            fragment.appendChild(div);

        });

        // PREPEND
        body.prepend(fragment);

        // RESTORE SCROLL
        requestAnimationFrame(() => {

            const newScrollHeight =
                body.scrollHeight;


            const heightDifference =
                newScrollHeight -
                oldScrollHeight;


            body.scrollTop =
                oldScrollTop +
                heightDifference;

        });


    } catch (error) {

        console.error(
            "Failed to load older messages:",
            error
        );

    } finally {

        chatLoading = false;

    }

}

document.getElementById("messageBody")
    .addEventListener("click", function (e) {

        const deleteBtn =
            e.target.closest(".deleteMessageBtn");

        if (!deleteBtn) {
            return;
        }

        e.stopPropagation();

        const messageId =
            Number(deleteBtn.dataset.messageId);

        if (!messageId) {
            return;
        }

        deleteChatMessage(messageId);

    });


function deleteChatMessage(messageId) {

    if (!messageId) {
        return;
    }

    const confirmed =
        confirm("Delete this message?");

    if (!confirmed) {
        return;
    }

    socket.emit(
        "delete-chat-message",
        {
            messageId
        }
    );

}

socket.on("chat-message-deleted", function (data) {

    const messageId = Number(data.messageId);
    const body = document.getElementById("messageBody");

    const wrapper = body.querySelector(
        `.chatMessageWrapper[data-message-id="${messageId}"]`
    );


    if (!wrapper) {
        return;
    }

    const bubble = wrapper.querySelector(".chatMessage");

    if (!bubble) {
        return;
    }


    // Change message appearance
    bubble.textContent = "This message was deleted.";

    bubble.classList.add(
        "deleted"
    );


    // Remove 3-dot menu
    const menuBtn =
        wrapper.querySelector(
            ".messageMenuBtn"
        );

    const menu =
        wrapper.querySelector(
            ".messageMenu"
        );


    if (menuBtn) {
        menuBtn.remove();
    }

    if (menu) {
        menu.remove();
    }

}
);

function isNearBottom(body) {

    return (
        body.scrollHeight -
        body.scrollTop -
        body.clientHeight
    ) < 80;

}

socket.on("chat-message", function (data) {

    if (
        !activeChatUser ||
        activeChatUser.token !== data.from
    ) {
        return;
    }

    const body =
        document.getElementById("messageBody");

    const nearBottom =
        isNearBottom(body);

    addChatMessage(
        data.message,
        "received",
        data.id,
        data.createdAt,
        nearBottom,
        false,
        true
    );

    // Tell sender that this message was seen
    socket.emit("mark-chat-read", {
        from: data.from
    });

});

socket.on("chat-messages-read", function (data) {

    const messageIds = Array.isArray(data.messageIds)
        ? data.messageIds
        : [];

    messageIds.forEach(messageId => {

        const id = Number(messageId);

        const status = document.querySelector(
            `.messageReadStatus[data-message-id="${id}"]`
        );

        if (status) {

            status.textContent = "Seen";

        } else {

            // Message has not been rendered yet.
            // Remember that it was already read.
            pendingReadMessageIds.add(id);

        }

    });

});