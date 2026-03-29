import {
  Adb,
  AdbDaemonTransport,
} from "./vendor/adb.bundle.mjs";
import {
  AdbDaemonWebUsbDeviceManager,
  AdbDefaultInterfaceFilter,
} from "./vendor/adb-daemon-webusb.bundle.mjs";
import AdbWebCredentialStore from "./vendor/adb-credential-web.bundle.mjs";
import {
  FastbootDevice,
  setDebugLevel as setFastbootDebugLevel,
} from "./vendor/android-fastboot.mjs";

const THEME_MODE_KEY = "webRootAssistant.themeMode";
const THEME_MODES = ["system", "light", "dark"];
const MANIFEST_URL =
  "https://gh-proxy.org/https://raw.githubusercontent.com/liujixings/web_root/Mi17/root-manifest.json";

const state = {
  adb: null,
  adbDevice: null,
  adbCredentialStore: new AdbWebCredentialStore("WebADB"),
  fastboot: null,
  manifestEntries: [],
  deviceInfo: null,
  fastbootInfo: null,
  debug: false,
  themeMode: "system",
  systemThemeQuery: null,
  lastAdbConnected: false,
  lastFastbootConnected: false,
};

const els = {
  adbStatus: document.getElementById("adbStatus"),
  fastbootStatus: document.getElementById("fastbootStatus"),
  deviceModel: document.getElementById("deviceModel"),
  deviceCodename: document.getElementById("deviceCodename"),
  deviceAndroid: document.getElementById("deviceAndroid"),
  deviceMiIncremental: document.getElementById("deviceMiIncremental"),
  fastbootProduct: document.getElementById("fastbootProduct"),
  fastbootSerial: document.getElementById("fastbootSerial"),
  fastbootSlot: document.getElementById("fastbootSlot"),
  fastbootUnlocked: document.getElementById("fastbootUnlocked"),
  manualModelSelect: document.getElementById("manualModelSelect"),
  manualVersionSelect: document.getElementById("manualVersionSelect"),
  manualCurrentStateSelect: document.getElementById("manualCurrentStateSelect"),
  manualStartRootBtn: document.getElementById("manualStartRootBtn"),
  adbRebootModeSelect: document.getElementById("adbRebootModeSelect"),
  fastbootRebootModeSelect: document.getElementById("fastbootRebootModeSelect"),
  logOutput: document.getElementById("logOutput"),
  settingsDialog: document.getElementById("settingsDialog"),
  themeToggleBtn: document.getElementById("themeToggleBtn"),
  themeModeSelect: document.getElementById("themeModeSelect"),
  debugLogCheckbox: document.getElementById("debugLogCheckbox"),
  autoConnectDialog: document.getElementById("autoConnectDialog"),
  autoConnectMessage: document.getElementById("autoConnectMessage"),
  fastbootConnectDialog: document.getElementById("fastbootConnectDialog"),
  fastbootConnectActionBtn: document.getElementById("fastbootConnectActionBtn"),
  fastbootConnectCloseBtn: document.getElementById("fastbootConnectCloseBtn"),
};

function getStoredThemeMode() {
  try {
    const mode = localStorage.getItem(THEME_MODE_KEY);
    return THEME_MODES.includes(mode) ? mode : "system";
  } catch {
    return "system";
  }
}

function saveThemeMode(mode) {
  try {
    localStorage.setItem(THEME_MODE_KEY, mode);
  } catch {
    // Ignore storage write errors in restricted environments.
  }
}

function resolveTheme(mode) {
  if (mode === "light" || mode === "dark") return mode;
  if (state.systemThemeQuery?.matches) return "dark";
  return "light";
}

function updateThemeToggleButton(mode) {
  if (!els.themeToggleBtn) return;

  let icon = "🖥";
  let label = "跟随系统";

  if (mode === "light") {
    icon = "☀";
    label = "浅色模式";
  } else if (mode === "dark") {
    icon = "🌙";
    label = "黑暗模式";
  }

  els.themeToggleBtn.textContent = icon;
  els.themeToggleBtn.title = `主题模式: ${label}`;
  els.themeToggleBtn.setAttribute("aria-label", `主题模式: ${label}`);
}

