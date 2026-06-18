//guh
import { BROWSER_BUTTON_TO_KEY_NAME, BROWSER_CODE_TO_KEY_NAME, COLOR_PICKERS, HID_TO_KEY_NAME } from "../consts.js";
import { GamepadManager } from "./gamepadManager.js";

const LAYOUT_ORIGIN = { x: 0, y: 0 };

function flashBtn(btn, label, original, ms = 2000) {
    btn.textContent = label;
    btn.classList.add("copied");
    setTimeout(() => { btn.textContent = original; btn.classList.remove("copied"); }, ms);
}

export class ConfiguratorMode {
    constructor(utils, urlManager, layoutParser, visualizer, keyLayoutParser = null) {
        this.utils = utils;
        this.urlManager = urlManager;
        this.layoutParser = layoutParser;
        this.visualizer = visualizer;
        this.keyLayoutParser = keyLayoutParser;
        this.pickrInstances = {};
        this.urlDebounceTimer = null;
        this.rebuildThrottleTimer = null;
        this.rebuildLastFired = 0;
        this.rebuildPending = null;
        this.keyLayoutMode = false;
        this.keyLayoutDefs = [];
        this._klDragState = null;
        this._klGridPx = 6.25;

        document.getElementById("configurator").style.display = "flex";
        document.getElementById("overlay").classList.remove("show");

        this.setupBackgroundVideo();
        this.setupCheatSheetToggle();

        setTimeout(() => COLOR_PICKERS.forEach(cp => this.initPickrColorInput(cp.id, cp.defaultColor)), 25);

        const urlParams = new URLSearchParams(window.location.search);
        const DEV_PARAMS = /^(vscode-|_ijt$)/; //for when im too lazy to disable the arg on a fresh install
        const hasParams = urlParams.has("cfg") || Array.from(urlParams.keys()).some(k => k !== "ws" && !DEV_PARAMS.test(k));

        if (hasParams) this.loadSettingsFromLink(true);
        else this.applyDefaultSettings();

        this.setupConfigInputs();
        this.setupKeyAddButtons();
        this.setupPreviewInputListeners();
        this.setupAnalogSense();
        this.setupKeyLayoutEditor();
        this._setupPreviewZoomAndGrid();
        this.updateState();

        //tiny delay for gamepads because im lazy
        setTimeout(() => {
            this.gamepadManager = new GamepadManager(this.visualizer);
        }, 100);
    }

    applyDefaultSettings() {
        this.applySettings({
            wsaddress: "localhost", wsport: "4455",
            activecolor: "#5cf67d", inactivecolor: "#808080",
            backgroundcolor: "#1a1a1ad1", activebgcolor: "#47bd61",
            outlinecolor: "#4f4f4f", fontcolor: "#ffffff",
            glowradius: "24", borderradius: "10",
            pressscale: "110", animationspeed: "300",
            fontfamily: "ArialPixel",
            hidemouse: false, hidescrollcombo: false, boldfont: true,
            analogmode: false, gapmodifier: "100",
            outlinescalepressed: "2", outlinescaleunpressed: "2",
            keylegendmode: "fading", forcedisableanalog: false,
            mousetrailsensitivity: "100",
            mousetrailfadeout: "600",
            mousetrailmode: "wrap",
            mousetraillength: "150",
            mousetrailm1highlight: false,
            mousepadtexture: "",
            mousepadtexturezoom: "1",
            mousepadtextureopacity: "1",
            showmousedistance: false,
            mousedistancedpi: "400",
            resetmousedistanceafterfade: false,
        });
        if (this.keyLayoutParser) {
            this.keyLayoutMode = true;
            this.keyLayoutDefs = this._buildDefaultKeyLayoutDefs();
            this._syncKeyLayoutEditorUI();
        }
    }

    getCurrentSettings() {
        const get = (id) => document.getElementById(id);
        const val = (id) => get(id)?.value ?? "";
        const chk = (id) => get(id)?.checked ?? false;

        return {
            wsaddress: val("wsaddress") || "localhost",
            wsport: val("wsport") || "4455",
            wsauth: val("wsauth"),
            activecolor: val("activecolorhex"),
            inactivecolor: val("inactivecolorhex"),
            backgroundcolor: val("backgroundcolorhex"),
            activebgcolor: val("activebgcolorhex"),
            outlinecolor: val("outlinecolorhex"),
            fontcolor: val("fontcolorhex"),
            glowradius: val("glowradius"),
            borderradius: val("borderradius"),
            pressscale: val("pressscale"),
            animationspeed: val("animationspeed"),
            fontfamily: val("fontfamily"),
            hidemouse: chk("hidemouse"),
            hidescrollcombo: chk("hidescrollcombo"),
            boldfont: chk("boldfont"),
            analogmode: chk("analogmode"),
            gapmodifier: val("gapmodifier") || "100",
            outlinescalepressed: val("outlinescalepressed") || "2",
            outlinescaleunpressed: val("outlinescaleunpressed") || "2",
            keylegendmode: val("keylegendmode") || "inverting",
            forcedisableanalog: chk("forcedisableanalog"),
            mousetrailsensitivity: val("mousetrailsensitivity") || "100",
            mousetrailfadeout: val("mousetrailfadeout") !== "" ? val("mousetrailfadeout") : "600",
            mousetrailmode: val("mousetrailmode") || "wrap",
            mousetraillength: val("mousetraillength") || "150",
            mousetrailm1highlight: chk("mousetrailm1highlight"),
            mousepadtexture: val("mousepadtexture"),
            mousepadtexturezoom: val("mousepadtexturezoom") || "1",
            mousepadtextureopacity: val("mousepadtextureopacity") || "1",
            showmousedistance: chk("showmousedistance"),
            mousedistancedpi: val("mousedistancedpi") || "400",
            resetmousedistanceafterfade: chk("resetmousedistanceafterfade"),
            keyLayout: this._getKeyLayoutParam(),
        };
    }

    _getKeyLayoutParam() {
        if (!this.keyLayoutMode || !this.keyLayoutParser) return null;
        if (!this.keyLayoutDefs.length) return "[]";
        const tuples = this.keyLayoutParser.serializeAll(this.keyLayoutDefs);
        return JSON.stringify(tuples);
    }

    updateSliderLabel(input) {
        const label = document.getElementById(input.id + "value");
        if (!label) return;

        const id = input.id;
        if (id === "outlinescalepressed" || id === "outlinescaleunpressed") {
            label.textContent = input.value + "px"; return;
        }
        if (id === "mousetrailsensitivity") {
            label.textContent = (input.value / 100).toFixed(1) + "x"; return;
        }
        if (id === "mousetrailfadeout") {
            label.textContent = input.value + "ms"; return;
        }
        if (id === "mousetraillength") {
            label.textContent = input.value + "pts"; return;
        }
        if (id === "mousedistancedpi") {
            label.textContent = input.value + " DPI"; return;
        }

        let suffix = "", val = input.value;
        if (id.includes("radius")) suffix = "px";
        else if (id.includes("scale")) { suffix = "x"; val = id === "pressscale" ? (val / 100).toFixed(2) : (val / 100).toFixed(1); }
        else if (id === "opacity" || id.includes("speed") || id.includes("modifier")) suffix = "%";

        label.textContent = val + suffix;
    }

    applySettings(settings) {
        if (!settings) return;

        const applyValue = (id, value) => {
            const el = document.getElementById(id);
            if (!el) return;

            if (el.type === "checkbox") {
                el.checked = value === "true" || value === "1" || value === true;
                el.dispatchEvent(new Event("change", { bubbles: true }));
            } else {
                el.value = value ?? "";

                if (id.includes("colorhex")) {
                    const pickr = this.pickrInstances[id.replace("hex", "")];
                    if (pickr && value) { try { pickr.setColor(value, true); } catch { /* ignore */ } }
                }

                if (el.type === "range") {
                    this.updateSliderLabel(el);
                    el.dispatchEvent(new Event("input", { bubbles: true }));
                }
            }
        };

        applyValue("wsaddress", settings.wsaddress);
        applyValue("wsport", settings.wsport);
        applyValue("activecolorhex", settings.activecolor);
        applyValue("inactivecolorhex", settings.inactivecolor);
        applyValue("backgroundcolorhex", settings.backgroundcolor);
        applyValue("activebgcolorhex", settings.activebgcolor);
        applyValue("outlinecolorhex", settings.outlinecolor);
        applyValue("fontcolorhex", settings.fontcolor);
        applyValue("glowradius", settings.glow || settings.glowradius);
        applyValue("borderradius", settings.radius || settings.borderradius);
        applyValue("pressscale", settings.pressscale);
        applyValue("animationspeed", settings.speed || settings.animationspeed);
        applyValue("fontfamily", settings.fontfamily);
        applyValue("hidemouse", settings.hidemouse);
        applyValue("hidescrollcombo", settings.hidescrollcombo);
        applyValue("boldfont", settings.boldfont);
        applyValue("outlinescalepressed", settings.outlinescalepressed ?? "2");
        applyValue("outlinescaleunpressed", settings.outlinescaleunpressed ?? "2");
        applyValue("gapmodifier", settings.gapmodifier);
        applyValue("keylegendmode", settings.keylegendmode);
        applyValue("forcedisableanalog", settings.forcedisableanalog);
        applyValue("mousetrailsensitivity", settings.mousetrailsensitivity ?? "100");
        applyValue("mousetrailfadeout", settings.mousetrailfadeout ?? "600");
        applyValue("mousetrailmode", settings.mousetrailmode ?? "wrap");
        applyValue("mousetraillength", settings.mousetraillength ?? "150");
        applyValue("mousetrailm1highlight", settings.mousetrailm1highlight ?? false);
        applyValue("mousepadtexture", settings.mousepadtexture ?? "");
        applyValue("mousepadtexturezoom", settings.mousepadtexturezoom ?? "1");
        applyValue("mousepadtextureopacity", settings.mousepadtextureopacity ?? "1");
        applyValue("showmousedistance", settings.showmousedistance ?? false);
        applyValue("mousedistancedpi", settings.mousedistancedpi ?? "400");
        applyValue("resetmousedistanceafterfade", settings.resetmousedistanceafterfade ?? false);
    }

