/*
 * /l/ 降级页的渐进增强脚本（ES5，普通 <script defer>，非 module）
 *
 * 基线页面零 JS 即可完整阅读；本脚本只做两件增强：
 *   1. 字号切换（标准 / 大 / 超大），用 cookie 记住选择（继承机制）
 *   2. 记住用户访问过长者版（现代站入口可据此提示）
 * 全部用 ES5 语法与 IE9 支持的 DOM API，任何异常都不影响基线内容。
 * 由 scripts/verify-legacy.mjs 用 es-check es5 校验。
 */
(function () {
  'use strict';

  function byId(id) {
    return document.getElementById(id);
  }

  function readCookie(name) {
    try {
      var parts = document.cookie.split(';');
      for (var i = 0; i < parts.length; i++) {
        var pair = parts[i].split('=');
        var key = pair[0].replace(/^\s+|\s+$/g, '');
        if (key === name) return decodeURIComponent(pair.slice(1).join('='));
      }
    } catch (e) {
      /* ignore */
    }
    return '';
  }

  function writeCookie(name, value, days) {
    try {
      var expires = '';
      if (days) {
        var d = new Date();
        d.setTime(d.getTime() + days * 24 * 60 * 60 * 1000);
        expires = '; expires=' + d.toUTCString();
      }
      document.cookie = name + '=' + encodeURIComponent(value) + expires + '; path=/';
    } catch (e) {
      /* ignore */
    }
  }

  function applySize(size) {
    var body = document.body;
    if (!body) return;
    var cls = body.className || '';
    cls = cls.replace(/\bl-large\b/g, '').replace(/\bl-xlarge\b/g, '');
    cls = cls.replace(/\s{2,}/g, ' ').replace(/^\s+|\s+$/g, '');
    if (size === 'large') cls = cls ? cls + ' l-large' : 'l-large';
    if (size === 'xlarge') cls = cls ? cls + ' l-xlarge' : 'l-xlarge';
    body.className = cls;
  }

  function makeButton(label, size) {
    var a = document.createElement('a');
    a.href = '#';
    a.className = 'l-btn';
    a.setAttribute('data-size', size);
    a.appendChild(document.createTextNode(label));
    a.onclick = function () {
      applySize(size);
      writeCookie('l-size', size, 365);
      return false;
    };
    return a;
  }

  try {
    var tools = byId('l-tools');
    if (tools) {
      tools.appendChild(document.createTextNode('字号：'));
      tools.appendChild(makeButton('标准', 'normal'));
      tools.appendChild(makeButton('大', 'large'));
      tools.appendChild(makeButton('超大', 'xlarge'));
    }
    applySize(readCookie('l-size') || 'normal');
    writeCookie('l-prefer', '1', 365);
  } catch (e) {
    /* 增强失败不影响基线：页面本身无需 JS */
  }
})();
