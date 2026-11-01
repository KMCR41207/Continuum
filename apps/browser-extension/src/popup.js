document.querySelector("#options").onclick = () => (globalThis.browser || globalThis.chrome).runtime.openOptionsPage();