function applyThemeMode(mode, options = {}) {
  const { persist = true, shouldLog = false } = options;
  const normalizedMode = THEME_MODES.includes(mode) ? mode : "system";
  const resolvedTheme = resolveTheme(normalizedMode);

  state.themeMode = normalizedMode;

  document.documentElement.setAttribute("data-theme", resolvedTheme);
  document.documentElement.setAttribute("data-theme-mode", normalizedMode);

  if (els.themeModeSelect && els.themeModeSelect.value !== normalizedMode) {
    els.themeModeSelect.value = normalizedMode;
  }

  updateThemeToggleButton(normalizedMode);

  if (persist) {
    saveThemeMode(normalizedMode);
  }

  if (shouldLog) {
    log("info", `主题模式已切换: ${normalizedMode === "system" ? "跟随系统" : normalizedMode}`);
  }
}

function cycleThemeMode() {
  const currentIndex = THEME_MODES.indexOf(state.themeMode);
  const nextMode = THEME_MODES[(currentIndex + 1) % THEME_MODES.length];
  applyThemeMode(nextMode, { persist: true, shouldLog: true });
}

function initThemeMode() {
  if (typeof window !== "undefined" && window.matchMedia) {
    state.systemThemeQuery = window.matchMedia("(prefers-color-scheme: dark)");

    const onSystemThemeChange = () => {
      if (state.themeMode === "system") {
        applyThemeMode("system", { persist: false });
      }
    };

    if (typeof state.systemThemeQuery.addEventListener === "function") {
      state.systemThemeQuery.addEventListener("change", onSystemThemeChange);
    } else if (typeof state.systemThemeQuery.addListener === "function") {
      state.systemThemeQuery.addListener(onSystemThemeChange);
    }
  }

  const preferredMode = getStoredThemeMode();
  applyThemeMode(preferredMode, { persist: false });
}

