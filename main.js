import * as THREE from 'three';
import { messages, detectLanguage } from './locales.js';
import { PreviewRenderer } from './renderer.js';
import { loadObjFile, bakeNormalMap } from './baker.js';

// DOM Elements
const ui = {
    inputHigh: document.getElementById('inputHigh'),
    inputLow: document.getElementById('inputLow'),
    btnBake: document.getElementById('btnBake'),
    btnDownload: document.getElementById('btnDownload'),
    canvas: document.getElementById('canvasResult'),
    status: document.getElementById('statusText'),
    progressWrap: document.getElementById('progressWrap'),
    progressBar: document.getElementById('progressBar'),
    tabs: document.querySelectorAll('.tab'),
    viewports: document.querySelectorAll('.viewport'),
    toggleHigh: document.getElementById('toggleHigh'),
    toggleLow: document.getElementById('toggleLow'),
    settingSize: document.getElementById('settingSize'),
    langSelector: document.getElementById('languageSelector') // NEW
};

const ctx = ui.canvas.getContext('2d');
let meshHigh = null;
let meshLow = null;
const renderer = new PreviewRenderer('container3D');

// State for Language
let currentLang = detectLanguage();
let lastStatusKey = "status.waiting"; // To preserve status meaning across lang switch
let lastStatusType = "";

// Apply Localization
function localize() {
    const msgs = messages[currentLang];
    
    // Update Static UI
    document.querySelectorAll('[data-i18n]').forEach(el => {
        const key = el.getAttribute('data-i18n');
        if (msgs[key]) el.textContent = msgs[key];
    });

    // Update Status Box using the stored key
    if (msgs[lastStatusKey]) {
        // If it's a generic status, translate it. 
        // If it's an error message containing dynamic text, we might lose the dynamic part on switch,
        // but this handles the main states correctly.
        updateStatus(msgs[lastStatusKey], lastStatusType, true); 
    }
}

// Populate Dropdown
function initLanguage() {
    const supported = Object.keys(messages);
    
    // Map codes to readable names (optional, or just use codes)
    const displayNames = {
        'en': 'English',
        'es': 'Español',
        'ru': 'Русский',
        'id': 'Bahasa Indonesia',
        'th': 'ไทย',
        'hi': 'हिन्दी'
    };

    supported.forEach(lang => {
        const opt = document.createElement('option');
        opt.value = lang;
        opt.textContent = displayNames[lang] || lang.toUpperCase();
        if (lang === currentLang) opt.selected = true;
        ui.langSelector.appendChild(opt);
    });

    ui.langSelector.addEventListener('change', (e) => {
        currentLang = e.target.value;
        localize();
    });
}

function updateStatus(msg, type, isLangUpdate = false) {
    ui.status.textContent = msg;
    ui.status.className = 'status-box ' + (type === 'error' ? 'status-error' : type === 'success' ? 'status-success' : type === 'warn' ? 'status-warn' : '');
    
    if (!isLangUpdate) {
        // Find if this message corresponds to a key to save it for language switching
        const msgs = messages[currentLang];
        // Reverse lookup the key for this message (simple approach)
        const foundKey = Object.keys(msgs).find(key => msgs[key] === msg);
        if (foundKey) {
            lastStatusKey = foundKey;
            lastStatusType = type;
        } else if (type === 'error') {
            // Keep error generic
            lastStatusKey = "status.error"; 
            lastStatusType = "error";
        }
    }
}

// Draw UV Wireframe
function drawUVOverlay(geometry) {
    const size = ui.canvas.width;
    // Clear background
    ctx.fillStyle = "#111";
    ctx.fillRect(0, 0, size, size);

    if (!geometry || !geometry.attributes.uv) {
        ctx.fillStyle = "#cc0000";
        ctx.font = "16px sans-serif";
        ctx.textAlign = "center";
        ctx.fillText("No UV Map Found", size/2, size/2);
        return;
    }

    const uv = geometry.attributes.uv;
    const index = geometry.index;
    const count = index ? index.count : geometry.attributes.position.count;

    ctx.strokeStyle = "#00d455"; // Green wireframe
    ctx.lineWidth = 1;
    ctx.beginPath();

    for (let i = 0; i < count; i += 3) {
        let a, b, c;
        if (index) {
            a = index.getX(i); b = index.getX(i+1); c = index.getX(i+2);
        } else {
            a = i; b = i+1; c = i+2;
        }

        const x1 = uv.getX(a) * size; const y1 = (1 - uv.getY(a)) * size;
        const x2 = uv.getX(b) * size; const y2 = (1 - uv.getY(b)) * size;
        const x3 = uv.getX(c) * size; const y3 = (1 - uv.getY(c)) * size;

        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.lineTo(x3, y3);
        ctx.lineTo(x1, y1);
    }
    ctx.stroke();
}

