/*
 * /l/ 降级页的渐进增强脚本（ES5，普通 <script defer>，非 module）
 *
 * 基线页面零 JS 即可完整阅读；本脚本只做增强：
 *   1. 字号切换（标准 / 大 / 超大），用 cookie 记住选择
 *   2. 记住用户访问过长者版（现代站入口可据此提示）
 *   3. 分片「流式加载」：滚到本页末尾时用 XMLHttpRequest 读取下一片并追加到当前页，
 *      未读的片不会被下载 → 省带宽、首屏更快（PROMPT-zsb-tiku.md 7.8）
 *
 * 约束：
 *   - 纯 ES5 + IE9 支持的 DOM API（getElementById / getAttribute / addEventListener /
 *     XMLHttpRequest / textContent）；不用 fetch、ESM、dataset、classList、Promise。
 *   - file:// 离线打开时 XHR 读本地文件受同源策略限制，自动禁用第 3 项；
 *     基线「下一页 →」普通链接始终可用，离线包按整个目录分发。
 *   - 任何异常都自动回退到普通链接，绝不影响基线内容。
 *   - 由 scripts/verify-legacy.mjs 用 es-check es5 校验语法。
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

  /* ---------------------------------------------------------------- *
   * 分片流式加载（增量增强，可整体失效而不影响阅读）
   * ---------------------------------------------------------------- */
  var START = '<div class="l-body" id="l-body">';
  var END = '<!--L_BODY_END-->';
  var busy = false;
  var finished = false;
  var loaded = 0;

  function setNote(text) {
    var n = byId('l-loading');
    if (n) n.textContent = text;
  }

  function fail() {
    busy = false;
    setNote('自动续读不可用，点「下一页 →」即可继续阅读（内容不受影响）。');
  }

  function append(txt) {
    var body = byId('l-body');
    var next = byId('l-next');
    var s = txt.indexOf(START);
    var e = txt.indexOf(END);
    if (!body || s < 0 || e < 0 || e <= s) {
      fail();
      return;
    }

    var frag = txt.slice(s + START.length, e).replace(/<script[\s\S]*?<\/script>/gi, '');
    var tmp = document.createElement('div');
    tmp.innerHTML = frag;
    while (tmp.firstChild) body.appendChild(tmp.firstChild);

    var m = txt.match(/<!--L_NEXT:([^>]*)-->/);
    var nextHref = m ? m[1] : '';
    if (nextHref && next) {
      next.setAttribute('href', nextHref);
      loaded++;
      var info = byId('l-pageinfo');
      if (info) {
        info.textContent = '已连续加载 ' + loaded +
          ' 页；继续向下滚动会读取后续内容，未读的页不会被下载。';
      }
      setNote('');
    } else if (next) {
      finished = true;
      next.removeAttribute('href');
      next.className = 'l-btn l-done';
      next.innerHTML = '已到最后一页';
      setNote('全文已读完。');
    }
    busy = false;
  }

  function loadNext() {
    if (busy || finished) return;
    var next = byId('l-next');
    // 单页文档、或已到最后一页：没有下一片，静默停止
    if (!next) {
      finished = true;
      return;
    }
    var href = next.getAttribute('href');
    if (!href) {
      finished = true;
      return;
    }

    busy = true;
    setNote('正在读取下一页…');
    var xhr = null;
    try {
      xhr = new XMLHttpRequest();
    } catch (e) {
      fail();
      return;
    }
    try {
      xhr.open('GET', href, true);
      xhr.onreadystatechange = function () {
        if (xhr.readyState !== 4) return;
        // status 0 兼容部分本地 / 缓存响应
        if (xhr.status !== 200 && xhr.status !== 0) {
          fail();
          return;
        }
        try {
          append(xhr.responseText);
        } catch (e2) {
          fail();
        }
      };
      xhr.send(null);
    } catch (e3) {
      fail();
    }
  }

  function nearBottom() {
    var st = document.documentElement.scrollTop || document.body.scrollTop || 0;
    var vh = document.documentElement.clientHeight || window.innerHeight || 0;
    var sh = Math.max(
      document.body.scrollHeight || 0,
      document.documentElement.scrollHeight || 0
    );
    return sh > 0 && (st + vh >= sh - 800);
  }

  function initStream() {
    // file:// 下 XHR 读本地文件会被浏览器拒绝，直接禁用增强；
    // 基线「下一页 →」链接照常可用，离线包按整个 /l/ 目录分发。
    if (window.location && window.location.protocol === 'file:') return;
    if (!byId('l-body') || !byId('l-next')) return;
    if (!window.addEventListener || !window.XMLHttpRequest) return;

    var timer = null;
    window.addEventListener('scroll', function () {
      if (timer) return;
      timer = setTimeout(function () {
        timer = null;
        if (nearBottom()) loadNext();
      }, 200);
    }, false);
    // 首屏内容不足一屏时不会触发 scroll；此时点「下一页 →」始终可用。
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

  try {
    initStream();
  } catch (e4) {
    /* 流式加载失败不影响基线：普通分页链接仍在 */
  }
})();