function nowText() {
  return new Date().toLocaleTimeString("zh-CN", { hour12: false });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function log(level, message, detail) {
  const show = level !== "debug" || state.debug;
  if (!show) return;

  let line = `[${nowText()}] [${level.toUpperCase()}] ${message}`;
  if (detail !== undefined) {
    if (typeof detail === "string") {
      line += `\n${detail}`;
    } else {
      line += `\n${JSON.stringify(detail, null, 2)}`;
    }
  }

  els.logOutput.textContent += `${line}\n`;
  els.logOutput.scrollTop = els.logOutput.scrollHeight;
}

function setStatus(el, text, ok) {
  el.textContent = text;
  el.style.color = ok ? "#067a4f" : "#9f1f1f";
}

function resetDeviceInfoView() {
  els.deviceModel.textContent = "-";
  els.deviceCodename.textContent = "-";
  els.deviceAndroid.textContent = "-";
  els.deviceMiIncremental.textContent = "-";
}

function resetFastbootInfoView() {
  els.fastbootProduct.textContent = "-";
  els.fastbootSerial.textContent = "-";
  els.fastbootSlot.textContent = "-";
  els.fastbootUnlocked.textContent = "-";
}

function normalizeUnlockedState(value, secureValue) {
  const text = (value || "").toString().trim().toLowerCase();
  if (["yes", "true", "1", "unlocked"].includes(text)) return true;
  if (["no", "false", "0", "locked"].includes(text)) return false;

  const secure = (secureValue || "").toString().trim().toLowerCase();
  if (secure === "no") return true;
  if (secure === "yes") return false;

  return null;
}

function isAdbConnected() {
  if (!state.adb || !state.adbDevice) return false;
  const opened = state.adbDevice.raw?.opened;
  return opened === undefined ? true : !!opened;
}

function isFastbootConnected() {
  return !!(state.fastboot && state.fastboot.isConnected);
}

function clearAdbState() {
  state.adb = null;
  state.adbDevice = null;
  state.deviceInfo = null;
  setStatus(els.adbStatus, "未连接", false);
  resetDeviceInfoView();
}

function clearFastbootState() {
  state.fastboot = null;
  state.fastbootInfo = null;
  setStatus(els.fastbootStatus, "未连接", false);
  resetFastbootInfoView();
}

function monitorConnectionStatus() {
  const adbConnected = isAdbConnected();
  const fastbootConnected = isFastbootConnected();

  if (state.lastAdbConnected !== adbConnected) {
    state.lastAdbConnected = adbConnected;
    if (!adbConnected) {
      if (state.adb || state.adbDevice) {
        clearAdbState();
      }
      log("info", "ADB 连接状态: 未连接");
    } else {
      setStatus(els.adbStatus, "已连接", true);
      log("info", "ADB 连接状态: 已连接");
    }
  }

  if (state.lastFastbootConnected !== fastbootConnected) {
    state.lastFastbootConnected = fastbootConnected;
    if (!fastbootConnected) {
      if (state.fastboot) {
        clearFastbootState();
      }
      log("info", "Fastboot 连接状态: 未连接");
    } else {
      setStatus(els.fastbootStatus, "已连接", true);
      log("info", "Fastboot 连接状态: 已连接");
    }
  }
}

function startConnectionMonitor() {
  setInterval(monitorConnectionStatus, 2000);
}

function bindUsbDisconnectListener() {
  if (typeof navigator === "undefined" || !("usb" in navigator)) return;

  navigator.usb.addEventListener("disconnect", (event) => {
    if (state.adbDevice && event.device === state.adbDevice.raw) {
      log("info", "检测到 ADB 设备已断开");
      clearAdbState();
    }
    if (state.fastboot && event.device === state.fastboot.device) {
      log("info", "检测到 Fastboot 设备已断开");
      clearFastbootState();
    }
  });
}

async function withAutoConnectDialog(message, task) {
  const dialog = els.autoConnectDialog;
  const messageEl = els.autoConnectMessage;

  if (!dialog || !messageEl) {
    return await task();
  }

  messageEl.textContent = message;
  if (!dialog.open) {
    dialog.showModal();
  }

  try {
    return await task();
  } finally {
    if (dialog.open) {
      dialog.close();
    }
  }
}

async function promptFastbootConnectDialog() {
  const dialog = els.fastbootConnectDialog;
  const connectBtn = els.fastbootConnectActionBtn;
  const closeBtn = els.fastbootConnectCloseBtn;

  if (!dialog || !connectBtn || !closeBtn) {
    return await connectFastboot();
  }

  if (isFastbootConnected()) {
    return true;
  }

  return await new Promise((resolve) => {
    let settled = false;

    const cleanup = () => {
      connectBtn.removeEventListener("click", onConnectClick);
      dialog.removeEventListener("close", onDialogClose);
      connectBtn.disabled = false;
      closeBtn.disabled = false;
    };

    const finalize = (result) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (dialog.open) {
        dialog.close();
      }
      resolve(result);
    };

    const onDialogClose = () => {
      finalize(false);
    };

    const onConnectClick = async () => {
      connectBtn.disabled = true;
      closeBtn.disabled = true;
      const connected = await connectFastboot();
      if (connected) {
        log("info", "Fastboot 连接成功，已关闭连接提示框");
        finalize(true);
        return;
      }

      connectBtn.disabled = false;
      closeBtn.disabled = false;
      log("info", "Fastboot 连接未成功，请确认设备已进入 bootloader 后重试");
    };

    connectBtn.addEventListener("click", onConnectClick);
    dialog.addEventListener("close", onDialogClose);

    if (!dialog.open) {
      dialog.showModal();
    }
  });
}

function ensureWebUsbAvailable() {
  const hasUsbApi = typeof navigator !== "undefined" && "usb" in navigator;
  if (!hasUsbApi) {
    throw new Error(
      "当前浏览器环境不支持 WebUSB（请使用 Chromium 内核浏览器，并在 HTTPS 或 localhost 下打开页面）",
    );
  }

  if (typeof window !== "undefined" && !window.isSecureContext) {
    throw new Error("WebUSB 仅可在安全上下文使用（HTTPS 或 localhost）");
  }

  return navigator.usb;
}

async function adbShell(command) {
  if (!state.adb) {
    throw new Error("ADB 未连接");
  }
  log("debug", `ADB shell: ${command}`);
  const output = await state.adb.createSocketAndWait(`shell:${command}`);
  const text = (output || "").trim();
  log("debug", `ADB shell result: ${command}`, text);
  return text;
}

