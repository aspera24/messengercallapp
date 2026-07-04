document.querySelector(".close").onclick = () => {

    parent.postMessage({

        type: "MEETFLOW_CLOSE"

    }, "*");

};