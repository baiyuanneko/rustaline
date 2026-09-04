/*!
 * rustaline 公共 mdui 主题初始化。
 * 依赖 static/vendor/mdui/mdui.global.js，必须在它之后以 defer 加载。
 *
 * - 主题色：默认 Material Blue 500（#2196f3），可经 window.rustalineTheme.setColor 更换，
 *   选择持久化于 localStorage，全站（演示页 / 管理面板）共享。
 * - 明暗模式：light / dark / auto（跟随系统），同样持久化。
 */
(function () {
  'use strict';

  var MODE_KEY = 'rustaline-theme-mode';
  var COLOR_KEY = 'rustaline-theme-color';
  var DEFAULT_COLOR = '#2196f3';
  var root = document.documentElement;

  function read(key) {
    try {
      return localStorage.getItem(key);
    } catch (_) {
      return null;
    }
  }

  function write(key, value) {
    try {
      localStorage.setItem(key, value);
    } catch (_) {
      /* ignore storage errors */
    }
  }

  function getMode() {
    var m = read(MODE_KEY);
    return m === 'light' || m === 'dark' ? m : 'auto';
  }

  function applyMode(mode) {
    root.classList.remove('mdui-theme-light', 'mdui-theme-dark', 'mdui-theme-auto');
    root.classList.add('mdui-theme-' + mode);
  }

  function setMode(mode) {
    write(MODE_KEY, mode);
    applyMode(mode);
  }

  function getColor() {
    var c = read(COLOR_KEY);
    return /^#[0-9a-fA-F]{6}$/.test(c || '') ? c : DEFAULT_COLOR;
  }

  function applyColor(color) {
    try {
      if (window.mdui && typeof window.mdui.setColorScheme === 'function') {
        window.mdui.setColorScheme(color);
        return true;
      }
    } catch (_) {
      /* ignore theme errors */
    }
    return false;
  }

  function setColor(color) {
    write(COLOR_KEY, color);
    applyColor(color);
  }

  applyMode(getMode());
  window.rustalineTheme = {
    getMode: getMode,
    setMode: setMode,
    getColor: getColor,
    setColor: setColor,
  };

  if (!applyColor(getColor())) {
    // mdui.global.js 尚未就绪时（异常加载顺序等兜底）等待加载完成
    window.addEventListener(
      'load',
      function () {
        applyColor(getColor());
      },
      { once: true }
    );
  }
})();
