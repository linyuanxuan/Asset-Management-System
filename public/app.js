/* 个人数字资产台账 - 前端逻辑（原生 JS，无框架）
 * 安全约定：
 *  - 所有用户数据只通过 textContent 渲染，从不拼接 innerHTML，杜绝 XSS
 *  - 敏感字段列表中只拿到掩码，点"显示"才单独请求明文（接口 no-store）
 */
(function () {
  'use strict';

  var state = {
    schema: null,
    category: 'all',
    q: '',
    assets: [],
    warnDays: 30,
    mask: '••••••••',
  };

  /* ================= 基础工具 ================= */

  function $(sel, root) {
    return (root || document).querySelector(sel);
  }

  function h(tag, attrs) {
    var node = document.createElement(tag);
    var a = attrs || {};
    Object.keys(a).forEach(function (key) {
      var value = a[key];
      if (value === null || value === undefined || value === false) return;
      if (key === 'class') node.className = value;
      else if (key === 'text') node.textContent = value;
      else if (key === 'html') throw new Error('禁止使用 html 注入');
      else if (key.indexOf('on') === 0 && typeof value === 'function') node.addEventListener(key.slice(2), value);
      else if (key === 'dataset') Object.keys(value).forEach(function (k) { node.dataset[k] = value[k]; });
      else node.setAttribute(key, value === true ? '' : value);
    });
    for (var i = 2; i < arguments.length; i++) append(node, arguments[i]);
    return node;
  }

  function append(parent, child) {
    if (child === null || child === undefined || child === false) return;
    if (Array.isArray(child)) return child.forEach(function (c) { append(parent, c); });
    parent.appendChild(typeof child === 'string' || typeof child === 'number'
      ? document.createTextNode(String(child))
      : child);
  }

  function api(path, options) {
    var opts = Object.assign({ credentials: 'same-origin' }, options || {});
    if (opts.body && typeof opts.body !== 'string') opts.body = JSON.stringify(opts.body);
    opts.headers = Object.assign({ 'Content-Type': 'application/json' }, opts.headers || {});

    return fetch(path, opts).then(function (res) {
      if (res.status === 401) {
        location.replace('/login.html');
        throw new Error('未登录');
      }
      var type = res.headers.get('content-type') || '';
      var parse = type.indexOf('application/json') >= 0 ? res.json() : Promise.resolve(null);
      return parse.then(function (data) {
        if (!res.ok) {
          var err = new Error((data && data.error) || '请求失败（' + res.status + '）');
          err.status = res.status;
          throw err;
        }
        return data;
      });
    });
  }

  function toast(message) {
    var box = $('#toast');
    $('#toast-body').textContent = message;
    box.classList.remove('hidden');
    clearTimeout(toast._timer);
    toast._timer = setTimeout(function () { box.classList.add('hidden'); }, 2200);
  }

  function fmt(value, field) {
    if (value === '' || value === null || value === undefined) return '';
    if (field && field.type === 'number') {
      var n = Number(value);
      return isNaN(n) ? String(value) : n.toLocaleString('zh-CN');
    }
    return String(value);
  }

  function catOf(key) {
    if (!state.schema) return null;
    for (var i = 0; i < state.schema.categories.length; i++) {
      if (state.schema.categories[i].key === key) return state.schema.categories[i];
    }
    return null;
  }

  function daysLeft(dateStr) {
    if (!dateStr) return null;
    var target = new Date(dateStr + 'T00:00:00');
    if (isNaN(target.getTime())) return null;
    var today = new Date();
    today.setHours(0, 0, 0, 0);
    return Math.round((target - today) / 86400000);
  }

  /* ================= 列表渲染 ================= */

  function renderTabs() {
    var tabs = $('#tabs');
    tabs.textContent = '';

    var items = [{ key: 'all', name: '全部' }].concat(state.schema.categories);
    items.forEach(function (item) {
      var active = state.category === item.key;
      var btn = h('button', {
        class: 'shrink-0 px-3 py-1.5 text-sm rounded-full border transition ' +
          (active
            ? 'bg-slate-900 text-white border-slate-900'
            : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300'),
        text: item.name,
        onclick: function () {
          state.category = item.key;
          renderTabs();
          load();
        },
      });
      tabs.appendChild(btn);
    });
  }

  function expiryBadge(asset) {
    var dl = daysLeft(asset.expire_at);
    if (dl === null) return null;
    if (dl < 0) {
      return h('span', { class: 'badge bg-red-50 text-red-600 border border-red-200', text: '已过期 ' + Math.abs(dl) + ' 天' });
    }
    if (dl <= state.warnDays) {
      return h('span', {
        class: 'badge bg-amber-50 text-amber-700 border border-amber-200',
        text: dl === 0 ? '今天到期' : '剩余 ' + dl + ' 天',
      });
    }
    return h('span', { class: 'badge bg-slate-50 text-slate-500 border border-slate-200', text: '到期 ' + asset.expire_at });
  }

  function quotaBadge(asset) {
    var d = asset.data || {};
    var total = Number(d.quota_total);
    var left = Number(d.quota_left);
    if (!d.quota_total || isNaN(total) || total <= 0 || isNaN(left)) return null;
    var ratio = left / total;
    if (ratio <= 0.1) {
      return h('span', { class: 'badge bg-red-50 text-red-600 border border-red-200', text: '额度剩余 ' + Math.round(ratio * 100) + '%' });
    }
    return null;
  }

  function previewFields(asset) {
    var cat = catOf(asset.category);
    if (!cat) return [];
    var skip = { notes: 1, expire_at: 1, kind: 1 };
    skip[cat.titleField] = 1;

    var rows = [];
    cat.fields.forEach(function (field) {
      if (rows.length >= 3) return;
      if (skip[field.key]) return;
      var value = (asset.data || {})[field.key];

      if (field.secret) {
        if (asset.secretSet && asset.secretSet[field.key]) {
          rows.push({ label: field.label, value: state.mask, secret: true });
        }
        return;
      }
      var text = fmt(value, field);
      if (!text) return;
      rows.push({ label: field.label, value: text, secret: false });
    });
    return rows;
  }

  function assetCard(asset) {
    var cat = catOf(asset.category);
    var dl = daysLeft(asset.expire_at);
    var borderClass = dl !== null && dl < 0 ? 'card-expired' : (dl !== null && dl <= state.warnDays ? 'card-soon' : '');

    var badges = h('div', { class: 'mt-1.5 flex flex-wrap items-center gap-1.5' });
    badges.appendChild(h('span', {
      class: 'badge bg-slate-100 text-slate-600',
      text: cat ? cat.name : asset.category,
    }));
    var d = asset.data || {};
    if (d.kind) badges.appendChild(h('span', { class: 'badge bg-indigo-50 text-indigo-600 border border-indigo-100', text: d.kind }));
    var exp = expiryBadge(asset);
    if (exp) badges.appendChild(exp);
    var qb = quotaBadge(asset);
    if (qb) badges.appendChild(qb);

    var dlList = h('dl', { class: 'mt-3 space-y-1 text-sm text-slate-600 flex-1 min-w-0' });
    previewFields(asset).forEach(function (row) {
      var line = h('div', { class: 'flex gap-2 min-w-0' });
      line.appendChild(h('dt', { class: 'text-slate-400 shrink-0 w-16 truncate', text: row.label }));
      line.appendChild(h('dd', {
        class: 'truncate ' + (row.secret ? 'secret-mask text-slate-400' : 'text-slate-700'),
        text: row.value,
      }));
      dlList.appendChild(line);
    });

    var noteLine = asset.notes
      ? h('p', { class: 'mt-2 text-xs text-slate-500 line-clamp-2', text: asset.notes })
      : null;

    var actions = h('div', { class: 'mt-3 pt-3 border-t border-slate-100 flex items-center justify-end gap-1.5' });
    actions.appendChild(h('button', { class: 'btn btn-ghost !px-2.5 !py-1 text-xs', text: '查看', onclick: function () { openDetail(asset); } }));
    actions.appendChild(h('button', { class: 'btn btn-ghost !px-2.5 !py-1 text-xs', text: '编辑', onclick: function () { openForm(asset); } }));
    actions.appendChild(h('button', { class: 'btn btn-danger !px-2.5 !py-1 text-xs', text: '删除', onclick: function () { removeAsset(asset); } }));

    return h('article', {
      class: 'bg-white rounded-xl border border-slate-200 p-4 flex flex-col hover:shadow-sm transition ' + borderClass,
    },
      h('div', { class: 'min-w-0' },
        h('h3', { class: 'font-medium text-slate-900 truncate', text: asset.title, title: asset.title }),
        badges
      ),
      dlList,
      noteLine,
      actions
    );
  }

  function renderList() {
    var list = $('#list');
    var empty = $('#empty');
    list.textContent = '';

    var expired = state.assets.filter(function (a) {
      var dl = daysLeft(a.expire_at);
      return dl !== null && dl < 0;
    }).length;
    var soon = state.assets.filter(function (a) {
      var dl = daysLeft(a.expire_at);
      return dl !== null && dl >= 0 && dl <= state.warnDays;
    }).length;

    var summary = $('#summary');
    summary.textContent = '';
    summary.appendChild(h('span', { text: '共 ' + state.assets.length + ' 条' }));
    if (expired) summary.appendChild(h('span', { class: 'text-red-600', text: '已过期 ' + expired + ' 条' }));
    if (soon) summary.appendChild(h('span', { class: 'text-amber-600', text: state.warnDays + ' 天内到期 ' + soon + ' 条' }));
    if (state.q) summary.appendChild(h('span', { text: '搜索：「' + state.q + '」' }));

    if (!state.assets.length) {
      empty.classList.remove('hidden');
      return;
    }
    empty.classList.add('hidden');
    state.assets.forEach(function (asset) { list.appendChild(assetCard(asset)); });
  }

  /* ================= 弹窗基础 ================= */

  function openModal(panel) {
    closeModal();
    var backdrop = h('div', {
      class: 'fixed inset-0 z-40 modal-backdrop flex items-start justify-center overflow-y-auto p-4',
      id: 'modal-backdrop',
      onclick: function (e) { if (e.target === backdrop) closeModal(); },
    }, panel);
    $('#modal-root').appendChild(backdrop);
    document.addEventListener('keydown', escClose);
    var focusable = panel.querySelector('input, select, textarea, button');
    if (focusable) focusable.focus();
    return backdrop;
  }

  function escClose(e) {
    if (e.key === 'Escape') closeModal();
  }

  function closeModal() {
    var root = $('#modal-root');
    if (root) root.textContent = '';
    document.removeEventListener('keydown', escClose);
  }

  /* ================= 详情 ================= */

  function openDetail(asset) {
    var cat = catOf(asset.category);
    var dlList = h('div', { class: 'divide-y divide-slate-100' });

    (cat ? cat.fields : []).forEach(function (field) {
      var value = (asset.data || {})[field.key];
      var hasValue = field.secret ? Boolean(asset.secretSet && asset.secretSet[field.key]) : value !== '' && value !== null && value !== undefined;
      if (!hasValue) return;

      var valueNode = h('div', { class: 'text-slate-800 text-sm break-all' });
      if (field.secret) {
        valueNode.appendChild(h('span', { class: 'secret-mask text-slate-400', text: state.mask }));
        var shown = false;
        var btn = h('button', {
          class: 'ml-2 text-xs text-slate-500 underline hover:text-slate-900',
          text: '显示',
          onclick: function () {
            if (shown) return;
            btn.disabled = true;
            btn.textContent = '解密中…';
            api('/api/assets/' + asset.id + '/reveal/' + field.key)
              .then(function (data) {
                valueNode.textContent = '';
                valueNode.appendChild(h('span', { class: 'font-mono text-slate-900', text: data.value || '（空）' }));
                var copy = h('button', {
                  class: 'ml-2 text-xs text-slate-500 underline hover:text-slate-900',
                  text: '复制',
                  onclick: function () { copyText(data.value || ''); },
                });
                var hide = h('button', {
                  class: 'ml-2 text-xs text-slate-500 underline hover:text-slate-900',
                  text: '隐藏',
                  onclick: function () { openDetail(asset); },
                });
                valueNode.appendChild(copy);
                valueNode.appendChild(hide);
                shown = true;
              })
              .catch(function (err) { btn.disabled = false; btn.textContent = '显示'; toast(err.message); });
          },
        });
        valueNode.appendChild(btn);
      } else {
        valueNode.textContent = fmt(value, field);
      }

      dlList.appendChild(h('div', { class: 'py-2.5 grid grid-cols-3 gap-3' },
        h('div', { class: 'text-xs text-slate-400 pt-0.5', text: field.label }),
        h('div', { class: 'col-span-2' }, valueNode)
      ));
    });

    if (asset.notes) {
      dlList.appendChild(h('div', { class: 'py-2.5 grid grid-cols-3 gap-3' },
        h('div', { class: 'text-xs text-slate-400 pt-0.5', text: '备注' }),
        h('div', { class: 'col-span-2 text-sm text-slate-700 whitespace-pre-wrap break-words', text: asset.notes })
      ));
    }

    var panel = h('div', { class: 'bg-white rounded-xl shadow-xl w-full max-w-lg my-8 flex flex-col max-h-[90vh]' },
      h('div', { class: 'flex items-start justify-between gap-3 px-5 py-4 border-b border-slate-100' },
        h('div', { class: 'min-w-0' },
          h('h2', { class: 'font-semibold text-slate-900 truncate', text: asset.title }),
          h('p', { class: 'text-xs text-slate-400 mt-0.5', text: (cat ? cat.name : asset.category) + ' · 更新于 ' + (asset.updated_at || '').slice(0, 10) })
        ),
        h('button', { class: 'text-slate-400 hover:text-slate-700 text-xl leading-none', text: '×', onclick: closeModal })
      ),
      h('div', { class: 'px-5 py-2 overflow-y-auto flex-1 min-h-0' }, dlList),
      h('div', { class: 'px-5 py-3 border-t border-slate-100 flex justify-end gap-2 shrink-0' },
        h('button', { class: 'btn btn-ghost', text: '关闭', onclick: closeModal }),
        h('button', { class: 'btn btn-primary', text: '编辑', onclick: function () { openForm(asset); } })
      )
    );

    openModal(panel);
  }

  function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text).then(function () { toast('已复制到剪贴板'); });
      return;
    }
    var ta = h('textarea', { class: 'fixed opacity-0 top-0 left-0' });
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); toast('已复制到剪贴板'); } catch (e) { toast('复制失败，请手动选择'); }
    document.body.removeChild(ta);
  }

  /* ================= 新增 / 编辑 ================= */

  function fieldInput(field, asset) {
    var isEdit = Boolean(asset);
    var value = asset ? (asset.data || {})[field.key] : '';

    var attrs = {
      class: 'input',
      'data-key': field.key,
      id: 'f-' + field.key,
      maxlength: field.max || (field.type === 'textarea' ? 2000 : 300),
    };

    var input;
    if (field.type === 'textarea') {
      input = h('textarea', Object.assign({ rows: 3 }, attrs));
      input.value = value === undefined || value === null ? '' : String(value);
    } else if (field.type === 'select') {
      input = h('select', attrs);
      input.appendChild(h('option', { value: '', text: '未选择' }));
      (field.options || []).forEach(function (opt) {
        input.appendChild(h('option', { value: opt, text: opt }));
      });
      input.value = value || '';
    } else if (field.type === 'password') {
      input = h('input', Object.assign({ type: 'password', autocomplete: 'new-password' }, attrs));
      if (isEdit && asset.secretSet && asset.secretSet[field.key]) {
        input.placeholder = '已加密保存，留空表示不修改';
      } else {
        input.placeholder = field.placeholder || '加密保存';
      }
    } else if (field.type === 'number') {
      input = h('input', Object.assign({ type: 'number', min: '0', step: 'any' }, attrs));
      input.value = value === undefined || value === null ? '' : String(value);
    } else if (field.type === 'date') {
      input = h('input', Object.assign({ type: 'date' }, attrs));
      input.value = value || '';
    } else {
      input = h('input', Object.assign({ type: 'text' }, attrs));
      if (field.placeholder) input.placeholder = field.placeholder;
      input.value = value === undefined || value === null ? '' : String(value);
    }
    return input;
  }

  function openForm(asset) {
    var isEdit = Boolean(asset);
    var categoryKey = isEdit ? asset.category : (state.category !== 'all' ? state.category : state.schema.categories[0].key);
    var formError = h('p', { class: 'hidden text-sm text-red-600' });

    var fieldsWrap = h('div', { class: 'grid sm:grid-cols-2 gap-3' });

    function renderFields() {
      var cat = catOf(categoryKey);
      fieldsWrap.textContent = '';
      cat.fields.forEach(function (field) {
        var wrap = h('div', { class: field.type === 'textarea' ? 'sm:col-span-2' : '' });
        var label = h('label', { class: 'block text-xs font-medium text-slate-600 mb-1', for: 'f-' + field.key });
        label.appendChild(document.createTextNode(field.label));
        if (field.required) label.appendChild(h('span', { class: 'text-red-500 ml-0.5', text: '*' }));
        if (field.secret) {
          label.appendChild(h('span', { class: 'ml-1 text-[11px] text-emerald-600', text: '加密' }));
        }
        wrap.appendChild(label);
        wrap.appendChild(fieldInput(field, asset));
        fieldsWrap.appendChild(wrap);
      });

      // 额度自动计算（AI 资源）
      var total = fieldsWrap.querySelector('[data-key="quota_total"]');
      var used = fieldsWrap.querySelector('[data-key="quota_used"]');
      var left = fieldsWrap.querySelector('[data-key="quota_left"]');
      if (total && used && left) {
        var calc = function () {
          if (total.value === '' || used.value === '') return;
          var n = Number(total.value) - Number(used.value);
          if (!isNaN(n)) left.value = String(Math.round(n * 1e6) / 1e6);
        };
        total.addEventListener('input', calc);
        used.addEventListener('input', calc);
      }
    }

    var categorySelect = null;
    if (isEdit) {
      categorySelect = h('input', { type: 'text', class: 'input bg-slate-50', value: (catOf(categoryKey) || {}).name || categoryKey, disabled: true });
    } else {
      categorySelect = h('select', { class: 'input', id: 'f-category' });
      state.schema.categories.forEach(function (cat) {
        categorySelect.appendChild(h('option', { value: cat.key, text: cat.name }));
      });
      categorySelect.value = categoryKey;
      categorySelect.addEventListener('change', function () {
        categoryKey = categorySelect.value;
        renderFields();
      });
    }

    renderFields();

    var submitBtn = h('button', { class: 'btn btn-primary', type: 'submit', text: isEdit ? '保存修改' : '添加' });

    var form = h('form', { class: 'px-5 py-4 space-y-4 overflow-y-auto flex-1 min-h-0' },
      h('div', { class: 'grid sm:grid-cols-2 gap-3' },
        h('div', null,
          h('label', { class: 'block text-xs font-medium text-slate-600 mb-1', text: '资产分类' }),
          categorySelect
        ),
        h('div', null,
          h('label', { class: 'block text-xs font-medium text-slate-600 mb-1', text: '提示' }),
          h('p', { class: 'text-xs text-slate-400 leading-relaxed pt-1.5', text: '标"加密"的字段以 AES-256-GCM 加密入库，页面只显示掩码。' })
        )
      ),
      fieldsWrap,
      formError,
      h('div', { class: 'flex justify-end gap-2 pt-2 sticky bottom-0 bg-white border-t border-slate-100 -mx-5 px-5 pb-1' },
        h('button', { type: 'button', class: 'btn btn-ghost', text: '取消', onclick: closeModal }),
        submitBtn
      )
    );

    form.addEventListener('submit', function (event) {
      event.preventDefault();
      formError.classList.add('hidden');

      var cat = catOf(categoryKey);
      var data = {};
      var missing = null;

      cat.fields.forEach(function (field) {
        var input = form.querySelector('[data-key="' + field.key + '"]');
        if (!input) return;
        if (field.secret && isEdit && input.value === '') return; // 留空不修改
        if (field.required && input.value.trim() === '' && !missing) missing = field.label;
        data[field.key] = input.value;
      });

      if (missing) {
        formError.textContent = '请填写「' + missing + '」';
        formError.classList.remove('hidden');
        return;
      }

      submitBtn.disabled = true;
      var payload = { category: categoryKey, data: data };
      var request = isEdit
        ? api('/api/assets/' + asset.id, { method: 'PUT', body: payload })
        : api('/api/assets', { method: 'POST', body: payload });

      request
        .then(function () {
          closeModal();
          toast(isEdit ? '已保存' : '已添加');
          load();
        })
        .catch(function (err) {
          formError.textContent = err.message;
          formError.classList.remove('hidden');
          submitBtn.disabled = false;
        });
    });

    var panel = h('div', { class: 'bg-white rounded-xl shadow-xl w-full max-w-2xl my-8 flex flex-col max-h-[90vh]' },
      h('div', { class: 'flex items-center justify-between px-5 py-4 border-b border-slate-100' },
        h('h2', { class: 'font-semibold text-slate-900', text: isEdit ? '编辑资产' : '新增资产' }),
        h('button', { class: 'text-slate-400 hover:text-slate-700 text-xl leading-none', type: 'button', text: '×', onclick: closeModal })
      ),
      form
    );

    openModal(panel);
  }

  /* ================= 删除 ================= */

  function removeAsset(asset) {
    if (!window.confirm('确定删除「' + asset.title + '」？删除后不可恢复。')) return;
    api('/api/assets/' + asset.id, { method: 'DELETE' })
      .then(function () { toast('已删除'); load(); })
      .catch(function (err) { toast(err.message); });
  }

  /* ================= 导出 ================= */

  function exportCsv(withSecrets) {
    var menu = $('#export-menu');
    if (menu) menu.removeAttribute('open');

    if (withSecrets) {
      var ok = window.confirm('导出文件将包含明文 API Key / 密码 / SSH 密钥。\n请确认保存位置安全，不要上传网盘或发给他人。继续导出？');
      if (!ok) return;
    }

    var params = new URLSearchParams();
    if (state.category !== 'all') params.set('category', state.category);
    if (state.q) params.set('q', state.q);
    if (withSecrets) params.set('secrets', '1');

    var qs = params.toString();
    window.location.href = '/api/assets/export.csv' + (qs ? '?' + qs : '');
    toast(withSecrets ? '正在导出（含明文，请妥善保管）' : '正在导出脱敏 CSV');
  }

  /* ================= 数据加载 ================= */

  var loadSeq = 0;

  function load() {
    var seq = ++loadSeq;
    var params = new URLSearchParams();
    if (state.category !== 'all') params.set('category', state.category);
    if (state.q) params.set('q', state.q);
    var qs = params.toString();

    return api('/api/assets' + (qs ? '?' + qs : ''))
      .then(function (data) {
        if (seq !== loadSeq) return;
        state.assets = data.assets || [];
        state.warnDays = data.warnDays || 30;
        renderList();
      })
      .catch(function (err) {
        if (err.message !== '未登录') toast(err.message);
      });
  }

  /* ================= 初始化 ================= */

  function bindEvents() {
    $('#btn-add').addEventListener('click', function () { openForm(null); });
    $('#btn-add-empty').addEventListener('click', function () { openForm(null); });

    $('#btn-logout').addEventListener('click', function () {
      api('/api/auth/logout', { method: 'POST' })
        .catch(function () { /* 忽略 */ })
        .finally(function () { location.replace('/login.html'); });
    });

    var timer = null;
    $('#search').addEventListener('input', function (e) {
      clearTimeout(timer);
      var value = e.target.value.trim();
      timer = setTimeout(function () {
        state.q = value;
        load();
      }, 250);
    });

    document.querySelectorAll('[data-export]').forEach(function (btn) {
      btn.addEventListener('click', function () { exportCsv(btn.dataset.export === '1'); });
    });

    document.addEventListener('click', function (e) {
      var menu = $('#export-menu');
      if (menu && menu.hasAttribute('open') && !menu.contains(e.target)) menu.removeAttribute('open');
    });
  }

  function init() {
    api('/api/schema')
      .then(function (schema) {
        state.schema = schema;
        state.mask = schema.mask || state.mask;
        state.warnDays = schema.warnDays || 30;
        renderTabs();
        bindEvents();
        return load();
      })
      .catch(function (err) {
        if (err.message === '未登录') return;
        document.querySelector('main').textContent = '加载失败：' + err.message;
      });
  }

  init();
})();