async function connectAdb() {
  try {
    log("info", "开始连接 ADB 设备");

    const usb = ensureWebUsbAvailable();

    const manager =
      AdbDaemonWebUsbDeviceManager.BROWSER ||
      new AdbDaemonWebUsbDeviceManager(usb);

    const device = await manager.requestDevice({
      filters: [AdbDefaultInterfaceFilter],
    });

    if (!device) {
      log("info", "未选择 ADB 设备");
      return false;
    }

    const connection = await device.connect();
    const transport = await AdbDaemonTransport.authenticate({
      serial: device.serial,
      connection,
      credentialStore: state.adbCredentialStore,
    });

    state.adbDevice = device;
    state.adb = new Adb(transport);

    setStatus(els.adbStatus, "已连接", true);
    log("info", `ADB 已连接: ${device.name || device.serial}`);

    await refreshDeviceInfo();
    return true;
  } catch (error) {
    setStatus(els.adbStatus, "连接失败", false);
    log("error", "ADB 连接失败", error.message || String(error));
    return false;
  }
}

async function connectFastboot() {
  try {
    log("info", "开始连接 Fastboot 设备");

    ensureWebUsbAvailable();

    const fastboot = new FastbootDevice();
    await fastboot.connect();

    if (!fastboot.isConnected) {
      throw new Error("未检测到 Fastboot 连接");
    }

    // Only mark connected after a successful protocol handshake.
    const product = (await fastboot.getVariable("product"))?.toString().trim();
    if (!product) {
      throw new Error("设备未响应 Fastboot 协议，请确认已进入 bootloader/fastboot 模式");
    }

    state.fastboot = fastboot;
    setStatus(els.fastbootStatus, "已连接", true);

    log("info", `Fastboot 已连接: ${product}`);
    await refreshFastbootInfo();
    return true;
  } catch (error) {
    if (!state.fastboot) {
      resetFastbootInfoView();
    }
    setStatus(els.fastbootStatus, "连接失败", false);
    log("error", "Fastboot 连接失败", error.message || String(error));
    return false;
  }
}

async function refreshDeviceInfo() {
  if (!state.adb) {
    log("error", "请先连接 ADB，再读取设备信息");
    return;
  }

  try {
    const codename = await adbShell("getprop ro.product.device");
    const model = await adbShell("getprop ro.product.marketname");
    const androidVersion = await adbShell("getprop ro.build.version.release");
    const miIncremental = await adbShell("getprop ro.mi.os.version.incremental");

    state.deviceInfo = {
      codename,
      model,
      androidVersion,
      miIncremental,
    };

    els.deviceModel.textContent = model || "-";
    els.deviceCodename.textContent = codename || "-";
    els.deviceAndroid.textContent = androidVersion || "-";
    els.deviceMiIncremental.textContent = miIncremental || "-";

    log("info", "设备信息已刷新", state.deviceInfo);
  } catch (error) {
    log("error", "读取设备信息失败", error.message || String(error));
  }
}

async function refreshFastbootInfo() {
  if (!state.fastboot) {
    log("error", "请先连接 Fastboot，再读取设备信息");
    return;
  }

  try {
    const product = await state.fastboot.getVariable("product");
    const serialno = await state.fastboot.getVariable("serialno");
    const slot = await state.fastboot.getVariable("current-slot");
    const unlocked = await state.fastboot.getVariable("unlocked");
    const secure = await state.fastboot.getVariable("secure");
    const unlockedState = normalizeUnlockedState(unlocked, secure);

    let unlockedText = "未知";
    if (unlockedState === true) unlockedText = "已解锁";
    if (unlockedState === false) unlockedText = "未解锁";

    state.fastbootInfo = {
      product,
      serialno,
      slot,
      unlocked,
      secure,
      unlockedState,
    };
    els.fastbootProduct.textContent = product || "-";
    els.fastbootSerial.textContent = serialno || "-";
    els.fastbootSlot.textContent = slot || "-";
    els.fastbootUnlocked.textContent = unlockedText;
    log("info", "Fastboot 设备信息", state.fastbootInfo);
  } catch (error) {
    resetFastbootInfoView();
    log("error", "读取 Fastboot 信息失败", error.message || String(error));
  }
}

