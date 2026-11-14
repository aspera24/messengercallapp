
const RECORDING_DB_NAME = "MeetFlowRecordingDB";
const RECORDING_STORE_NAME = "folders";
const RECORDING_FOLDER_KEY = "recordingFolder";

// OPEN INDEXEDDB
function openRecordingDB() {

    return new Promise((resolve, reject) => {

        const request = indexedDB.open(RECORDING_DB_NAME, 1);

        request.onupgradeneeded = () => {

            const db = request.result;

            if (!db.objectStoreNames.contains(RECORDING_STORE_NAME)) {
                db.createObjectStore(RECORDING_STORE_NAME);
            }

        };

        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);

    });

}

// SAVE FOLDER HANDLE
async function storeRecordingFolder(folderHandle) {

    const db = await openRecordingDB();

    return new Promise((resolve, reject) => {

        const transaction = db.transaction(
            RECORDING_STORE_NAME,
            "readwrite"
        );

        transaction.objectStore(RECORDING_STORE_NAME).put(
            folderHandle,
            RECORDING_FOLDER_KEY
        );

        transaction.oncomplete = () => {
            db.close();
            resolve();
        };

        transaction.onerror = () => {
            db.close();
            reject(transaction.error);
        };

    });

}

// GET SAVED FOLDER
async function getRecordingFolder() {

    const db = await openRecordingDB();

    return new Promise((resolve, reject) => {

        const transaction = db.transaction(
            RECORDING_STORE_NAME,
            "readonly"
        );

        const request = transaction.objectStore(
            RECORDING_STORE_NAME
        ).get(RECORDING_FOLDER_KEY);

        request.onsuccess = async () => {

            const folder = request.result;

            db.close();

            if (!folder) {
                resolve(null);
                return;
            }

            try {

                let permission = await folder.queryPermission({
                    mode: "readwrite"
                });

                if (permission !== "granted") {
                    permission = await folder.requestPermission({
                        mode: "readwrite"
                    });
                }

                resolve(permission === "granted" ? folder : null);

            } catch (error) {

                console.error("Folder permission error:", error);
                resolve(null);

            }

        };

        request.onerror = () => {
            db.close();
            reject(request.error);
        };

    });

}

// CHOOSE RECORDING FOLDER
async function chooseRecordingFolder() {

    if (!window.showDirectoryPicker) {
        throw new Error(
            "Folder selection is not supported. Please use Chrome or Edge desktop."
        );
    }

    const folder = await window.showDirectoryPicker({
        id: "meetflow-recordings",
        mode: "readwrite",
        startIn: "videos"
    });

    await storeRecordingFolder(folder);

    return folder;

}

// SAVE RECORDING FILE
async function saveRecordingFile(blob, details = {}) {

    const folder = await getRecordingFolder();

    if (!folder) {
        throw new Error("Recording folder is unavailable. Please select it again.");
    }

    const filename = details.filename || `MF-${Date.now()}.webm`;

    const fileHandle = await folder.getFileHandle(filename, {
        create: true
    });

    const writable = await fileHandle.createWritable();

    await writable.write(blob);
    await writable.close();

    return {
        filename,
        size: blob.size
    };

}
