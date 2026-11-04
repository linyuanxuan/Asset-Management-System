/* 登录页逻辑：只做表单提交与错误提示，无敏感信息落地 */
(function () {
  'use strict';

  var form = document.getElementById('login-form');
  var error = document.getElementById('error');
  var submit = document.getElementById('submit');
  var password = document.getElementById('password');

  function showError(message) {
    error.textContent = message;
    error.classList.remove('hidden');
  }

  form.addEventListener('submit', function (event) {
    event.preventDefault();
    error.classList.add('hidden');

    var username = document.getElementById('username').value.trim();
    var pwd = password.value;

    if (!username || !pwd) {
      showError('请输入账号和密码');
      return;
    }

    submit.disabled = true;
    submit.textContent = '验证中…';

    fetch('/api/auth/login', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: username, password: pwd }),
    })
      .then(function (res) {
        return res.json().then(function (body) {
          return { ok: res.ok, body: body };
        });
      })
      .then(function (result) {
        if (result.ok) {
          location.replace('/');
          return;
        }
        showError((result.body && result.body.error) || '登录失败');
        password.value = '';
        password.focus();
      })
      .catch(function () {
        showError('网络异常，请确认服务已启动');
      })
      .finally(function () {
        submit.disabled = false;
        submit.textContent = '进入台账';
      });
  });
})();