    updateState(settings = null) {
        if (!settings) settings = this.getCurrentSettings();
        this.visualizer.applyStyles(settings, true);

        const THROTTLE_MS = 100;
        const now = performance.now();
        this.rebuildPending = settings;

        clearTimeout(this.rebuildThrottleTimer);
        this.rebuildThrottleTimer = setTimeout(() => {
            this.visualizer.rebuildInterface(this.rebuildPending);
            this.rebuildLastFired = performance.now();
            this.rebuildPending = null;
            if (this.keyLayoutMode) {
                requestAnimationFrame(() => {
                    this._attachKeyLayoutDragHandles();
                    this._renderKeyLayoutList();
                });
            }
        }, Math.max(0, THROTTLE_MS - (now - this.rebuildLastFired)));

        clearTimeout(this.urlDebounceTimer);
        this.urlDebounceTimer = setTimeout(() => this.updateGeneratedLink(settings), 250);
    }

    updateGeneratedLink(settings) {
        const paramsString = this.urlManager.buildURLParams(settings);
        const safeSettings = { ...settings, wsauth: "" };
        const safeParamsString = this.urlManager.buildURLParams(safeSettings);
        const base = `${window.location.origin}${window.location.pathname}`;
        const wsParam = `ws=${settings.wsaddress || "localhost"}:${settings.wsport || "4455"}`;
        const linkInput = document.getElementById("generatedlink");

        const compressed = this.urlManager.compressSettings(paramsString);
        const safeCompressed = this.urlManager.compressSettings(safeParamsString);
        if (compressed) {
            window.history.replaceState({}, "", `${base}?cfg=${safeCompressed}`);
            linkInput.value = `${base}?cfg=${compressed}&${wsParam}`;

            console.log(`compressed params: ${compressed}`);
            console.log(`uncompressed params: ${paramsString}`);
        } else {
            window.history.replaceState({}, "", `${base}?${safeParamsString}`);
            linkInput.value = `${base}?${paramsString}&${wsParam}`;

            console.log(`uncompressed params: ${safeParamsString}`);
        }

        const container = linkInput.closest(".link-container") || document.querySelector(".link-container");
        container.classList.add("hint");
        setTimeout(() => container.classList.remove("hint"), 1000);

        const authWarning = document.getElementById("authwarning");

        const hasAuth = !!(settings.wsauth && settings.wsauth.trim());
        if (authWarning) authWarning.style.display = hasAuth ? "" : "none";
    }

    loadSettingsFromLink(fromCurrentUrl = false) {
        const linkInput = document.getElementById("generatedlink");
        const loadBtn = document.getElementById("loadbtn");
        const flash = (msg) => flashBtn(loadBtn, msg, "⟳ load url");

        let urlString = fromCurrentUrl === true ? window.location.href : linkInput.value;
        if (!urlString?.trim()) { flash("empty"); return; }
        if (!urlString.startsWith("http")) urlString = window.location.origin + urlString;

        try {
            const url = new URL(urlString);
            const params = url.searchParams;
            const settings = {};

            let wsAddress = "localhost", wsPort = "4455";
            if (params.has("ws")) {
                const ws = params.get("ws").split(":");
                wsAddress = ws[0] || "localhost";
                wsPort = ws[1] || "4455";
            }

            const sourceParams = params.has("cfg")
                ? (() => {
                    const dec = this.urlManager.decompressSettings(params.get("cfg"));
                    if (!dec) { flash("decompress error"); return null; }
                    return new URLSearchParams(dec);
                })()
                : params;

            if (!sourceParams) return;

            for (const key of sourceParams.keys()) {
                if (key === "ws") continue;
                let value = sourceParams.get(key);
                if (value == null || value === "") continue;
                if (key.includes("color")) value = this.utils.normalizeColorValue(value);
                settings[key] = value;
            }

            settings.wsaddress = wsAddress;
            settings.wsport = wsPort;
            if (!settings.keylegendmode) settings.keylegendmode = "fading";
            if (settings.forcedisableanalog == null) settings.forcedisableanalog = false;

            if (!Object.keys(settings).length) { flash("no params"); return; }

            const klParam = sourceParams.get("keyLayout") || params.get("keyLayout");
            if (klParam && this.keyLayoutParser) {
                let tuples = this.keyLayoutParser.decompressTuples(klParam);
                if (!tuples) { try { tuples = JSON.parse(klParam); } catch { tuples = null; } }
                if (tuples) {
                    this.keyLayoutDefs = this.keyLayoutParser.parseAll(tuples);
                    this.keyLayoutMode = true;
                    settings.keyLayout = this._getKeyLayoutParam();
                    this._syncKeyLayoutEditorUI();
                }
            } else if (this.keyLayoutParser) {
                const converted = this._convertRowsToKeyLayout(settings);
                this.keyLayoutDefs = converted.length ? converted : this._buildDefaultKeyLayoutDefs();
                this.keyLayoutMode = true;
                this._syncKeyLayoutEditorUI();
            }

            this.applySettings(settings);
            this.updateState();
            flash("loaded");
        } catch {
            flashBtn(loadBtn, "error", "⟳ load url");
        }
    }

