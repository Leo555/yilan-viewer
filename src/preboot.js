/* 首帧前同步应用主题、字号与侧边栏设置，避免模块加载完成前的闪烁（CSP 不允许内联脚本，所以单独成文件） */
(function () {
  try {
    var s = JSON.parse(localStorage.getItem('cv.settings') || '{}');
    var r = document.documentElement;
    var dark = s.theme === 'dark' || (s.theme !== 'light' && matchMedia('(prefers-color-scheme: dark)').matches);
    if (s.theme === 'light' || s.theme === 'dark') r.setAttribute('data-theme', s.theme);
    else if (dark) r.setAttribute('data-theme-auto', 'dark');
    if (s.sideW) r.style.setProperty('--side-w', Math.min(600, Math.max(180, Number(s.sideW) || 260)) + 'px');
    if (s.size) r.style.setProperty('--code-size', s.size + 'px');
    if (dark) {
      document.getElementById('hl-light').disabled = true;
      document.getElementById('hl-dark').disabled = false;
    }
  } catch (e) { /* 隐私模式等 */ }
})();