function prepareMeshes() {
    if (meshLow) {
        // Resize canvas to match setting
        const size = parseInt(ui.settingSize.value);
        ui.canvas.width = size;
        ui.canvas.height = size;

        if (meshLow.geometry.attributes.uv) {
            drawUVOverlay(meshLow.geometry);
        } else {
            updateStatus(messages[currentLang]["status.noUV"], "warn");
        }
        
        // Update 3D renderer
        renderer.setMeshes(meshHigh ? meshHigh.geometry : null, meshLow.geometry);
    }

    if (meshHigh && meshLow) {
        ui.btnBake.disabled = false;
        updateStatus(messages[currentLang]["status.ready"], "success");
    }
}

// Events
function initEvents() {
    // Tabs
    ui.tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            ui.tabs.forEach(t => t.classList.remove('active'));
            ui.viewports.forEach(v => v.classList.remove('active'));
            tab.classList.add('active');
            
            const target = document.getElementById(tab.getAttribute('data-target'));
            target.classList.add('active');
            
            if (tab.getAttribute('data-target') === 'view3D') {
                renderer.resize();
            }
        });
    });

    // 3D View Controls
    const toggleView = () => {
        const showHigh = ui.toggleHigh.classList.contains('active');
        const showLow = ui.toggleLow.classList.contains('active');
        renderer.updateVisibility(showHigh, showLow);
    };

    ui.toggleHigh.addEventListener('click', () => {
        ui.toggleHigh.classList.toggle('active');
        toggleView();
    });
    ui.toggleLow.addEventListener('click', () => {
        ui.toggleLow.classList.toggle('active');
        toggleView();
    });
    
    // Texture Size Change
    ui.settingSize.addEventListener('change', () => {
        if(meshLow) drawUVOverlay(meshLow.geometry);
    });

    // File Loading
    ui.inputHigh.addEventListener('change', async () => {
        if (ui.inputHigh.files.length) {
            try {
                updateStatus(messages[currentLang]["status.loading"]);
                meshHigh = await loadObjFile(ui.inputHigh.files[0]);
                prepareMeshes();
            } catch(e) { updateStatus(e, "error"); }
        }
    });

    ui.inputLow.addEventListener('change', async () => {
        if (ui.inputLow.files.length) {
            try {
                updateStatus(messages[currentLang]["status.loading"]);
                meshLow = await loadObjFile(ui.inputLow.files[0]);
                prepareMeshes();
            } catch(e) { updateStatus(e, "error"); }
        }
    });

    // Bake Action
    ui.btnBake.addEventListener('click', async () => {
        ui.btnBake.disabled = true;
        ui.progressWrap.style.display = 'block';
        ui.progressBar.style.width = '0%';
        ui.btnDownload.style.display = 'none';

        try {
            updateStatus(messages[currentLang]["status.baking"]);

            // Get Options
            const options = {
                size: parseInt(ui.settingSize.value),
                maxFront: parseFloat(document.getElementById('settingMaxFront').value),
                maxRear: parseFloat(document.getElementById('settingMaxRear').value),
                ignoreBackface: document.getElementById('settingIgnoreBackface').checked,
                useAverageNormals: document.getElementById('settingSmooth').checked
            };

            // Resize Canvas for Output
            ui.canvas.width = options.size;
            ui.canvas.height = options.size;

            // Start Bake
            const pixelBuffer = await bakeNormalMap(meshHigh, meshLow, options, (progress) => {
                const pct = Math.round(progress * 100);
                ui.progressBar.style.width = pct + "%";
                // We don't localize the % string here, just the prefix
                updateStatus(`${messages[currentLang]["status.baking"]} ${pct}%`);
            });

            // Put data to canvas
            const imgData = new ImageData(pixelBuffer, options.size, options.size);
            ctx.putImageData(imgData, 0, 0);

            // Finish
            updateStatus(messages[currentLang]["status.complete"], "success");
            ui.btnBake.disabled = false;
            ui.btnDownload.style.display = 'block';

            // Send to Renderer
            renderer.updateNormalMap(ui.canvas);
            
            // Ensure Low is visible to see result
            if(!ui.toggleLow.classList.contains('active')) {
                ui.toggleLow.classList.add('active');
                renderer.updateVisibility(ui.toggleHigh.classList.contains('active'), true);
            }

        } catch (e) {
            console.error(e);
            updateStatus(messages[currentLang]["status.error"] + e.message, "error");
            ui.btnBake.disabled = false;
        }
    });

    ui.btnDownload.addEventListener('click', () => {
        const link = document.createElement('a');
        link.download = 'normal_map.png';
        link.href = ui.canvas.toDataURL();
        link.click();
    });
}

// Run
initLanguage();
localize();
initEvents();
