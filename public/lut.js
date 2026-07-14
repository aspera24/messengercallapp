let renderer;
let scene;
let camera;
let plane;
let texture;
let canvas;
let currentFilter = "none";
let shaderMaterial = null;

async function createFilteredStream(stream) {

    const video = document.createElement("video");
    video.srcObject = stream;
    video.muted = true;
    video.playsInline = true;
    video.setAttribute("autoplay", "true");

    await video.play();

    canvas = document.createElement("canvas");
    canvas.width = 640;
    canvas.height = 480;

    renderer = new THREE.WebGLRenderer({
        canvas,
        antialias: false,
        alpha: false,
        depth: false,
        stencil: false,
        powerPreference: "high-performance"
    });

    renderer.setPixelRatio(1);
    renderer.setSize(640, 480, false);
    renderer.autoClear = false;
    texture = new THREE.VideoTexture(video);
    texture.generateMipmaps = false;
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    scene = new THREE.Scene();
    camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    texture = new THREE.VideoTexture(video);

    shaderMaterial = new THREE.ShaderMaterial({
        uniforms: {
            tDiffuse: { value: texture },
            filterType: { value: 0 },
            lutTexture: { value: new THREE.Texture() },
            useLUT: { value: false },
            lutSize: { value: 0.0 }
        },
        vertexShader: `
            varying vec2 vUv;
            void main(){
                vUv = uv;
                gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            }
        `,
        fragmentShader: `
            uniform sampler2D tDiffuse;
            uniform sampler2D lutTexture;
            uniform int filterType;
            uniform bool useLUT;
            uniform float lutSize;
            varying vec2 vUv;

            vec4 sampleAs3DTexture(sampler2D tex, vec3 uvw, float size) {
                float maxColor = size - 1.0;
                float zSlice0 = floor(uvw.z * maxColor);
                float zSlice1 = min(zSlice0 + 1.0, maxColor);
                
                float xOffset = 0.5 / (size * size);
                float yOffset = 0.5 / size;
                
                vec2 uv0;
                uv0.x = xOffset + (zSlice0 * size + uvw.r * maxColor) / (size * size);
                uv0.y = yOffset + (uvw.g * maxColor) / size;
                
                vec2 uv1;
                uv1.x = xOffset + (zSlice1 * size + uvw.r * maxColor) / (size * size);
                uv1.y = yOffset + (uvw.g * maxColor) / size;
                
                vec4 col0 = texture2D(tex, uv0);
                vec4 col1 = texture2D(tex, uv1);
                
                return mix(col0, col1, fract(uvw.z * maxColor));
            }

            void main(){
                vec4 color = texture2D(tDiffuse, vUv);

                if (useLUT && lutSize > 0.0) {
                    color.rgb = sampleAs3DTexture(lutTexture, clamp(color.rgb, 0.0, 1.0), lutSize).rgb;
                }

                if(filterType == 1){
                    float gray = dot(color.rgb, vec3(0.299,0.587,0.114));
                    color.rgb = vec3(gray);
                }
                else if(filterType == 2){
                    color.r *= 1.15; color.g *= 1.05; color.b *= 0.90;
                }
                else if(filterType == 3){
                    color.r *= 0.90; color.g *= 1.00; color.b *= 1.15;
                }
                else if(filterType == 4){
                    color.rgb = pow(color.rgb, vec3(1.15));
                    color.r *= 1.05; color.b *= 0.85;
                }
                
                gl_FragColor = color;
            }
        `
    });

    plane = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), shaderMaterial);
    scene.add(plane);

    let isTabActive = true;
    let backgroundInterval = null;

    function renderFrame() {
        if (video.readyState >= video.HAVE_CURRENT_DATA) {
            // if (texture) texture.needsUpdate = true;
            renderer.render(scene, camera);
        }
    }

    const fps = 30;
    const interval = 1000 / fps;

    let last = 0;

    function animate(now) {

        requestAnimationFrame(animate);

        if (now - last < interval)
            return;

        last = now;

        renderFrame();
    }

    requestAnimationFrame(animate);

    animate();

    document.addEventListener("visibilitychange", () => {
        if (document.hidden) {
            isTabActive = false;
            backgroundInterval = setInterval(renderFrame, 1000 / 30);
        } else {
            isTabActive = true;
            if (backgroundInterval) {
                clearInterval(backgroundInterval);
                backgroundInterval = null;
            }
            animate();
        }
    });

    return canvas.captureStream(30);
}

