/*!
 * rustaline 公共 mdui 主题初始化。
 * 依赖 static/vendor/mdui/mdui.global.js，必须在它之后以 defer 加载。
 */
(function () {
  'use strict';

  var root = document.documentElement;
  root.classList.remove('mdui-theme-light', 'mdui-theme-dark');
  root.classList.add('mdui-theme-auto');

  function applyColorScheme() {
    try {
      if (window.mdui && typeof window.mdui.setColorScheme === 'function') {
        window.mdui.setColorScheme('#b45309');
        return true;
      }
    } catch (_) {
      /* ignore theme errors */
    }
    return false;
  }

  if (!applyColorScheme()) {
    // mdui.global.js 尚未就绪时（异常加载顺序等兜底）等待加载完成
    window.addEventListener('load', applyColorScheme, { once: true });
  }
})();