    initPickrColorInput(pickrId, defaultColor) {
        const pickrEl = document.getElementById(pickrId);
        const hexInput = document.getElementById(pickrId + "hex");
        if (!pickrEl || !hexInput) return;

        const pickr = Pickr.create({
            el: pickrEl, theme: "classic",
            default: hexInput.value || defaultColor,
            components: {
                preview: true, opacity: true, hue: true,
                interaction: { hex: true, rgba: true, hsva: true, input: true, clear: false, save: true }
            },
            strings: { save: "Apply" },
            swatches: []
        });

        this.pickrInstances[pickrId] = pickr;

        pickr.on("change", (color) => {
            hexInput.value = color.toHEXA().toString().toLowerCase();
            pickr.applyColor();
            this.updateState();
        });

        hexInput.addEventListener("input", (e) => {
            let val = e.target.value.toLowerCase().replace(/[^0-9a-f#]/g, "");
            if (!val.startsWith("#")) val = "#" + val;
            if (val.length > 9) val = val.slice(0, 9);
            e.target.value = val;
            if (val.length === 7 || val.length === 9) {
                try { pickr.setColor(val, true); } catch { /* ignore */ }
                this.updateState();
            }
        });

        try { pickr.setColor(hexInput.value || defaultColor, true); } catch { /* ignore */ }
    }

    setupConfigInputs() {
        for (const input of document.querySelectorAll(".config-input")) {
            input.addEventListener("input", () => {
                if (input.type === "range") this.updateSliderLabel(input);
                else if (input.classList.contains("color-hex-input")) return;
                this.updateState();
            });
        }

        const wsauthEl = document.getElementById("wsauth");
        const savedAuth = localStorage.getItem("overlay_wsauth");
        if (savedAuth && !wsauthEl.value) wsauthEl.value = savedAuth;
        wsauthEl.addEventListener("input", () => localStorage.setItem("overlay_wsauth", wsauthEl.value));

        const distanceCheckbox = document.getElementById("showmousedistance");
        const distanceResetCheckbox = document.getElementById("resetmousedistanceafterfade");
        const distanceResetLabel = document.getElementById("resetmousedistanceafterfadelabel");
        const dpiSlider = document.getElementById("mousedistancedpi");
        const dpiLabel = document.getElementById("mousedistancedpivalue");
        const syncDpiState = () => {
            const enabled = distanceCheckbox?.checked ?? false;
            if (dpiSlider) { dpiSlider.disabled = !enabled; dpiSlider.style.opacity = enabled ? "1" : "0.5"; }
            if (dpiLabel) dpiLabel.style.opacity = enabled ? "1" : "0.4";

            if (distanceResetCheckbox) { distanceResetCheckbox.disabled = !enabled; distanceResetCheckbox.style.opacity = enabled ? "1" : "0.5"; }
            if (distanceResetLabel) distanceResetLabel.style.opacity = enabled ? "1" : "0.4";
        };
        distanceCheckbox?.addEventListener("change", syncDpiState);
        syncDpiState();

        document.getElementById("copybtn").addEventListener("click", this.copyLink.bind(this));
        document.getElementById("copysharebtn").addEventListener("click", this.copyShareLink.bind(this));
        document.getElementById("loadbtn").addEventListener("click", this.loadSettingsFromLink.bind(this));

        document.getElementById("layoutPresets")?.addEventListener("change", (e) => {
            const presetUrl = e.target.value;
            if (presetUrl) {
                document.getElementById("generatedlink").value = presetUrl;
                this.loadSettingsFromLink(false);
                setTimeout(() => { e.target.selectedIndex = 0; }, 100);
            }
        });
    }

    setupPreviewInputListeners() {
        document.addEventListener("keydown", e => this.handlePreviewInput(e, "key_pressed"), { capture: true });
        document.addEventListener("keyup", e => this.handlePreviewInput(e, "key_released"), { capture: true });
        document.addEventListener("mousedown", e => this.handlePreviewInput(e, "mouse_pressed"));
        document.addEventListener("mouseup", e => this.handlePreviewInput(e, "mouse_released"));
        document.addEventListener("wheel", e => this.handlePreviewInput(e, "mouse_wheel"), { passive: true });
        document.addEventListener("mousemove", e => this.handlePreviewInput(e, "mouse_moved"));
    }

    handlePreviewInput(event, type) {
        const els = this.visualizer.previewElements;
        if (!els) return;

        if (type === "key_pressed" || type === "key_released") {
            const isTyping = event.target.matches("input[type='text'], input[type='number'], textarea, .color-hex-input, .kl-inline-label-edit, .kl-tree-attr-input");
            let keyName = BROWSER_CODE_TO_KEY_NAME[event.code.toLowerCase()];
            let elements = els.keyElements.get(keyName);

            if (!elements && event.key) {
                const label = event.key.toUpperCase();
                for (const [k, elList] of els.keyElements) {
                    if (elList.some(el => el.textContent === label)) { keyName = k; elements = elList; break; }
                }
            }

            if (elements?.length) {
                const isPress = type === "key_pressed";
                for (const el of elements) this.visualizer.updateElementState(el, keyName, isPress, this.visualizer.activeKeys);
                if (!isTyping || keyName === "key_tab" || keyName === "key_escape") event.preventDefault();
            }
        } else if (type === "mouse_pressed" || type === "mouse_released") {
            const btnName = BROWSER_BUTTON_TO_KEY_NAME[event.button];
            if (!btnName) return;
            //track this always regardless of m1 key being in custom layout row or not for now TODO: add conditions for mouse_pad and trail highlight being there
            const isPress = type === "mouse_pressed";
            if (isPress) this.visualizer.activeMouseButtons.add(btnName);
            else this.visualizer.activeMouseButtons.delete(btnName);
            const elements = els.mouseElements.get(btnName);
            if (elements?.length) {
                for (const el of elements) this.visualizer.updateElementState(el, btnName, isPress, this.visualizer.activeMouseButtons);
            }
        } else if (type === "mouse_wheel") {
            if (els.scrollDisplays?.length) this.visualizer.handleScroll(Math.sign(event.deltaY));
        } else if (type === "mouse_moved") {
            if (this.visualizer.mousePadCanvas)
                this.visualizer.handleMouseMove(event.movementX, event.movementY);
        }
    }

    setupBackgroundVideo() {
        const video = document.getElementById("bgvideo");
        const source = document.getElementById("bgsource");
        if (video && source) {
            source.src = `./media/preview_gameplay${Math.floor(Math.random() * 2) + 1}.mp4`;
            video.load();
            video.play();
        }
    }

    setupCheatSheetToggle() {
        for (const details of document.querySelectorAll(".fullscreen-details")) {
            const closeBtn = details.querySelector(".close-btn");
            if (!closeBtn) continue;
            closeBtn.addEventListener("click", (e) => { e.preventDefault(); details.open = false; });
            const update = () => { closeBtn.style.display = details.open ? "block" : "none"; };
            update();
            details.addEventListener("toggle", update);
        }
    }

    async copyLink() {
        const linkInput = document.getElementById("generatedlink");
        const copyBtn = document.getElementById("copybtn");
        try {
            await navigator.clipboard.writeText(linkInput.value);
        } catch {
            linkInput.select();
            document.execCommand("copy");
        }
        flashBtn(copyBtn, "copied", "⎘ copy url");
    }

    async copyShareLink() {
        const shareBtn = document.getElementById("copysharebtn");
        try {
            const settings = this.getCurrentSettings();
            const shareSettings = { ...settings, wsauth: "" };
            const paramsString = this.urlManager.buildURLParams(shareSettings);
            const compressed = this.urlManager.compressSettings(paramsString);
            const base = `${window.location.origin}${window.location.pathname}`;
            const shareUrl = compressed
                ? `${base}?cfg=${compressed}`
                : `${base}?${paramsString}`;
            try {
                await navigator.clipboard.writeText(shareUrl);
            } catch {
                const tmp = document.createElement("textarea");
                tmp.value = shareUrl;
                document.body.appendChild(tmp);
                tmp.select();
                document.execCommand("copy");
                document.body.removeChild(tmp);
            }
            flashBtn(shareBtn, "copied share link!", "share");
        } catch {
            flashBtn(shareBtn, "error", "share");
        }
    }

    setupAnalogSense() {
        if (typeof window.analogsense === "undefined") return;

        const btn = document.getElementById("analogconnectbtn");
        if (!btn) return;

        this.analogSenseActiveKeys = new Set();
        this.analogSensePrevDepths = {};

        const DIGITAL_THRESHOLD = 0.01;

        const handleAnalogReport = (activeKeys) => {
            const viz = this.visualizer;
            if (!viz.previewElements) return;
            if (document.getElementById("forcedisableanalog")?.checked) return;

            const currentScancodes = new Set(activeKeys.map(k => String(k.scancode)));

            for (const { scancode, value } of activeKeys) {
                const rawKeyName = HID_TO_KEY_NAME[scancode];
                if (!rawKeyName) continue;

                const keyElements = viz.previewElements.keyElements;
                if (!viz.forceDisableAnalog) {
                    viz.setAnalogDepthTarget(rawKeyName, value);
                }

                const wasAbove = (this.analogSensePrevDepths[scancode] ?? 0) >= DIGITAL_THRESHOLD;
                const isAbove = value >= DIGITAL_THRESHOLD;

                if (isAbove !== wasAbove) {
                    const elements = keyElements.get(rawKeyName);
                    if (elements) for (const el of elements) viz.updateElementState(el, rawKeyName, isAbove, viz.activeKeys);
                    if (isAbove) this.analogSenseActiveKeys.add(scancode);
                    else this.analogSenseActiveKeys.delete(scancode);
                }

                this.analogSensePrevDepths[scancode] = value;
            }

            for (const scancode of this.analogSenseActiveKeys) {
                if (currentScancodes.has(String(scancode))) continue;
                const rawKeyName2 = HID_TO_KEY_NAME[scancode];
                if (rawKeyName2) {
                    const kels = viz.previewElements.keyElements;
                    if ((this.analogSensePrevDepths[scancode] ?? 0) >= DIGITAL_THRESHOLD) {
                        const elements = kels.get(rawKeyName2);
                        if (elements) for (const el of elements) viz.updateElementState(el, rawKeyName2, false, viz.activeKeys);
                    }
                    viz.setAnalogDepthTarget(rawKeyName2, 0);
                }
                delete this.analogSensePrevDepths[scancode];
                this.analogSenseActiveKeys.delete(scancode);
            }
        };

        const setConnected = (name) => {
            btn.textContent = `● ${name}`;
        };

        const connectDevice = async (provider) => {
            this.analogSenseProvider?.stopListening();
            this.analogSenseProvider = provider;
            provider.startListening(handleAnalogReport);
            setConnected(provider.getProductName());
        };

        analogsense.getDevices().then(devices => { if (devices.length) connectDevice(devices[0]); });

        btn.addEventListener("click", async () => {
            try {
                const device = await analogsense.requestDevice();
                if (device) await connectDevice(device);
                else btn.textContent = "no device found";
            } catch (e) {
                if (e.name !== "SecurityError") btn.textContent = `error: ${e.message}`;
            }
        });
    }

    setupKeyAddButtons() {
        const popup = document.getElementById("keyAddPopup");
        const keySelect = document.getElementById("popupKeySelect");
        const labelInput = document.getElementById("popupKeyLabel");
        const widthSlider = document.getElementById("popupWidthSlider");
        const widthValue = document.getElementById("popupWidthValue");
        const heightSlider = document.getElementById("popupHeightSlider");
        const heightValue = document.getElementById("popupHeightValue");
        const heightField = document.getElementById("popupHeightField");
        const addBtn = document.getElementById("popupAddBtn");
        const cancelBtn = document.getElementById("popupCancelBtn");
        const scrollerLabels = document.getElementById("popupScrollerLabels");
        const scrollUpDownLabels = document.getElementById("popupScrollUpDownLabels");
        const mouseSideLabels = document.getElementById("popupMouseSideLabels");
        const anchorField = document.getElementById("popupAnchorField");
        const anchorSelect = document.getElementById("popupAnchorSelect");

        const pipeKeySelect = document.getElementById("popupPipeKeySelect");
        const pipeTagsContainer = document.getElementById("popupPipeTags");
        const pipeSection = document.getElementById("popupPipeSection");
        const PIPE_EXCLUDED_GROUPS = new Set(["Special", "Gamepad Joysticks"]);
        const PIPE_UNSUPPORTED = new Set(["br", "dummy", "invisible", "mouse_pad", "mouse_side", "gp_ls", "gp_rs", "scroll_updown"]);

        for (const optgroup of keySelect.querySelectorAll("optgroup")) {
            if (PIPE_EXCLUDED_GROUPS.has(optgroup.label)) continue;
            pipeKeySelect.appendChild(optgroup.cloneNode(true));
        }

        let currentTargetRow = null, originalValue = "", isUpdating = false;
        let editingIndex = null, editingParts = [];
        let pipeKeys = [];

        const renderPipeTags = () => {
            pipeTagsContainer.innerHTML = "";
            if (pipeKeys.length === 0) {
                const ph = document.createElement("span");
                ph.className = "cfg-tags-placeholder";
                ph.textContent = "none";
                pipeTagsContainer.appendChild(ph);
                return;
            }
            pipeKeys.forEach((key, i) => {
                const tag = document.createElement("span");
                tag.className = "cfg-tag";
                const lbl = document.createElement("span");
                lbl.className = "cfg-tag-label";
                const opt = pipeKeySelect.querySelector(`option[value="${key}"]`);
                lbl.textContent = opt ? opt.text : key;
                const x = document.createElement("button");
                x.className = "cfg-tag-remove";
                x.textContent = "x";
                x.addEventListener("click", () => { pipeKeys.splice(i, 1); renderPipeTags(); updateKeyString(); });
                tag.appendChild(lbl);
                tag.appendChild(x);
                pipeTagsContainer.appendChild(tag);
            });
        };

        renderPipeTags();

        const updateKeyString = () => {
            if (isUpdating) return;
            const keyName = keySelect.value;
            let keyString;
            const widthClass = this.getWidthClass(parseInt(widthSlider.value));

            switch (keyName) {
                case "scroller": {
                    const def = document.getElementById("popupScrollerDefault").value || "M3";
                    const up = document.getElementById("popupScrollerUp").value || "🡅";
                    const down = document.getElementById("popupScrollerDown").value || "🡇";
                    keyString = widthClass
                        ? `scroller:"${def}":"${up}":"${down}":${widthClass}`
                        : `scroller:"${def}":"${up}":"${down}"`;
                    break;
                }
                case "scroll_updown": {
                    const up = document.getElementById("popupScrollUpDownUp").value || "🡅";
                    const down = document.getElementById("popupScrollUpDownDown").value || "🡇";
                    keyString = widthClass
                        ? `scroll_updown:"${up}":"${down}":${widthClass}`
                        : `scroll_updown:"${up}":"${down}"`;
                    break;
                }
                case "scroll_up": {
                    const label = labelInput.value || "🡅";
                    keyString = widthClass ? `scroll_up:"${label}":${widthClass}` : `scroll_up:"${label}"`;
                    break;
                }
                case "scroll_down": {
                    const label = labelInput.value || "🡇";
                    keyString = widthClass ? `scroll_down:"${label}":${widthClass}` : `scroll_down:"${label}"`;
                    break;
                }
                case "mouse_side": {
                    const m5 = document.getElementById("popupMouseSideM5").value || "M5";
                    const m4 = document.getElementById("popupMouseSideM4").value || "M4";
                    keyString = widthClass ? `mouse_side:"${m5}":"${m4}":${widthClass}` : `mouse_side:"${m5}":"${m4}"`;
                    break;
                }
                case "mouse_pad": {
                    const hClass = this.getWidthClass(parseInt(heightSlider.value)) || "u1";
                    const anchor = anchorSelect.value;
                    keyString = `mouse_pad:${widthClass || "u1"}:${hClass}:${anchor}`;
                    break;
                }
                case "gp_ls":
                case "gp_rs": {
                    const hClass = this.getWidthClass(parseInt(heightSlider.value)) || "u1";
                    const anchor = anchorSelect.value;
                    keyString = `gp_joystick:${keyName}:${widthClass || "u3"}:${hClass}:${anchor}`;
                    break;
                }
                case "br":
                    keyString = "br";
                    break;
                case "invisible":
                case "dummy":
                    keyString = widthClass ? `invisible:"invis":${widthClass}` : keyName;
                    break;
                default: {
                    const label = labelInput.value || keyName.split("_")[1].toUpperCase();
                    keyString = widthClass ? `${keyName}:"${label}":${widthClass}` : `${keyName}:"${label}"`;
                }
            }

            if (!PIPE_UNSUPPORTED.has(keyName) && pipeKeys.length > 0)
                keyString = pipeKeys.join("|") + "|" + keyString;

            this._klPendingKeyString = keyString;

            const targetInput = document.getElementById(`customLayout${currentTargetRow}`);
            if (targetInput) {
                if (editingIndex !== null) {
                    const newParts = [...editingParts];
                    newParts[editingIndex] = keyString;
                    targetInput.value = newParts.join(", ");
                } else {
                    targetInput.value = originalValue ? `${originalValue}, ${keyString}` : keyString;
                }
                targetInput.dispatchEvent(new Event("input", { bubbles: true }));
            }
        };

        const sliderHandler = (slider, display) => () => {
            display.textContent = `${(parseInt(slider.value) / 100).toFixed(2)}u`;
            updateKeyString();
        };
        widthSlider.addEventListener("input", sliderHandler(widthSlider, widthValue));
        heightSlider.addEventListener("input", sliderHandler(heightSlider, heightValue));

        keySelect.addEventListener("change", () => {
            const key = keySelect.value;
            scrollerLabels.style.display = "none";
            scrollUpDownLabels.style.display = "none";
            mouseSideLabels.style.display = "none";
            anchorField.style.display = "none";
            heightField.style.display = "none";
            labelInput.parentElement.style.display = "block";
            pipeSection.style.display = PIPE_UNSUPPORTED.has(key) ? "none" : "";

            switch (key) {
                case "scroller":
                    labelInput.parentElement.style.display = "none";
                    scrollerLabels.style.display = "block";
                    document.getElementById("popupScrollerDefault").value = "M3";
                    document.getElementById("popupScrollerUp").value = "🡅";
                    document.getElementById("popupScrollerDown").value = "🡇";
                    break;
                case "scroll_updown":
                    labelInput.parentElement.style.display = "none";
                    scrollUpDownLabels.style.display = "block";
                    document.getElementById("popupScrollUpDownUp").value = "🡅";
                    document.getElementById("popupScrollUpDownDown").value = "🡇";
                    break;
                case "scroll_up":
                    labelInput.value = "🡅";
                    break;
                case "scroll_down":
                    labelInput.value = "🡇";
                    break;
                case "mouse_left":
                    labelInput.value = "M1";
                    break;
                case "mouse_right":
                    labelInput.value = "M2";
                    break;
                case "mouse_middle":
                    labelInput.value = "M3";
                    break;
                case "mouse_4":
                    labelInput.value = "M4";
                    break;
                case "mouse_5":
                    labelInput.value = "M5";
                    break;
                case "mouse_side":
                    labelInput.parentElement.style.display = "none";
                    mouseSideLabels.style.display = "block";
                    document.getElementById("popupMouseSideM5").value = "M5";
                    document.getElementById("popupMouseSideM4").value = "M4";
                    break;
                case "mouse_pad":
                    labelInput.parentElement.style.display = "none";
                    heightField.style.display = "block";
                    anchorField.style.display = "block";
                    widthSlider.value = 500; widthValue.textContent = "5.00u";
                    heightSlider.value = 300; heightValue.textContent = "3.00u";
                    break;
                case "gp_ls":
                case "gp_rs":
                    labelInput.parentElement.style.display = "none";
                    heightField.style.display = "block";
                    anchorField.style.display = "block";
                    widthSlider.value = 300; widthValue.textContent = "3.00u";
                    heightSlider.value = 300; heightValue.textContent = "3.00u";
                    break;
                case "br":
                    labelInput.parentElement.style.display = "none";
                    break;
                case "invisible":
                case "dummy":
                    labelInput.value = "invisible";
                    break;
                default:
                    labelInput.value = keySelect.options[keySelect.selectedIndex].text;
            }
            updateKeyString();
        });

        labelInput.addEventListener("input", updateKeyString);
        anchorSelect.addEventListener("change", updateKeyString);
        for (const id of ["popupScrollerDefault", "popupScrollerUp", "popupScrollerDown", "popupMouseSideM5", "popupMouseSideM4", "popupScrollUpDownUp", "popupScrollUpDownDown"])
            document.getElementById(id).addEventListener("input", updateKeyString);

        document.getElementById("popupPipeAddBtn").addEventListener("click", () => {
            const key = pipeKeySelect.value;
            if (key && !pipeKeys.includes(key) && key !== keySelect.value) {
                pipeKeys.push(key);
                renderPipeTags();
                updateKeyString();
            }
        });

        const rowMappings = [
            ["addKey1", "Row1"], ["addKey2", "Row2"], ["addKey3", "Row3"],
            ["addKey4", "Row4"], ["addKey5", "Row5"], ["addKeyMouse", "Mouse"],
        ];

        for (const [buttonId, rowId] of rowMappings) {
            const btn = document.getElementById(buttonId);
            if (!btn) continue;
            btn.addEventListener("click", () => {
                editingIndex = null;
                editingParts = [];
                pipeKeys = [];
                addBtn.textContent = "add key";
                isUpdating = false;
                currentTargetRow = rowId;
                originalValue = (document.getElementById(`customLayout${rowId}`)?.value || "").trim();

                const rect = btn.getBoundingClientRect();
                const pw = 340, ph = 500;
                let left = rect.left - pw, top = rect.top;
                if (left < 10) left = rect.right + 10;
                if (left + pw > window.innerWidth - 10) left = Math.max(10, (window.innerWidth - pw) / 2);
                if (top + ph > window.innerHeight - 10) top = Math.max(10, window.innerHeight - ph - 10);
                if (top < 10) top = 10;

                popup.style.cssText = `display:block;left:${left}px;top:${top}px;`;
                keySelect.value = "key_a";
                labelInput.value = "A";
                widthSlider.value = 100; widthValue.textContent = "1.00u";
                heightSlider.value = 100; heightValue.textContent = "1.00u";
                heightField.style.display = "none";
                scrollerLabels.style.display = "none";
                scrollUpDownLabels.style.display = "none";
                mouseSideLabels.style.display = "none";
                anchorField.style.display = "none";
                anchorSelect.value = "a-tl";
                labelInput.parentElement.style.display = "block";
                pipeSection.style.display = "";
                renderPipeTags();
                updateKeyString();
            });
        }

        const prefillFromRaw = (raw) => {
            const item = this.layoutParser.parseElementDef(raw.trim());
            if (!item) return;
            isUpdating = true;

            if (item.keys && item.keys.length > 1) {
                pipeKeys = item.type === "scroller"
                    ? item.keys.filter(k => k !== "scroller")
                    : item.keys.slice(0, -1);
            } else {
                pipeKeys = [];
            }
            renderPipeTags();

            const setType = (val) => { keySelect.value = val; keySelect.dispatchEvent(new Event("change")); };

            switch (item.type) {
                case "scroller":
                    setType("scroller");
                    document.getElementById("popupScrollerDefault").value = item.labels?.[0] || "M3";
                    document.getElementById("popupScrollerUp").value = item.labels?.[1] || "🡅";
                    document.getElementById("popupScrollerDown").value = item.labels?.[2] || "🡇";
                    break;
                case "scroll_updown":
                    setType("scroll_updown");
                    document.getElementById("popupScrollUpDownUp").value = item.labels?.[0] || "🡅";
                    document.getElementById("popupScrollUpDownDown").value = item.labels?.[1] || "🡇";
                    break;
                case "scroll_up":
                    setType("scroll_up");
                    labelInput.value = item.label || "🡅";
                    break;
                case "scroll_down":
                    setType("scroll_down");
                    labelInput.value = item.label || "🡇";
                    break;
                case "mouse_side":
                    setType("mouse_side");
                    document.getElementById("popupMouseSideM5").value = item.labels?.[0] || "M5";
                    document.getElementById("popupMouseSideM4").value = item.labels?.[1] || "M4";
                    break;
                case "mouse_pad":
                    setType("mouse_pad");
                    widthSlider.value = this.widthClassToSlider(item.widthClass);
                    heightSlider.value = this.widthClassToSlider(item.heightClass);
                    anchorSelect.value = item.anchor || "a-tl";
                    widthValue.textContent = `${(parseInt(widthSlider.value) / 100).toFixed(2)}u`;
                    heightValue.textContent = `${(parseInt(heightSlider.value) / 100).toFixed(2)}u`;
                    break;
                case "gp_joystick":
                    setType(item.stickId);
                    widthSlider.value = this.widthClassToSlider(item.widthClass);
                    heightSlider.value = this.widthClassToSlider(item.heightClass);
                    anchorSelect.value = item.anchor || "a-tl";
                    widthValue.textContent = `${(parseInt(widthSlider.value) / 100).toFixed(2)}u`;
                    heightValue.textContent = `${(parseInt(heightSlider.value) / 100).toFixed(2)}u`;
                    break;
                case "dummy":
                    setType("dummy");
                    break;
                case "br":
                    setType("br");
                    break;
                default: {
                    if (item.class?.includes("invisible") && !item.key) { setType("invisible"); break; }
                    const keyVal = (item.keys?.length > 1 ? item.keys[item.keys.length - 1] : item.key) || "key_a";
                    setType(keyVal);
                    labelInput.value = item.label || "";
                    const wcls = (item.class || "").split(" ").find(c => /^u[\d-]+$/.test(c)) || "";
                    widthSlider.value = this.widthClassToSlider(wcls);
                    widthValue.textContent = `${(parseInt(widthSlider.value) / 100).toFixed(2)}u`;
                }
            }

            isUpdating = false;
        };

        this._openPopupForAdd = (rowId, triggerEl) => {
            editingIndex = null;
            editingParts = [];
            pipeKeys = [];
            addBtn.textContent = "add key";
            isUpdating = false;
            currentTargetRow = rowId;
            originalValue = "";

            const rect = triggerEl?.getBoundingClientRect() || { left: 100, right: 110, top: 100 };
            const pw = 340, ph = 500;
            let left = rect.left - pw, top = rect.top;
            if (left < 10) left = rect.right + 10;
            if (left + pw > window.innerWidth - 10) left = Math.max(10, (window.innerWidth - pw) / 2);
            if (top + ph > window.innerHeight - 10) top = Math.max(10, window.innerHeight - ph - 10);
            if (top < 10) top = 10;

            popup.style.cssText = `display:block;left:${left}px;top:${top}px;`;
            keySelect.value = "key_a";
            labelInput.value = "A";
            widthSlider.value = 100; widthValue.textContent = "1.00u";
            heightSlider.value = 100; heightValue.textContent = "1.00u";
            heightField.style.display = "none";
            scrollerLabels.style.display = "none";
            scrollUpDownLabels.style.display = "none";
            mouseSideLabels.style.display = "none";
            anchorField.style.display = "none";
            anchorSelect.value = "a-tl";
            labelInput.parentElement.style.display = "block";
            pipeSection.style.display = "";
            renderPipeTags();
            updateKeyString();
        };

        const cancelPopup = () => {
            editingIndex = null;
            editingParts = [];
            pipeKeys = [];
            addBtn.textContent = "add key";
            isUpdating = true;
            popup.style.display = "none";
        };

        addBtn.addEventListener("click", () => {
            if (this.keyLayoutMode && currentTargetRow === "KlMode") {
                if (this._klPendingKeyString) {
                    const def = this._rowKeyStringToDef(this._klPendingKeyString);
                    if (def) {
                        if (this.keyLayoutDefs.length) {
                            const last = this.keyLayoutDefs[this.keyLayoutDefs.length - 1];
                            def.x = last.x + last.w * 50 + 4;
                            def.y = last.y;
                        } else {
                            def.x = LAYOUT_ORIGIN.x;
                            def.y = LAYOUT_ORIGIN.y;
                        }
                        this.keyLayoutDefs.push(def);
                        this._commitKeyLayoutDefs();
                    }
                }
                this._klPendingKeyString = null;
            }
            editingIndex = null;
            editingParts = [];
            pipeKeys = [];
            addBtn.textContent = "add key";
            popup.style.display = "none";
        });
        cancelBtn.addEventListener("click", cancelPopup);
        popup.addEventListener("click", (e) => { if (e.target === popup) cancelPopup(); });
    }

    widthClassToSlider(cls) {
        if (!cls) return 100;
        const m = /^u(\d+)(?:-(\d+))?$/.exec(cls);
        if (!m) return 100;
        const intPart = parseInt(m[1]);
        if (!m[2]) return intPart * 100;
        const decVal = m[2].length === 1 ? parseInt(m[2]) * 10 : parseInt(m[2]);
        return intPart * 100 + decVal;
    }

    getTagLabel(item) {
        if (!item) return "?";
        switch (item.type) {
            case "dummy": return "dummy";
            case "br": return "↵ br";
            case "scroller": return `scroller`;
            case "scroll_updown": return `${item.labels?.[0] || "↑"}/${item.labels?.[1] || "↓"}`;
            case "scroll_up": return item.label || "↑";
            case "scroll_down": return item.label || "↓";
            case "mouse_side": return `M4/M5`;
            case "mouse_pad": return "mouse pad";
            case "gp_joystick": return item.stickId === "gp_ls" ? "L stick" : "R stick";
            default: return item.label || item.key || "?";
        }
    }

    getWidthClass(value) {
        if (value === 100) return "";
        const units = value / 100;
        const intPart = Math.floor(units);
        const decNum = Math.round((units - intPart) * 100);
        if (!decNum) return `u${intPart}`;
        let dec = decNum.toString().padStart(2, "0");
        if (dec.endsWith("0") && !dec.startsWith("0")) dec = dec.slice(0, -1);
        return `u${intPart}-${dec}`;
    }

    setupKeyLayoutEditor() {
        if (!this.keyLayoutParser) return;

        const klEditor = document.getElementById("klEditor");
        const klAddBtn = document.getElementById("klAddKeyBtn");
        const klAddPopup = document.getElementById("klAddPopup");
        const klAddCancelBtn = document.getElementById("klAddCancelBtn");
        const klAddConfirmBtn = document.getElementById("klAddConfirmBtn");
        const klClearBtn = document.getElementById("klClearBtn");

        if (!klEditor) return;

        klClearBtn?.addEventListener("click", () => {
            this.keyLayoutDefs = [];
            this._commitKeyLayoutDefs();
        });

        klAddBtn?.addEventListener("click", () => {
            if (this._openPopupForAdd) this._openPopupForAdd("KlMode", klAddBtn);
            else if (klAddPopup) klAddPopup.style.display = "flex";
        });

        klAddCancelBtn?.addEventListener("click", () => {
            if (klAddPopup) klAddPopup.style.display = "none";
        });

        klAddConfirmBtn?.addEventListener("click", () => {
            const typeEl = document.getElementById("klAddType");
            const labelEl = document.getElementById("klAddLabel");
            if (!typeEl) return;
            const type = typeEl.value;
            const arity = this.keyLayoutParser.getLabelArity(type);
            const def = { type, w: 1, h: 1, x: LAYOUT_ORIGIN.x, y: LAYOUT_ORIGIN.y };
            if (type === "mouse_pad" || type === "gp_joystick_ls" || type === "gp_joystick_rs") { def.w = 3; def.h = 3; }
            if (arity === 1) def.label = labelEl?.value || type.split("_").pop().toUpperCase();
            else if (arity > 1) {
                const defaults = { scroller: ["M3", "🡅", "🡇"], scroll_updown: ["🡅", "🡇"], mouse_side: ["M5", "M4"] };
                def.labels = defaults[type] || Array(arity).fill("");
            }
            if (this.keyLayoutDefs.length) {
                const last = this.keyLayoutDefs[this.keyLayoutDefs.length - 1];
                def.x = last.x + last.w * 50 + 4;
                def.y = last.y;
            }
            this.keyLayoutDefs.push(def);
            if (klAddPopup) klAddPopup.style.display = "none";
            this._commitKeyLayoutDefs();
        });

        //grid snapper
        const klGridSlider = document.getElementById("klGridSlider");
        const klGridLabel = document.getElementById("klGridLabel");
        const gridPxValues = [0, 3.125, 6.25, 9.375, 12.5, 15.625, 18.75, 21.875, 25, 31.25, 37.5, 43.75, 50, 75, 100, 150];
        const gridLabels = ["none", "0.06u", "0.13u", "0.19u", "0.25u", "0.31u", "0.38u", "0.44u", "0.5u", "0.63u", "0.75u", "0.88u", "1u", "1.5u", "2u", "3u"];
        klGridSlider?.addEventListener("input", () => {
            const idx = parseInt(klGridSlider.value);
            this._klGridPx = gridPxValues[idx] ?? 0;
            if (klGridLabel) klGridLabel.textContent = gridLabels[idx] ?? "none";
        });

        document.addEventListener("pointermove", (e) => this._onKlPointerMove(e));
        document.addEventListener("pointerup", (e) => this._onKlPointerUp(e));

        this._syncKeyLayoutEditorUI();
    }

    _setupPreviewZoomAndGrid() {
        const zoomSlider = document.getElementById("previewZoomSlider");
        const zoomLabel = document.getElementById("previewZoomLabel");
        const previewContent = document.getElementById("klPreviewContent");
        const wrapper = document.getElementById("preview-wrapper");
        const canvas = document.getElementById("klGridCanvas");
        const scrollArea = document.getElementById("previewScrollArea");

        if (zoomSlider && previewContent) {
            const applyZoom = () => {
                const zoom = parseInt(zoomSlider.value);
                if (zoomLabel) zoomLabel.textContent = `${zoom}%`;
                previewContent.style.zoom = `${zoom}%`;
            };
            zoomSlider.addEventListener("input", applyZoom);
            applyZoom();
            this._previewZoomSlider = zoomSlider;
        }

        if (!canvas || !wrapper || !previewContent) return;

        const drawGrid = () => {
            if (!this.keyLayoutMode || !this._klGridPx) { canvas.style.display = "none"; return; }
            const wrapperRect = wrapper.getBoundingClientRect();
            const contentRect = previewContent.getBoundingClientRect();
            canvas.width = wrapperRect.width;
            canvas.height = wrapperRect.height;
            canvas.style.display = "block";
            const ctx = canvas.getContext("2d");
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            const zoom = parseInt(zoomSlider?.value || "75") / 100;
            const gridScreenPx = this._klGridPx * zoom;
            if (gridScreenPx < 2) { canvas.style.display = "none"; return; }
            const originX = contentRect.left - wrapperRect.left;
            const originY = contentRect.top - wrapperRect.top;
            ctx.strokeStyle = "rgba(255,255,255,0.12)";
            ctx.lineWidth = 0.5;
            ctx.beginPath();
            let sx = originX % gridScreenPx;
            while (sx < 0) sx += gridScreenPx;
            for (let x = sx; x <= canvas.width; x += gridScreenPx) { ctx.moveTo(x, 0); ctx.lineTo(x, canvas.height); }
            let sy = originY % gridScreenPx;
            while (sy < 0) sy += gridScreenPx;
            for (let y = sy; y <= canvas.height; y += gridScreenPx) { ctx.moveTo(0, y); ctx.lineTo(canvas.width, y); }
            ctx.stroke();
            if (originX >= 0 && originX <= canvas.width) {
                ctx.strokeStyle = "rgba(255,255,255,0.3)";
                ctx.beginPath(); ctx.moveTo(originX, 0); ctx.lineTo(originX, canvas.height); ctx.stroke();
            }
            if (originY >= 0 && originY <= canvas.height) {
                ctx.strokeStyle = "rgba(255,255,255,0.3)";
                ctx.beginPath(); ctx.moveTo(0, originY); ctx.lineTo(canvas.width, originY); ctx.stroke();
            }
        };
        this._drawPreviewGrid = drawGrid;

        wrapper.addEventListener("mouseenter", () => { if (this.keyLayoutMode && this._klGridPx > 0) drawGrid(); });
        wrapper.addEventListener("mouseleave", () => { canvas.style.display = "none"; });
        wrapper.addEventListener("mousemove", () => {
            if (this.keyLayoutMode && this._klGridPx > 0) drawGrid();
            else canvas.style.display = "none";
        });
        scrollArea?.addEventListener("scroll", () => { if (canvas.style.display !== "none") drawGrid(); });
    }

    enterKeyLayoutMode() {
        if (!this.keyLayoutParser) return;
        this.keyLayoutMode = true;
        if (!this.keyLayoutDefs.length) {
            this.keyLayoutDefs = this._buildDefaultKeyLayoutDefs();
        }
        this._syncKeyLayoutEditorUI();
        this._commitKeyLayoutDefs();
    }

    _convertRowsToKeyLayout(settings) {
        const U = 50, GAP = 8 * (parseFloat(settings.gapmodifier) / 100 || 1);
        const defs = [];

        const parseUStr = (uStr) => {
            if (!uStr) return 1;
            const m = uStr.match(/^u(\d+)(?:-(\d+))?$/);
            if (!m) return 1;
            const dec = m[2] ? (m[2].length === 1 ? parseInt(m[2]) * 10 : parseInt(m[2])) : 0;
            return parseInt(m[1]) + dec / 100;
        };

        const LEGACY_WIDTH_U = { "wide": 1.5, "extra-wide": 2, "super-wide": 3.4 };
        const parseWFromClass = (cls) => {
            if (!cls) return 1;
            for (const t of cls.split(/\s+/)) {
                if (LEGACY_WIDTH_U[t] !== undefined) return LEGACY_WIDTH_U[t];
                if (/^u\d/.test(t)) return parseUStr(t);
                const wm = t.match(/^w-(\d+)(?:-(\d+))?u$/);
                if (wm) {
                    const dec = wm[2] ? (wm[2].length === 1 ? parseInt(wm[2]) * 10 : parseInt(wm[2])) : 0;
                    return parseInt(wm[1]) + dec / 100;
                }
            }
            return 1;
        };

        const convertRow = (items, yOffset) => {
            let xOffset = 0;
            for (const item of items) {
                if (item.type === "dummy" || item.type === "br") continue;

                if (item.type === "mouse_pad") {
                    const wU = parseUStr(item.widthClass);
                    const hU = parseUStr(item.heightClass);
                    const anchor = item.anchor || "a-tl";
                    const anchorH = anchor[3], anchorV = anchor[2];
                    //ICIF:
                    //legacy row system used marginLeft:-GAP (right) and marginLeft:-GAP/2 (center) to pull
                    //the no width container back relative to its pos
                    const gapShift = anchorH === "r" ? GAP : anchorH === "c" ? GAP / 2 : 0;
                    const padX = anchorH === "r" ? xOffset - gapShift - wU * U : anchorH === "c" ? xOffset - gapShift - (wU * U) / 2 : xOffset;
                    const padY = anchorV === "b" ? yOffset + U - hU * U : anchorV === "c" ? yOffset + (U - hU * U) / 2 : yOffset;
                    defs.push({ type: "mouse_pad", w: wU, h: hU, x: padX, y: padY });
                    continue;
                }

                if (item.type === "gp_joystick") {
                    const wU = parseUStr(item.widthClass);
                    const hU = parseUStr(item.heightClass || item.widthClass);
                    const type = item.stickId === "gp_ls" ? "gp_joystick_ls" : "gp_joystick_rs";
                    const anchor = item.anchor || "a-tl";
                    const anchorH = anchor[3], anchorV = anchor[2];
                    const joyX = anchorH === "r" ? xOffset - wU * U : anchorH === "c" ? xOffset - (wU * U) / 2 : xOffset;
                    const joyY = anchorV === "b" ? yOffset + U - hU * U : anchorV === "c" ? yOffset + (U - hU * U) / 2 : yOffset;
                    defs.push({ type, w: wU, h: hU, x: joyX, y: joyY });
                    continue;
                }

                const isInvis = item.class?.includes("invisible") || item.label === "invis";
                if (isInvis) {
                    const wU = parseWFromClass(item.class?.replace("invisible", "").trim()) || 1;
                    xOffset += wU * U + GAP;
                    continue;
                }

                const w = parseWFromClass(item.class);
                //legacy used { width: 70px } on the scroller
                //u1 gives 50px; u1-0/u1-00 dont have any width syntax so fall back to 70px
                const scrollW = (() => {
                    const token = item.class?.split(/\s+/).find(t => /^u\d/.test(t));
                    if (!token) return 70 / U;
                    const m = token.match(/^u(\d+)(?:-(\d+))?$/);
                    if (!m || (m[2] && parseInt(m[2]) === 0)) return 70 / U;
                    return w;
                })();
                let def;

                if (item.type === "scroller") {
                    def = { type: "scroller", labels: [...(item.labels || [])], w: scrollW, h: 1, x: xOffset, y: yOffset };
                } else if (item.type === "scroll_updown") {
                    def = { type: "scroll_updown", labels: [...(item.labels || [])], w: scrollW, h: 1, x: xOffset, y: yOffset };
                } else if (item.type === "scroll_up") {
                    def = { type: "scroll_up", label: item.label ?? "", w: scrollW, h: 1, x: xOffset, y: yOffset };
                } else if (item.type === "scroll_down") {
                    def = { type: "scroll_down", label: item.label ?? "", w: scrollW, h: 1, x: xOffset, y: yOffset };
                } else if (item.type === "mouse_side") {
                    def = { type: "mouse_side", labels: [...(item.labels || [])], w, h: 1, x: xOffset, y: yOffset };
                } else {
                    const keyType = item.keys?.length > 1 ? item.keys.join("|") : (item.key ?? item.type);
                    def = { type: keyType, label: item.label ?? "", w, h: 1, x: xOffset, y: yOffset };
                }

                defs.push(def);
                xOffset += def.w * U + GAP;
            }
        };

        const rowKeys = ["customLayoutRow1", "customLayoutRow2", "customLayoutRow3", "customLayoutRow4", "customLayoutRow5"];
        let yOffset = 0;

        for (const key of rowKeys) {
            if (!settings[key]) continue;
            const rows = this.layoutParser.splitByBr(this.layoutParser.parseCustomLayoutInput(settings[key]));
            for (const row of rows) {
                if (!row.length) continue;
                convertRow(row, yOffset);
                yOffset += U + GAP;
            }
        }

        if (settings.customLayoutMouse) {
            const rows = this.layoutParser.splitByBr(this.layoutParser.parseCustomLayoutInput(settings.customLayoutMouse));
            for (const row of rows) {
                if (!row.length) continue;
                convertRow(row, yOffset);
                yOffset += U + GAP;
            }
        }

        this._centerLayoutDefs(defs);
        return defs;
    }

    _buildDefaultKeyLayoutDefs() {
        if (!this.keyLayoutParser) return [];
        const tuples = [
            ["key_1", "1", 1, 1, 56.25, 0],
            ["key_2", "2", 1, 1, 112.5, 0],
            ["key_3", "3", 1, 1, 168.75, 0],
            ["key_4", "4", 1, 1, 225, 0],
            ["key_tab", "TAB", 1.5, 1, 0, 56.25],
            ["key_q", "Q", 1, 1, 81.25, 56.25],
            ["key_w", "W", 1, 1, 137.5, 56.25],
            ["key_e", "E", 1, 1, 193.75, 56.25],
            ["key_r", "R", 1, 1, 250, 56.25],
            ["key_leftshift", "SHIFT", 2, 1, 0, 112.5],
            ["key_a", "A", 1, 1, 106.25, 112.5],
            ["key_s", "S", 1, 1, 162.5, 112.5],
            ["key_d", "D", 1, 1, 218.75, 112.5],
            ["key_f", "F", 1, 1, 275, 112.5],
            ["key_leftctrl", "CTRL", 1.5, 1, 0, 168.75],
            ["key_leftalt", "ALT", 1.5, 1, 81.25, 168.75],
            ["key_space", "SPACE", 3.25, 1, 162.5, 168.75],
            ["mouse_left", "M1", 1.625, 0.63, 331.25, 0],
            ["scroller", "M3", "🡅", "🡇", 1.5, 0.63, 418.75, 0],
            ["mouse_right", "M2", 1.625, 0.63, 500, 0],
            ["mouse_pad", 5, 3.63, 331.25, 37.5],
        ];
        return this.keyLayoutParser.parseAll(tuples);
    }

    _centerLayoutDefs(defs) {
        if (!defs.length) return;
        const minX = Math.min(...defs.map(d => d.x));
        const minY = Math.min(...defs.map(d => d.y));
        const offX = LAYOUT_ORIGIN.x - minX;
        const offY = LAYOUT_ORIGIN.y - minY;
        if (offX !== 0 || offY !== 0) defs.forEach(d => { d.x += offX; d.y += offY; });
    }

    _syncKeyLayoutEditorUI() {
        const klEditor = document.getElementById("klEditor");
        const klPreviewControls = document.getElementById("klPreviewControls");
        if (!klEditor) return;
        klEditor.style.display = "flex";
        if (klPreviewControls) klPreviewControls.style.display = this.keyLayoutMode ? "flex" : "none";
    }

    _commitKeyLayoutDefs() {
        this.updateState();
    }

    _renderKeyLayoutList() {
        const list = document.getElementById("klElementList");
        if (!list) return;

        //save open state before clearing
        const openItems = new Set();
        const closedGroups = new Set();
        list.querySelectorAll('.kl-tree-node[data-kl-idx]').forEach(node => {
            const det = node.querySelector(':scope > details');
            if (det?.open) openItems.add(node.dataset.klIdx);
        });
        list.querySelectorAll('.tree-view > li > details').forEach(d => {
            if (!d.open) {
                const summary = d.querySelector(':scope > summary');
                const text = summary ? Array.from(summary.childNodes)
                    .filter(n => n.nodeType === 3).map(n => n.textContent.trim()).join('') : '';
                if (text) closedGroups.add(text);
            }
        });

        list.innerHTML = "";
        if (!this.keyLayoutDefs.length) {
            list.innerHTML = '<div class="kl-tree-empty">no elements</div>';
            return;
        }

        const getShortName = (def) => {
            if (def.type === "$") return "spacer";
            const pipeKeys = def.type.includes("|") ? def.type.split("|") : null;
            if (def.label) return pipeKeys?.length > 1 ? `${def.label} [+${pipeKeys.length - 1}]` : def.label;
            if (def.labels?.length) return def.labels.filter(Boolean).join("/");
            if (pipeKeys?.length > 1) {
                const primary = pipeKeys[pipeKeys.length - 1].replace(/^key_/, "").replace(/_/g, " ").toUpperCase();
                return `${primary} [+${pipeKeys.length - 1}]`;
            }
            return def.type.replace(/^key_/, "").replace(/^mouse_/, "").replace(/^gp_/, "").replace(/_/g, " ").toUpperCase();
        };
        const getGroupKey = (def) => {
            if (def.type === "$") return "special";
            if (def.type.startsWith("key_")) return "keyboard";
            if (def.type === "mouse_pad") return "mouse pad";
            if (def.type.startsWith("mouse_") || def.type === "scroller" || def.type.startsWith("scroll_")) return "mouse";
            if (def.type.startsWith("gp_")) return "gamepad";
            return "special";
        };

        const numFmt = (n) => Number(n).toFixed(2).replace(/\.?0+$/, "");

        const GROUP_ORDER = ["keyboard", "mouse", "mouse pad", "gamepad", "special"];
        const grouped = {};
        GROUP_ORDER.forEach(g => { grouped[g] = []; });
        this.keyLayoutDefs.forEach((def, idx) => grouped[getGroupKey(def)].push({ def, idx }));

        const canvas = document.getElementById("preview-keyboard");
        const makeNode = (def, idx) => {
            const node = document.createElement("li");
            node.className = "kl-tree-node";
            if (def.type !== "$") {
                node.dataset.klIdx = String(idx);
                node.addEventListener("mouseenter", () => {
                    const cEl = canvas?.querySelector(`[data-kl-idx="${idx}"]`);
                    if (cEl) { cEl.classList.add("kl-hover-highlight"); cEl.scrollIntoView({ block: "nearest", inline: "nearest" }); }
                });
                node.addEventListener("mouseleave", () => {
                    canvas?.querySelector(`[data-kl-idx="${idx}"]`)?.classList.remove("kl-hover-highlight");
                });
            }

            const itemDetails = document.createElement("details");
            const summary = document.createElement("summary");

            const nameEl = document.createElement("span");
            nameEl.className = "kl-tree-name";
            nameEl.textContent = getShortName(def);

            const posEl = document.createElement("span");
            posEl.className = "kl-tree-pos";
            posEl.textContent = `${numFmt(def.x - LAYOUT_ORIGIN.x)},${numFmt(def.y - LAYOUT_ORIGIN.y)}`;

            const delBtn = document.createElement("button");
            delBtn.className = "kl-tree-del";
            delBtn.textContent = "x";
            delBtn.title = "delete";
            delBtn.addEventListener("click", (e) => {
                e.stopPropagation();
                e.preventDefault();
                this.keyLayoutDefs.splice(idx, 1);
                this._commitKeyLayoutDefs();
            });

            summary.append(delBtn, posEl, nameEl);
            itemDetails.appendChild(summary);

            const attrList = document.createElement("ul");

            const makeAttrRow = (labelText, getValue, setValue, type = "text") => {
                const li = document.createElement("li");
                li.className = "kl-tree-attr";
                const lbl = document.createElement("span");
                lbl.className = "kl-tree-attr-label";
                lbl.textContent = labelText;
                const inp = document.createElement("input");
                inp.className = "kl-tree-attr-input";
                inp.type = type;
                inp.value = getValue();
                if (type === "number") { inp.step = "0.25"; }
                inp.addEventListener("change", () => {
                    setValue(inp.value);
                    posEl.textContent = `${numFmt(def.x - LAYOUT_ORIGIN.x)},${numFmt(def.y - LAYOUT_ORIGIN.y)}`;
                    nameEl.textContent = getShortName(def);
                    this._commitKeyLayoutDefs();
                });
                li.append(lbl, inp);
                return li;
            };

            attrList.appendChild(makeAttrRow("x", () => numFmt(def.x - LAYOUT_ORIGIN.x), (v) => { def.x = parseFloat(v) + LAYOUT_ORIGIN.x; }, "number"));
            attrList.appendChild(makeAttrRow("y", () => numFmt(def.y - LAYOUT_ORIGIN.y), (v) => { def.y = parseFloat(v) + LAYOUT_ORIGIN.y; }, "number"));
            attrList.appendChild(makeAttrRow("w", () => numFmt(def.w), (v) => { def.w = Math.max(0.25, parseFloat(v) || 1); }, "number"));
            attrList.appendChild(makeAttrRow("h", () => numFmt(def.h), (v) => { def.h = Math.max(0.25, parseFloat(v) || 1); }, "number"));
            if ("label" in def) {
                attrList.appendChild(makeAttrRow("key", () => def.type, (v) => { def.type = v.trim() || "key_a"; }));
                attrList.appendChild(makeAttrRow("label", () => def.label || "", (v) => { def.label = v; }));
            }
            if ("labels" in def) {
                const baseType = def.type.split("|")[0];
                def.labels.forEach((_lv, li) => {
                    const names = { scroller: ["M3", "up", "down"], scroll_updown: ["up", "down"], mouse_side: ["M5", "M4"] };
                    const labelName = names[baseType]?.[li] ?? `label ${li}`;
                    attrList.appendChild(makeAttrRow(labelName, () => def.labels[li] || "", (v) => { def.labels[li] = v; }));
                });
                if (baseType === "scroller" || baseType === "scroll_updown") {
                    attrList.appendChild(makeAttrRow("also keys", () => def.type.split("|").slice(1).join("|"), (v) => {
                        const extras = v.trim().split(/[|,\s]+/).filter(Boolean);
                        def.type = extras.length ? [baseType, ...extras].join("|") : baseType;
                    }));
                }
            }

            itemDetails.appendChild(attrList);
            node.appendChild(itemDetails);
            return node;
        };

        const root = document.createElement("ul");
        root.className = "tree-view";

        for (const groupKey of GROUP_ORDER) {
            const items = grouped[groupKey];
            if (!items.length) continue;

            const groupLi = document.createElement("li");

            const groupDetails = document.createElement("details");
            groupDetails.open = true;

            const groupSummary = document.createElement("summary");
            const countSpan = document.createElement("span");
            countSpan.className = "kl-tree-count";
            countSpan.textContent = items.length;
            groupSummary.append(groupKey, countSpan);
            groupDetails.appendChild(groupSummary);

            const itemsUl = document.createElement("ul");
            for (const { def, idx } of items) {
                itemsUl.appendChild(makeNode(def, idx));
            }

            groupDetails.appendChild(itemsUl);
            groupLi.appendChild(groupDetails);
            root.appendChild(groupLi);
        }

        list.appendChild(root);

        //Restore open state
        list.querySelectorAll('.kl-tree-node[data-kl-idx]').forEach(node => {
            if (openItems.has(node.dataset.klIdx)) {
                const det = node.querySelector(':scope > details');
                if (det) det.open = true;
            }
        });
        list.querySelectorAll('.tree-view > li > details').forEach(d => {
            const summary = d.querySelector(':scope > summary');
            const text = summary ? Array.from(summary.childNodes)
                .filter(n => n.nodeType === 3).map(n => n.textContent.trim()).join('') : '';
            if (text && closedGroups.has(text)) d.open = false;
        });
    }

    _attachKeyLayoutDragHandles() {
        const container = document.getElementById("preview-keyboard");
        if (!container || !this.keyLayoutMode) return;

        container.querySelectorAll(".kl-edge-handle, .kl-delete-btn").forEach(el => el.remove());

        const children = Array.from(container.children);
        const defIndices = [];
        for (let i = 0; i < this.keyLayoutDefs.length; i++) {
            if (this.keyLayoutDefs[i].type !== "$") defIndices.push(i);
        }

        const sidebarList = document.getElementById("klElementList");
        children.forEach((child, ci) => {
            const defIdx = defIndices[ci];
            if (defIdx == null) return;
            child.dataset.klIdx = String(defIdx);
            const isCanvas = child.classList.contains("mousepad-wrap") || child.classList.contains("joystick-wrap");
            if (isCanvas) {
                child.style.pointerEvents = "auto";
            } else {
                child.style.overflow = "visible";
            }

            child.addEventListener("mouseenter", () => {
                const sNode = sidebarList?.querySelector(`.kl-tree-node[data-kl-idx="${defIdx}"]`);
                if (sNode) { sNode.classList.add("kl-hover-highlight"); sNode.scrollIntoView({ block: "nearest" }); }
            });
            child.addEventListener("mouseleave", () => {
                sidebarList?.querySelector(`.kl-tree-node[data-kl-idx="${defIdx}"]`)?.classList.remove("kl-hover-highlight");
            });

            const del = document.createElement("button");
            del.className = "kl-delete-btn";
            del.style.position = "absolute";

            if (isCanvas) { del.style.top = "4px"; del.style.right = "4px"; }
            
            del.textContent = "x";
            del.title = "remove";
            del.addEventListener("pointerdown", (e) => {
                e.stopPropagation();
                e.preventDefault();
                this.keyLayoutDefs.splice(defIdx, 1);
                this._commitKeyLayoutDefs();
            });
            child.appendChild(del);

            child.addEventListener("dblclick", (e) => {
                if (e.target.classList.contains("kl-edge-handle") || e.target.classList.contains("kl-delete-btn")) return;
                e.stopPropagation();
                const def = this.keyLayoutDefs[defIdx];
                if (!("label" in def)) return;
                const input = document.createElement("input");
                input.type = "text";
                input.className = "kl-inline-label-edit";
                input.value = def.label || "";
                input.style.cssText = "position:absolute;inset:0;width:100%;height:100%;background:rgba(0,0,0,0.75);color:#fff;border:2px solid var(--active);border-radius:4px;text-align:center;font:inherit;font-size:12px;z-index:300;box-sizing:border-box;padding:0 4px;";
                child.appendChild(input);
                input.focus();
                input.select();
                const commit = () => {
                    def.label = input.value || def.label;
                    input.remove();
                    this._commitKeyLayoutDefs();
                };
                input.addEventListener("blur", commit);
                input.addEventListener("keydown", (ev) => { if (ev.key === "Enter") { ev.preventDefault(); input.blur(); } if (ev.key === "Escape") { input.remove(); } });
            });

            //scale handles
            const edgeInset = isCanvas ? "2px" : "-3px";
            const edges = [
                { side: "right", cursor: "ew-resize", style: `position:absolute;right:${edgeInset};top:15%;width:6px;height:70%;cursor:ew-resize;` },
                { side: "bottom", cursor: "ns-resize", style: `position:absolute;bottom:${edgeInset};left:15%;height:6px;width:70%;cursor:ns-resize;` },
                { side: "left", cursor: "ew-resize", style: `position:absolute;left:${edgeInset};top:15%;width:6px;height:70%;cursor:ew-resize;` },
                { side: "top", cursor: "ns-resize", style: `position:absolute;top:${edgeInset};left:15%;height:6px;width:70%;cursor:ns-resize;` },
            ];
            for (const edge of edges) {
                const handle = document.createElement("div");
                handle.className = `kl-edge-handle kl-edge-handle--${edge.side}`;
                handle.style.cssText = edge.style + "z-index:150;";
                handle.addEventListener("pointerdown", (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    handle.setPointerCapture(e.pointerId);
                    child.style.setProperty("transition", "none", "important");
                    const def = this.keyLayoutDefs[defIdx];
                    this._klDragState = {
                        mode: `resize-${edge.side}`,
                        defIdx, startX: e.clientX, startY: e.clientY,
                        origW: def.w, origH: def.h, origX: def.x, origY: def.y,
                        child,
                    };
                });
                child.appendChild(handle);
            }

            //drag
            child.addEventListener("pointerdown", (e) => {
                if (e.target.classList.contains("kl-edge-handle") || e.target.classList.contains("kl-delete-btn") || e.target.classList.contains("kl-inline-label-edit")) return;
                e.preventDefault();
                child.setPointerCapture(e.pointerId);
                child.style.setProperty("transition", "none", "important");
                const def = this.keyLayoutDefs[defIdx];
                this._klDragState = {
                    mode: "move",
                    defIdx, startX: e.clientX, startY: e.clientY,
                    origX: def.x, origY: def.y,
                    child,
                };
            });
        });
    }

    _getPreviewContentScale() {
        const wrapper = document.querySelector("#preview-wrapper > div");
        if (!wrapper) return 0.75;
        const s = getComputedStyle(wrapper).scale;
        const n = parseFloat(s);
        return isNaN(n) || n <= 0 ? 0.75 : n;
    }

    _onKlPointerMove(e) {
        const ds = this._klDragState;
        if (!ds) return;
        const scale = this._getPreviewContentScale();
        const dx = (e.clientX - ds.startX) / scale;
        const dy = (e.clientY - ds.startY) / scale;
        const U = 50, MIN = 0.25;
        const gridPx = this._klGridPx || 0;
        const snap = (v, g) => g > 0 ? Math.round(v / g) * g : Math.round(v);
        const snapW = (px, g) => g > 0 ? Math.max(MIN * U, Math.round(px / g) * g) / U : Math.max(MIN, Math.round(px) / U);
        const isCanvasWrap = ds.child.classList.contains("mousepad-wrap") || ds.child.classList.contains("joystick-wrap");

        if (ds.mode === "move") {
            const newX = snap(ds.origX + dx, gridPx);
            const newY = snap(ds.origY + dy, gridPx);
            ds.child.style.left = `${newX}px`;
            ds.child.style.top = `${newY}px`;
            ds._pendingX = newX;
            ds._pendingY = newY;
        } else if (ds.mode === "resize-right") {
            const newW = snapW(ds.origW * U + dx, gridPx);
            ds.child.style.setProperty("--key-width", `${newW * U}px`);
            if (isCanvasWrap) ds.child.style.width = `${newW * U}px`;
            ds._pendingW = newW;
        } else if (ds.mode === "resize-bottom") {
            const newH = snapW(ds.origH * U + dy, gridPx);
            ds.child.style.setProperty("--key-height-modifier", String(newH));
            if (isCanvasWrap) ds.child.style.height = `${newH * U}px`;
            ds._pendingH = newH;
        } else if (ds.mode === "resize-left") {
            const newW = snapW(ds.origW * U - dx, gridPx);
            const newX = snap(ds.origX + ds.origW * U - newW * U, gridPx);
            ds.child.style.left = `${newX}px`;
            ds.child.style.setProperty("--key-width", `${newW * U}px`);
            if (isCanvasWrap) ds.child.style.width = `${newW * U}px`;
            ds._pendingW = newW;
            ds._pendingX = newX;
        } else if (ds.mode === "resize-top") {
            const newH = snapW(ds.origH * U - dy, gridPx);
            const newY = snap(ds.origY + ds.origH * U - newH * U, gridPx);
            ds.child.style.top = `${newY}px`;
            ds.child.style.setProperty("--key-height-modifier", String(newH));
            if (isCanvasWrap) ds.child.style.height = `${newH * U}px`;
            ds._pendingH = newH;
            ds._pendingY = newY;
        }
    }

    _onKlPointerUp(e) {
        const ds = this._klDragState;
        if (!ds) return;
        this._klDragState = null;
        ds.child.style.removeProperty("transition");
        const def = this.keyLayoutDefs[ds.defIdx];
        if (!def) return;

        let changed = false;
        if (ds.mode === "move" && ds._pendingX != null) {
            def.x = ds._pendingX; def.y = ds._pendingY; changed = true;
        } else if (ds.mode === "resize-right" && ds._pendingW != null) {
            def.w = ds._pendingW; changed = true;
        } else if (ds.mode === "resize-bottom" && ds._pendingH != null) {
            def.h = ds._pendingH; changed = true;
        } else if (ds.mode === "resize-left" && ds._pendingW != null) {
            def.w = ds._pendingW; def.x = ds._pendingX; changed = true;
        } else if (ds.mode === "resize-top" && ds._pendingH != null) {
            def.h = ds._pendingH; def.y = ds._pendingY; changed = true;
        }
        if (changed) this._commitKeyLayoutDefs();
    }

    _rowKeyStringToDef(rawKeyString) {
        const item = this.layoutParser.parseElementDef(rawKeyString?.trim());
        if (!item || item.type === "br" || item.type === "dummy") return null;

        const parseUStr = (uStr) => {
            if (!uStr) return 1;
            const m = uStr.match(/^u(\d+)(?:-(\d+))?$/);
            if (!m) return 1;
            const dec = m[2] ? (m[2].length === 1 ? parseInt(m[2]) * 10 : parseInt(m[2])) : 0;
            return parseInt(m[1]) + dec / 100;
        };
        const LEGACY_WIDTH_U = { "wide": 1.5, "extra-wide": 2, "super-wide": 3.4 };
        const parseWFromClass = (cls) => {
            if (!cls) return 1;
            for (const t of cls.split(/\s+/)) {
                if (LEGACY_WIDTH_U[t] !== undefined) return LEGACY_WIDTH_U[t];
                if (/^u\d/.test(t)) return parseUStr(t);
                const wm = t.match(/^w-(\d+)(?:-(\d+))?u$/);
                if (wm) {
                    const dec = wm[2] ? (wm[2].length === 1 ? parseInt(wm[2]) * 10 : parseInt(wm[2])) : 0;
                    return parseInt(wm[1]) + dec / 100;
                }
            }
            return 1;
        };

        switch (item.type) {
            case "mouse_pad":
                return { type: "mouse_pad", w: parseUStr(item.widthClass) || 5, h: parseUStr(item.heightClass) || 3, x: 0, y: 0 };
            case "gp_joystick":
                return {
                    type: item.stickId === "gp_ls" ? "gp_joystick_ls" : "gp_joystick_rs",
                    w: parseUStr(item.widthClass) || 3, h: parseUStr(item.heightClass || item.widthClass) || 3, x: 0, y: 0
                };
            case "scroller":
                return { type: "scroller", labels: item.labels ?? ["M3", "🡅", "🡇"], w: parseWFromClass(item.class), h: 1, x: 0, y: 0 };
            case "scroll_updown":
                return { type: "scroll_updown", labels: item.labels ?? ["🡅", "🡇"], w: parseWFromClass(item.class), h: 1, x: 0, y: 0 };
            case "scroll_up":
                return { type: "scroll_up", label: item.label ?? "🡅", w: parseWFromClass(item.class), h: 1, x: 0, y: 0 };
            case "scroll_down":
                return { type: "scroll_down", label: item.label ?? "🡇", w: parseWFromClass(item.class), h: 1, x: 0, y: 0 };
            case "mouse_side":
                return { type: "mouse_side", labels: item.labels ?? ["M5", "M4"], w: parseWFromClass(item.class), h: 1, x: 0, y: 0 };
            default: {
                const isInvis = item.class?.includes("invisible") || item.label === "invis";
                if (isInvis) {
                    return { type: "$", w: parseWFromClass(item.class?.replace("invisible", "").trim()) || 1, h: 1, x: 0, y: 0 };
                }
                return {
                    type: item.keys?.length > 1 ? item.keys.join("|") : (item.key || item.keys?.[0] || "key_a"),
                    label: item.label ?? "",
                    w: parseWFromClass(item.class),
                    h: 1, x: 0, y: 0,
                };
            }
        }
    }
}