function normalizeManifestEntries(manifest) {
  let rows = [];

  if (Array.isArray(manifest)) {
    rows = manifest;
  } else if (Array.isArray(manifest.items)) {
    rows = manifest.items;
  } else if (manifest.devices && typeof manifest.devices === "object") {
    for (const [deviceKey, versions] of Object.entries(manifest.devices)) {
      if (!Array.isArray(versions)) continue;
      for (const row of versions) {
        rows.push({ device: deviceKey, ...row });
      }
    }
  }

  const normalized = rows
    .map((row) => {
      const model =
        row.device || row.model || row.codename || row.deviceModel || "";
      const version =
        row.version ||
        row.incremental ||
        row.systemVersion ||
        row.miIncremental ||
        "";
      let browserDownloadUrl =
        row.browserDownloadUrl ||
        row.url ||
        row.fileUrl ||
        row.downloadUrl ||
        row.link ||
        "";
      const assetName =
        row.assetName ||
        row.asset ||
        row.file ||
        row.initBoot ||
        (browserDownloadUrl ? browserDownloadUrl.split("/").pop() || "" : "");
      const partition = row.partition || "init_boot";

      return {
        model: String(model).trim(),
        version: String(version).trim(),
        assetName: String(assetName).trim(),
        partition: String(partition).trim() || "init_boot",
        browserDownloadUrl: String(browserDownloadUrl).trim(),
      };
    })
    .filter((row) => row.model && row.version && row.browserDownloadUrl);

  return normalized;
}

function populateManualModelOptions() {
  const models = [...new Set(state.manifestEntries.map((x) => x.model))].sort();

  els.manualModelSelect.innerHTML = "";
  for (const model of models) {
    const opt = document.createElement("option");
    opt.value = model;
    opt.textContent = model;
    els.manualModelSelect.appendChild(opt);
  }

  populateManualVersionOptions();
}

function pickManualTarget() {
  const model = (els.manualModelSelect.value || "").trim();
  const version = (els.manualVersionSelect.value || "").trim();

  if (!model || !version) {
    throw new Error("请先在手动模式中选择设备型号和系统版本");
  }

  return {
    model,
    version,
    source: "manual",
  };
}

function populateManualVersionOptions() {
  const selectedModel = els.manualModelSelect.value;
  const versions = [...new Set(
    state.manifestEntries
      .filter((x) => x.model === selectedModel)
      .map((x) => x.version)
  )].sort();

  els.manualVersionSelect.innerHTML = "";
  for (const version of versions) {
    const opt = document.createElement("option");
    opt.value = version;
    opt.textContent = version;
    els.manualVersionSelect.appendChild(opt);
  }
}

async function loadManifest() {
  log("info", `开始加载远程清单: ${MANIFEST_URL}`);

  const manifestResp = await fetch(MANIFEST_URL, {
    cache: "no-store",
  });

  if (!manifestResp.ok) {
    throw new Error(`下载远程清单失败: ${manifestResp.status} ${manifestResp.statusText}`);
  }

  const manifestJson = await manifestResp.json();
  const entries = normalizeManifestEntries(manifestJson);

  if (!entries.length) {
    throw new Error("清单解析后为空，请检查格式");
  }

  state.manifestEntries = entries;
  populateManualModelOptions();

  log("info", "远程清单加载完成", { count: entries.length, source: MANIFEST_URL });
}

function pickRootTarget() {
  if (!state.deviceInfo) {
    throw new Error("请先连接 ADB 并读取设备信息");
  }

  return {
    model: state.deviceInfo.codename,
    version: state.deviceInfo.miIncremental,
    source: "adb",
  };
}

function findManifestEntry(target) {
  const byExact = state.manifestEntries.find(
    (entry) => entry.model === target.model && entry.version === target.version
  );

  if (byExact) return byExact;

  const byModelAndVersionLoose = state.manifestEntries.find(
    (entry) =>
      entry.model.toLowerCase() === target.model.toLowerCase() &&
      entry.version.toLowerCase() === target.version.toLowerCase()
  );

  return byModelAndVersionLoose || null;
}

async function downloadRootBlob(entry) {
  let downloadUrl = entry.browserDownloadUrl || "";

  if (!downloadUrl) {
    throw new Error(
      `清单项缺少下载链接: ${entry.assetName}。请在清单中提供 browserDownloadUrl 或 url 字段。`,
    );
  }

  log("info", `下载 Root 镜像: ${entry.assetName}`);
  log("debug", "下载地址", downloadUrl);

  const resp = await fetch(downloadUrl);
  if (!resp.ok) {
    throw new Error(`下载镜像失败: ${resp.status} ${resp.statusText}`);
  }

  const blob = await resp.blob();
  log("info", `镜像下载完成: ${entry.assetName} (${blob.size} bytes)`);

  return blob;
}