// GI-AYO ARON DILI MAPATAY ANG LUT AUTOMATICALLY
async function changeCameraFilter(name) {
    if (!shaderMaterial) return;

    switch (name) {
        case "": case "None": case "none": shaderMaterial.uniforms.filterType.value = 0; break;
        case "Grayscale": shaderMaterial.uniforms.filterType.value = 1; break;
        case "Warm": shaderMaterial.uniforms.filterType.value = 2; break;
        case "Cool": shaderMaterial.uniforms.filterType.value = 3; break;
        case "Cinematic": shaderMaterial.uniforms.filterType.value = 4; break;
    }
}

function disableCustomLUT() {
    if (!shaderMaterial) return;
    shaderMaterial.uniforms.useLUT.value = false;
}

function setFilter(name) {
    currentFilter = name;
}

async function loadUserLUT(file) {
    if (!shaderMaterial) return;

    try {
        const text = await file.text();
        const lutData = parseCube(text);

        if (!lutData || lutData.size === 0 || lutData.values.length === 0) {
            console.error("Guba o dili valid ang nakita nga .cube structure");
            return;
        }

        console.log("LUT File loaded successfully:", lutData.title, "Size:", lutData.size);

        const lut2DTexture = createLUT2DTexture(lutData);

        shaderMaterial.uniforms.lutTexture.value = lut2DTexture;
        shaderMaterial.uniforms.lutSize.value = lutData.size;
        shaderMaterial.uniforms.useLUT.value = true;

    } catch (err) {
        console.error("Adunay error sa pag-execute sa LUT upload:", err);
    }
}


function parseCube(text) {
    const lines = text.split(/\r?\n/);
    let title = "Custom LUT";
    let size = 0;
    const values = [];

    for (const line of lines) {
        const l = line.trim();
        if (!l || l.startsWith("#")) continue;

        if (l.startsWith("TITLE")) {
            const match = l.match(/"(.*)"/);
            title = match ? match[1] : "Custom LUT";
            continue;
        }

        if (l.startsWith("LUT_3D_SIZE")) {
            size = Number(l.split(/\s+/)[1]);
            continue;
        }

        if (/^[0-9\.\-\s]+$/.test(l)) {
            const rgb = l.split(/\s+/).map(Number);
            if (rgb.length >= 3) {
                values.push([rgb[0], rgb[1], rgb[2]]);
            }
        }
    }

    return { title, size, values };
}

function createLUT2DTexture(lut) {
    const size = lut.size;
    const width = size * size;
    const height = size;

    const data = new Uint8Array(width * height * 4);

    let srcIndex = 0;
    for (let z = 0; z < size; z++) {
        for (let y = 0; y < size; y++) {
            for (let x = 0; x < size; x++) {

                const pixelX = x + (z * size);
                const pixelY = y;
                const destIndex = (pixelY * width + pixelX) * 4;

                const rgb = lut.values[srcIndex];
                if (rgb) {
                    data[destIndex] = Math.round(Math.max(0, Math.min(1, rgb[0])) * 255);
                    data[destIndex + 1] = Math.round(Math.max(0, Math.min(1, rgb[1])) * 255);
                    data[destIndex + 2] = Math.round(Math.max(0, Math.min(1, rgb[2])) * 255);
                    data[destIndex + 3] = 255;
                }
                srcIndex++;
            }
        }
    }

    const texture = new THREE.DataTexture(data, width, height, THREE.RGBAFormat);
    texture.generateMipmaps = false;
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.wrapS = THREE.ClampToEdgeWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
    texture.unpackAlignment = 1;
    texture.needsUpdate = true;

    return texture;
}