function checkAdbFastbootMatch(adbInfo, fastbootInfo) {
  if (!adbInfo || !fastbootInfo) {
    return {
      matched: false,
      reason: "信息不足，无法比对",
    };
  }

  const adbCode = (adbInfo.codename || "").toLowerCase();
  const fbProduct = (fastbootInfo.product || "").toLowerCase();

  const matched = adbCode && fbProduct && adbCode === fbProduct;

  return {
    matched,
    reason: matched
      ? "ADB 与 Fastboot 设备信息一致"
      : `ADB 代号=${adbInfo.codename || "?"}, Fastboot product=${fastbootInfo.product || "?"}`,
  };
}

async function adbReboot(mode) {
  if (!state.adb) throw new Error("ADB 未连接");

  log("info", `ADB 重启模式: ${mode}`);
  switch (mode) {
    case "system":
      await state.adb.power.reboot();
      break;
    case "bootloader":
      await state.adb.power.reboot("bootloader");
      break;
    case "fastbootd":
      await state.adb.power.reboot("fastboot");
      break;
    case "recovery":
      await state.adb.power.reboot("recovery");
      break;
    default:
      throw new Error(`未知 ADB 重启模式: ${mode}`);
  }
}

async function fastbootReboot(mode) {
  if (!state.fastboot) throw new Error("Fastboot 未连接");

  log("info", `Fastboot 重启模式: ${mode}`);
  switch (mode) {
    case "system":
      await state.fastboot.reboot();
      break;
    case "bootloader":
      await state.fastboot.reboot("bootloader", false);
      break;
    case "fastbootd":
      await state.fastboot.reboot("fastboot", false);
      break;
    case "recovery":
      await state.fastboot.runCommand("reboot-recovery");
      break;
    default:
      throw new Error(`未知 Fastboot 重启模式: ${mode}`);
  }
}

async function executeRootWithTarget(target, options = {}) {
  const {
    startState = "system",
    skipAdbFastbootCompare = false,
  } = options;

  const entry = findManifestEntry(target);
  if (!entry) {
    throw new Error(`清单中无匹配项: model=${target.model}, version=${target.version}`);
  }

  const imageBlob = await downloadRootBlob(entry);

  if (startState === "system") {
    if (!isAdbConnected()) {
      const adbConnected = await withAutoConnectDialog(
        "未检测到 ADB 设备，正在自动连接 ADB，请在浏览器弹窗中选择设备…",
        connectAdb,
      );
      if (!adbConnected) {
        throw new Error("ADB 未连接，无法执行 Root");
      }
    }

    await adbReboot("bootloader");
    log("info", "设备已请求重启到 bootloader，请在提示框中点击“连接设备”继续");
  } else if (startState !== "bootloader") {
    throw new Error(`未知手机当前状态: ${startState}`);
  }

  const fastbootConnected =
    startState === "system"
      ? await promptFastbootConnectDialog()
      : await withAutoConnectDialog(
        "正在自动连接 Fastboot 设备，请在浏览器弹窗中选择 Fastboot 设备…",
        connectFastboot,
      );
  if (!fastbootConnected) {
    throw new Error("Fastboot 未连接，无法继续刷写");
  }

  await refreshFastbootInfo();

  if (state.fastbootInfo?.unlockedState !== true) {
    const detail =
      state.fastbootInfo?.unlockedState === false
        ? "设备 Bootloader 当前为未解锁状态。"
        : "无法确认设备 Bootloader 解锁状态。";
    throw new Error(`${detail} 请先解锁 Bootloader 再执行 Root。`);
  }

  if (!skipAdbFastbootCompare && state.deviceInfo) {
    const compare = checkAdbFastbootMatch(state.deviceInfo, state.fastbootInfo);
    log(compare.matched ? "info" : "error", "ADB/Fastboot 信息比对", compare.reason);

    if (!compare.matched) {
      const goOn = window.confirm(
        `ADB 与 Fastboot 设备信息不一致。\n${compare.reason}\n\n是否继续刷入？`
      );
      if (!goOn) {
        log("info", "用户取消了不一致情况下的刷机");
        return;
      }
      log("info", "用户选择继续刷机");
    }
  }

  const partition = entry.partition || "init_boot";
  log("info", `开始刷写分区: ${partition}`);

  await state.fastboot.flashBlob(partition, imageBlob, (progress) => {
    log("debug", `刷写进度 ${partition}`, `${(progress * 100).toFixed(1)}%`);
  });

  log("info", `分区 ${partition} 刷写完成，正在重启`);
  await state.fastboot.reboot();
  log("info", "Root 流程已完成");
}

async function oneClickRoot() {
  try {
    if (!isAdbConnected()) {
      const adbConnected = await withAutoConnectDialog(
        "未检测到 ADB 设备，正在自动连接 ADB，请在浏览器弹窗中选择设备…",
        connectAdb,
      );
      if (!adbConnected) {
        throw new Error("ADB 未连接，无法执行一键 Root");
      }
    }

    if (!state.manifestEntries.length) {
      await loadManifest();
    }

    await refreshDeviceInfo();
    const target = pickRootTarget();
    log("info", "自动读取机型/版本完成", target);

    await executeRootWithTarget(target, {
      startState: "system",
      skipAdbFastbootCompare: false,
    });

    log("info", "一键 Root 流程已完成");
  } catch (error) {
    log("error", "一键 Root 失败", error.message || String(error));
  }
}

async function manualStartRoot() {
  try {
    if (!state.manifestEntries.length) {
      await loadManifest();
    }

    const target = pickManualTarget();
    const startState = els.manualCurrentStateSelect.value;
    log("info", "手动模式目标", { ...target, startState });

    await executeRootWithTarget(target, {
      startState,
      skipAdbFastbootCompare: true,
    });

    log("info", "手动模式 Root 流程已完成");
  } catch (error) {
    log("error", "手动模式 Root 失败", error.message || String(error));
  }
}

function bindEvents() {
  const on = (id, event, handler) => {
    const node = document.getElementById(id);
    if (!node) {
      log("error", `页面缺少控件: #${id}`);
      return;
    }
    node.addEventListener(event, handler);
  };

  on("connectAdbBtn", "click", connectAdb);
  on("connectFastbootBtn", "click", connectFastboot);
  on("refreshAdbInfoBtn", "click", refreshDeviceInfo);
  on("refreshFastbootInfoBtn", "click", refreshFastbootInfo);

  if (els.manualModelSelect) {
    els.manualModelSelect.addEventListener("change", populateManualVersionOptions);
  }
  if (els.manualStartRootBtn) {
    els.manualStartRootBtn.addEventListener("click", manualStartRoot);
  }

  on("adbRebootBtn", "click", async () => {
    try {
      await adbReboot(els.adbRebootModeSelect.value);
    } catch (error) {
      log("error", "ADB 重启失败", error.message || String(error));
    }
  });

  on("fastbootRebootBtn", "click", async () => {
    try {
      await fastbootReboot(els.fastbootRebootModeSelect.value);
    } catch (error) {
      log("error", "Fastboot 重启失败", error.message || String(error));
    }
  });

  on("oneClickRootBtn", "click", oneClickRoot);

  on("clearLogBtn", "click", () => {
    els.logOutput.textContent = "";
  });

  on("openSettingsBtn", "click", () => {
    if (els.settingsDialog) {
      els.settingsDialog.showModal();
    }
  });

  if (els.themeToggleBtn) {
    els.themeToggleBtn.addEventListener("click", cycleThemeMode);
  }

  if (els.themeModeSelect) {
    els.themeModeSelect.addEventListener("change", () => {
      applyThemeMode(els.themeModeSelect.value, { persist: true, shouldLog: true });
    });
  }

  if (els.debugLogCheckbox) {
    els.debugLogCheckbox.addEventListener("change", () => {
      state.debug = els.debugLogCheckbox.checked;
      setFastbootDebugLevel(state.debug ? 2 : 0);
      log("info", `Debug 日志: ${state.debug ? "开启" : "关闭"}`);
    });
  }
}

function init() {
  initThemeMode();
  bindEvents();
  resetDeviceInfoView();
  resetFastbootInfoView();
  bindUsbDisconnectListener();
  startConnectionMonitor();
  setFastbootDebugLevel(0);
  log("info", "页面已就绪。请先连接设备，再执行 ADB/Fastboot/Root 操作。");
  log(
    "debug",
    "ADB filter (WebADB compatible)",
    AdbDefaultInterfaceFilter
  );

  loadManifest().catch((error) => {
    log("error", "远程清单自动加载失败", error.message || String(error));
  });
}

init();
